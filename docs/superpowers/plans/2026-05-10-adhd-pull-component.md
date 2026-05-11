# /adhd:pull-component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/adhd:pull-component` — pulls a Figma Component Set back into a React source file, updating only design-token lookup tables and union type members; function body and JSX never modified.

**Architecture:** This skill runs inside Claude Code. The LLM is the diff/apply engine — it reads the React source, the Figma extract, computes the diff in working memory, prompts the user via `AskUserQuestion`, and applies changes via `Edit` tool calls. Traditional library code is reserved for the deterministic, testable surface: `config-writer.js` (mutates `adhd.config.ts` to add/read component mappings) and the existing `lint-engine` (reused for pre-flight via subprocess). The SKILL prompt is detailed enough that any Claude Code agent executes it the same way — every invariant (function body untouched, off-system comment format, abort conditions) is stated explicitly.

**Tech Stack:** Node 20 (lib runs zero-deps), TS compiler API for `config-writer.js` (already a transitive dep), `node --test` runner, Figma MCP `use_figma` invoked from the SKILL.

---

## File structure (lock-in)

**New library — `plugins/adhd/lib/pull-component/`:**

| File | Responsibility |
|---|---|
| `config-writer.js` | Read & idempotently add `components.<path>.figma.url` in `adhd.config.ts`; also `reverseLookupPath(source, figmaUrl)` |
| `cli.js` | Subcommands: `config-write`, `config-read`, `config-reverse` (deterministic schema ops only — everything else lives in the SKILL) |
| `README.md` | One-paragraph module readme |
| `__tests__/config-writer.test.js` | Unit tests for the three pure functions |
| `__tests__/cli.test.js` | CLI surface tests |

**New skill — `plugins/adhd/skills/pull-component/SKILL.md`:**
The 11-phase orchestrator, `disable-model-invocation: true`. This is the "intelligence" layer: extracts Figma via `use_figma`, reads the React source via `Read`, computes the diff in-context, prompts via `AskUserQuestion`, applies via `Edit`.

**Modified files:**
- `plugins/adhd/skills/push-component/SKILL.md` — insert mapping-write step between Phase 11 (finalize) and Phase 12 (report)
- `.claude-plugin/marketplace.json` — bump description to list 6 commands
- `README.md` — add pull-component row to command table; add "Pull a component" subsection
- `.github/workflows/ci.yml` — add `node --test plugins/adhd/lib/pull-component/__tests__/`

**Out-of-bounds (do NOT create):**
- `parse-react.js` / `differ.js` / `apply.js` / `class-resolver.js` — these would be brittle pattern-matching reimplementations of work the LLM already does well. The SKILL handles these via Read + reasoning + Edit.

---

## Task 1: Scaffold lib + CI + config-writer

**Files:**
- Create: `plugins/adhd/lib/pull-component/cli.js`
- Create: `plugins/adhd/lib/pull-component/config-writer.js`
- Create: `plugins/adhd/lib/pull-component/README.md`
- Create: `plugins/adhd/lib/pull-component/__tests__/cli.test.js`
- Create: `plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing tests for `config-writer.js`**

`plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readComponentMapping, addComponentMapping, reverseLookupPath } = require('../config-writer');

const MINIMAL_CONFIG = `const config = {
  figma: { url: "https://figma.com/design/ABC/" },
};

export default config;
`;

const WITH_COMPONENTS = `const config = {
  figma: { url: "https://figma.com/design/ABC/" },
  components: {
    "app/components/avatar/index.tsx": {
      figma: { url: "https://figma.com/design/ABC/?node-id=91-18" },
    },
  },
};

export default config;
`;

test('readComponentMapping returns null when no components field exists', () => {
  assert.equal(readComponentMapping(MINIMAL_CONFIG, 'app/components/badge.tsx'), null);
});

test('readComponentMapping returns entry when path matches', () => {
  const r = readComponentMapping(WITH_COMPONENTS, 'app/components/avatar/index.tsx');
  assert.equal(r && r.figma.url, 'https://figma.com/design/ABC/?node-id=91-18');
});

test('readComponentMapping returns null for an absent path even if components exists', () => {
  assert.equal(readComponentMapping(WITH_COMPONENTS, 'app/components/nope.tsx'), null);
});

test('addComponentMapping creates components field if missing', () => {
  const out = addComponentMapping(MINIMAL_CONFIG, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  assert.match(out, /components:\s*\{/);
  assert.match(out, /"app\/components\/badge\.tsx":/);
  assert.match(out, /url:\s*"https:\/\/figma\.com\/design\/ABC\/\?node-id=200-1"/);
});

test('addComponentMapping is idempotent — re-adding same entry returns identical source', () => {
  const out1 = addComponentMapping(MINIMAL_CONFIG, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  const out2 = addComponentMapping(out1, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  assert.equal(out2, out1);
});

test('addComponentMapping appends to existing components field', () => {
  const out = addComponentMapping(WITH_COMPONENTS, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  assert.match(out, /"app\/components\/avatar\/index\.tsx":/);
  assert.match(out, /"app\/components\/badge\.tsx":/);
});

test('addComponentMapping updates existing entry if URL differs', () => {
  const out = addComponentMapping(WITH_COMPONENTS, 'app/components/avatar/index.tsx', 'https://figma.com/design/ABC/?node-id=999-1');
  assert.match(out, /node-id=999-1/);
  assert.doesNotMatch(out, /node-id=91-18/);
});

test('reverseLookupPath finds the path for a given figma URL', () => {
  const path = reverseLookupPath(WITH_COMPONENTS, 'https://figma.com/design/ABC/?node-id=91-18');
  assert.equal(path, 'app/components/avatar/index.tsx');
});

test('reverseLookupPath returns null for unknown URL', () => {
  assert.equal(reverseLookupPath(WITH_COMPONENTS, 'https://figma.com/design/ABC/?node-id=999-1'), null);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `config-writer.js`**

`plugins/adhd/lib/pull-component/config-writer.js`:

```javascript
'use strict';

const ts = require('typescript');

function parse(source) {
  return ts.createSourceFile('adhd.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function findConfigObject(sourceFile) {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === 'config' && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
        return decl.initializer;
      }
    }
  }
  return null;
}

function findProperty(objectLit, name) {
  return objectLit.properties.find(p => ts.isPropertyAssignment(p) && p.name && (
    (ts.isIdentifier(p.name) && p.name.text === name) ||
    (ts.isStringLiteral(p.name) && p.name.text === name)
  ));
}

function readComponentMapping(source, relPath) {
  const sf = parse(source);
  const cfg = findConfigObject(sf);
  if (!cfg) return null;
  const components = findProperty(cfg, 'components');
  if (!components || !ts.isObjectLiteralExpression(components.initializer)) return null;
  const entry = components.initializer.properties.find(p =>
    ts.isPropertyAssignment(p) && p.name && ts.isStringLiteral(p.name) && p.name.text === relPath,
  );
  if (!entry || !ts.isObjectLiteralExpression(entry.initializer)) return null;
  const figma = findProperty(entry.initializer, 'figma');
  if (!figma || !ts.isObjectLiteralExpression(figma.initializer)) return null;
  const url = findProperty(figma.initializer, 'url');
  if (!url || !ts.isStringLiteral(url.initializer)) return null;
  return { figma: { url: url.initializer.text } };
}

function reverseLookupPath(source, figmaUrl) {
  const sf = parse(source);
  const cfg = findConfigObject(sf);
  if (!cfg) return null;
  const components = findProperty(cfg, 'components');
  if (!components || !ts.isObjectLiteralExpression(components.initializer)) return null;
  for (const entry of components.initializer.properties) {
    if (!ts.isPropertyAssignment(entry) || !entry.name || !ts.isStringLiteral(entry.name)) continue;
    if (!ts.isObjectLiteralExpression(entry.initializer)) continue;
    const figma = findProperty(entry.initializer, 'figma');
    if (!figma || !ts.isObjectLiteralExpression(figma.initializer)) continue;
    const url = findProperty(figma.initializer, 'url');
    if (!url || !ts.isStringLiteral(url.initializer)) continue;
    if (url.initializer.text === figmaUrl) return entry.name.text;
  }
  return null;
}

function findLineStart(source, position) {
  let i = position;
  while (i > 0 && source[i - 1] !== '\n') i--;
  return i;
}

function addComponentMapping(source, relPath, figmaUrl) {
  // Idempotency: if existing entry matches, return source unchanged.
  const existing = readComponentMapping(source, relPath);
  if (existing && existing.figma.url === figmaUrl) return source;

  const sf = parse(source);
  const cfg = findConfigObject(sf);
  if (!cfg) throw new Error('addComponentMapping: could not find `const config = { ... }`');

  // Case 1: existing components.<relPath> with a different URL → replace url inline.
  const components = findProperty(cfg, 'components');
  if (components && ts.isObjectLiteralExpression(components.initializer)) {
    const entry = components.initializer.properties.find(p =>
      ts.isPropertyAssignment(p) && p.name && ts.isStringLiteral(p.name) && p.name.text === relPath,
    );
    if (entry && ts.isObjectLiteralExpression(entry.initializer)) {
      const figma = findProperty(entry.initializer, 'figma');
      if (figma && ts.isObjectLiteralExpression(figma.initializer)) {
        const urlProp = findProperty(figma.initializer, 'url');
        if (urlProp && ts.isStringLiteral(urlProp.initializer)) {
          const start = urlProp.initializer.getStart(sf);
          const end = urlProp.initializer.getEnd();
          return source.slice(0, start) + `"${figmaUrl}"` + source.slice(end);
        }
      }
    }
    // Case 2: components exists but not this path → append new entry before closing brace.
    const close = components.initializer.getEnd() - 1;
    const firstProp = components.initializer.properties[0];
    let indent = '  ';
    if (firstProp) {
      const lineStart = findLineStart(source, firstProp.getStart(sf));
      indent = source.slice(lineStart, firstProp.getStart(sf));
    }
    const insert = `${indent}"${relPath}": {\n${indent}  figma: { url: "${figmaUrl}" },\n${indent}},\n`;
    return source.slice(0, close) + insert + source.slice(close);
  }

  // Case 3: no components field → insert one before the closing brace of `const config`.
  const close = cfg.getEnd() - 1;
  const firstCfgProp = cfg.properties[0];
  let baseIndent = '  ';
  if (firstCfgProp) {
    const lineStart = findLineStart(source, firstCfgProp.getStart(sf));
    baseIndent = source.slice(lineStart, firstCfgProp.getStart(sf));
  }
  const insert = `${baseIndent}components: {\n${baseIndent}  "${relPath}": {\n${baseIndent}    figma: { url: "${figmaUrl}" },\n${baseIndent}  },\n${baseIndent}},\n`;
  return source.slice(0, close) + insert + source.slice(close);
}

module.exports = { readComponentMapping, reverseLookupPath, addComponentMapping };
```

- [ ] **Step 4: Verify config-writer tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`
Expected: 9 tests PASS.

- [ ] **Step 5: Write failing tests for `cli.js`**

`plugins/adhd/lib/pull-component/__tests__/cli.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-pull-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, content);
  return p;
}

test('cli with --help prints subcommand usage and exits 0', () => {
  const r = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /config-write/);
  assert.match(r.stdout, /config-read/);
  assert.match(r.stdout, /config-reverse/);
});

test('cli with no args exits 2', () => {
  assert.equal(spawnSync('node', [CLI], { encoding: 'utf8' }).status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  assert.equal(spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' }).status, 2);
});

test('config-write subcommand adds a components entry to the config file', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-write', '--config', cfgPath, '--path', 'app/components/x.tsx', '--figma-url', 'https://figma.com/design/ABC/?node-id=1-1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.match(after, /"app\/components\/x\.tsx":/);
});

test('config-read subcommand prints the figma url to stdout', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n  components: {\n    "app/components/x.tsx": { figma: { url: "https://figma.com/design/ABC/?node-id=1-1" } },\n  },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-read', '--config', cfgPath, '--path', 'app/components/x.tsx'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /node-id=1-1/);
});

test('config-read exits 1 with empty stdout when path is not mapped', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-read', '--config', cfgPath, '--path', 'app/components/missing.tsx'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
});

test('config-reverse subcommand prints the path for a given URL', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n  components: {\n    "app/components/x.tsx": { figma: { url: "https://figma.com/design/ABC/?node-id=1-1" } },\n  },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-reverse', '--config', cfgPath, '--figma-url', 'https://figma.com/design/ABC/?node-id=1-1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /app\/components\/x\.tsx/);
});

test('config-reverse exits 1 with empty stdout when URL has no mapping', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-reverse', '--config', cfgPath, '--figma-url', 'https://figma.com/design/ABC/?node-id=9-9'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
});
```

- [ ] **Step 6: Verify cli tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/cli.test.js`
Expected: FAIL — cli.js does not exist.

- [ ] **Step 7: Implement `cli.js`**

`plugins/adhd/lib/pull-component/cli.js`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { readComponentMapping, addComponentMapping, reverseLookupPath } = require('./config-writer');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) { args[a.slice(2)] = argv[++i]; }
    else { args._.push(a); }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js config-write --config <adhd.config.ts> --path <relative-path> --figma-url <url>
  cli.js config-read --config <adhd.config.ts> --path <relative-path>
  cli.js config-reverse --config <adhd.config.ts> --figma-url <url>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];

  if (cmd === 'config-write') {
    if (!args.config || !args.path || !args['figma-url']) {
      console.error('Usage: config-write --config <path> --path <rel> --figma-url <url>');
      process.exit(2);
    }
    const source = fs.readFileSync(args.config, 'utf8');
    const out = addComponentMapping(source, args.path, args['figma-url']);
    fs.writeFileSync(args.config, out);
    process.exit(0);
  }

  if (cmd === 'config-read') {
    if (!args.config || !args.path) {
      console.error('Usage: config-read --config <path> --path <rel>');
      process.exit(2);
    }
    const source = fs.readFileSync(args.config, 'utf8');
    const r = readComponentMapping(source, args.path);
    if (!r) { process.exit(1); }
    process.stdout.write(r.figma.url);
    process.exit(0);
  }

  if (cmd === 'config-reverse') {
    if (!args.config || !args['figma-url']) {
      console.error('Usage: config-reverse --config <path> --figma-url <url>');
      process.exit(2);
    }
    const source = fs.readFileSync(args.config, 'utf8');
    const r = reverseLookupPath(source, args['figma-url']);
    if (!r) { process.exit(1); }
    process.stdout.write(r);
    process.exit(0);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
```

- [ ] **Step 8: Verify cli tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/cli.test.js`
Expected: 8 tests PASS.

- [ ] **Step 9: Add README**

`plugins/adhd/lib/pull-component/README.md`:

```markdown
# lib/pull-component

Deterministic config-writer for `/adhd:pull-component`. The skill itself
(at `plugins/adhd/skills/pull-component/SKILL.md`) is the orchestrator
and handles all the LLM-driven work — reading the React source,
extracting the Figma Component Set, computing the diff, prompting the
user, applying Edit-tool changes.

This library is intentionally tiny: it only contains the schema-level
mutation of `adhd.config.ts` (adding/reading component mappings under
`components.<path>.figma.url`). Anything more intelligent lives in
the SKILL prompt where the LLM can reason about it.

See `docs/superpowers/specs/2026-05-10-adhd-pull-component.md` for the
authoritative spec.
```

- [ ] **Step 10: Add CI step**

Edit `.github/workflows/ci.yml`. In the `lib-tests` job, after the existing `push-component` test step:

```yaml
      - name: Run pull-component tests
        run: node --test plugins/adhd/lib/pull-component/__tests__/
```

- [ ] **Step 11: Run all lib tests, verify green**

Run: `node --test plugins/adhd/lib/lint-engine/__tests__/ plugins/adhd/lib/design-system/__tests__/ plugins/adhd/lib/push-component/__tests__/ plugins/adhd/lib/pull-component/__tests__/`
Expected: all PASS, at least 17 new tests added.

- [ ] **Step 12: Commit**

```bash
git add plugins/adhd/lib/pull-component .github/workflows/ci.yml
git commit -m "Add lib/pull-component config-writer + CLI

Deterministic surface only: read/write components.<path>.figma.url
in adhd.config.ts. Everything intelligent (parsing the React source,
diffing against Figma, applying edits) lives in the SKILL prompt
where the LLM handles it. Brittle AST/regex approaches don't apply
when Claude Code is already in the orchestration loop."
```

---

## Task 2: SKILL.md — the LLM-driven orchestrator

**Files:**
- Create: `plugins/adhd/skills/pull-component/SKILL.md`

This is the brain. The prompt must be detailed enough that any Claude Code agent executes it the same way. Every invariant explicit.

- [ ] **Step 1: Write SKILL.md**

`plugins/adhd/skills/pull-component/SKILL.md`:

````markdown
---
description: "Pull a Figma Component Set into a React component source file. Inverse of /adhd:push-component. Updates only design-token lookup tables and union type members — function body, JSX, hooks, handlers, and imports are never modified. Reads adhd.config.ts and uses the mapping at components.<path>.figma.url. Pre-flight validates the Figma source using the same lint engine /adhd:lint uses; structural violations abort the pull."
disable-model-invocation: true
argument-hint: "<react-path | figma-url> [--allow-unbound]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Pull Component

Reconciles a Figma Component Set back into a React source file. The model (you) is the diff/apply engine: read both sides, compute the diff in working memory, prompt the user, apply edits via the Edit tool. Lookup tables and union types only — the function body is invariant.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-pull-component.md`

---

## Invariants (apply throughout)

1. **Function body untouched.** You may modify exported type aliases, the props interface, and top-level `Record<Union, string>` (or 2-axis) lookup table object literals. You must NOT modify the exported function declaration, its body, its JSX return, hooks, event handlers, or imports.
2. **Edit tool, not Write.** For updates, use `Edit` calls with `old_string` / `new_string`. Edit preserves whitespace, comments, and surrounding code by construction. Only use `Write` in scaffold mode (creating a new file).
3. **One Component Set per invocation.** If `node-id` resolves to anything else, abort.
4. **Read the spec when in doubt.** The spec at `docs/superpowers/specs/2026-05-10-adhd-pull-component.md` is the contract.

---

## Phase 1: Validate config

Use `Read` on `adhd.config.ts` (in the current working directory). Confirm `figma.url` is set. If the file is missing or `figma.url` is absent, abort:

> "Run /adhd:config first to set up ADHD."

Save the resolved file-level Figma URL and file key for later validation.

## Phase 2: Resolve target

Parse `$ARGUMENTS`. First positional is either a path (existing file, relative or absolute) or a Figma URL (starts with `https://`).

Detect `--allow-unbound` flag if present.

Use `Bash` to invoke the config-writer CLI for path/URL resolution:

```bash
# Path form:
node plugins/adhd/lib/pull-component/cli.js config-read \
  --config adhd.config.ts \
  --path "<relative-path>"
# Exit 0 with URL on stdout = update mode. Exit 1 = no mapping.

# URL form:
node plugins/adhd/lib/pull-component/cli.js config-reverse \
  --config adhd.config.ts \
  --figma-url "<url>"
# Exit 0 with path on stdout = update mode. Exit 1 = scaffold mode.
```

Branch:
- **Path form, mapping found:** `update` mode. Use the returned URL.
- **Path form, no mapping (exit 1):** abort with "No Figma mapping for `<path>`. Push it first with /adhd:push-component, or pass a Figma URL to scaffold."
- **URL form, mapping found:** `update` mode. Use the returned path.
- **URL form, no mapping:** `scaffold` mode. Use `AskUserQuestion` to ask: "Where should this component be created? (relative path from adhd.config.ts directory)". Validate via `Bash` that the path doesn't exist (`test ! -e <path>`); if it exists, abort.

Validate that the resolved Figma URL's file key matches `config.figma.url`'s file key (the segment between `/design/` and the next `/`). If different, abort with: "URL points at file `<X>`, but adhd.config.ts is configured for file `<Y>`."

Save resolved `{ mode, path, figmaUrl }` to working memory.

## Phase 2.5: Pre-flight lint

Extract the Figma node-id from the URL (`?node-id=A-B` → `A:B`). Use `mcp__plugin_figma_figma__use_figma` to:
1. Resolve the node by id; if not a `COMPONENT_SET` or top-level `COMPONENT`, abort: "Target node `<id>` is a `<type>`. Pull requires a Component Set."
2. Serialize the node's structural data (the same way /adhd:lint does for scoped mode — fields: `id, name, type, layoutMode, padding*, itemSpacing, cornerRadius, *Radius, fills, strokes, effects, boundVariables, componentPropertyDefinitions, variantProperties, textStyleId, effectStyleId, characters, fontSize, fontName`, recursing into children).
3. Collect the variable defs (walk boundVariables, look each up via `figma.variables.getVariableByIdAsync`, emit a `{ vars: { 'collection/name': value } }` map).

Save both via `Bash` heredoc to:
- `/tmp/adhd-pull-component/ctx.json`
- `/tmp/adhd-pull-component/vars.json`

Run the lint engine:

```bash
mkdir -p /tmp/adhd-pull-component
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd-pull-component/vars.json \
  --design-context /tmp/adhd-pull-component/ctx.json \
  --globals-css example/app/globals.css \
  --config adhd.config.ts \
  --target "PullComponent Preflight" \
  --target-url "<figma-url>" \
  --output /tmp/adhd-pull-component/preflight.md
```

Use the globals.css path from `config.cssEntry` if set, otherwise auto-detect: `example/app/globals.css` → `app/globals.css` → `src/app/globals.css`.

Use `Read` on `/tmp/adhd-pull-component/preflight.md`. Scan for STRUCT003/004/005 (variable-binding errors). Other rules' violations are noted for the final report but don't block.

**If variable-binding errors exist:**

Check whether the escape is active:
- `--allow-unbound` CLI flag, OR
- `components.<path>.allowUnboundFigma === true` in config (use `Bash` + a small `node -e` to inspect)

**Without escape:** abort with the helpful error, listing each offending layer:

```
✗ Cannot pull — the Figma Component Set has <N> unbound values:

  • <variant-path> > <layer-name> — raw <property> <value> (not a variable)
  ...

These need to be bound to design-system variables before we can pull. The designer can:
  1. Bind them in Figma (right-click the layer → "Apply variable")
  2. Or create new variables if these are new design tokens, then run
     /adhd:pull-design-system first, then re-run /adhd:pull-component

We don't generate arbitrary Tailwind classes like text-[20px] or h-[80px] in your
code — those would leak the design system the moment they shipped.
```

**With escape:** show the same list, then use `AskUserQuestion`:

```
⚠ The Figma Component Set has <N> unbound values:
  ...

If you continue, these will land in your code as ARBITRARY Tailwind classes (text-[10px], h-[80px]).
They will be marked with // adhd:off-system comments so they're greppable.
They WILL drift over time and break /adhd:push-component on the round-trip.

The right fix is to bind these in Figma. This escape is a pragmatic short-term path.

Continue? [Y] yes / [N] no (abort)
```

On `no` or no answer, abort. On `yes`, note which entries will be off-system; you'll prefix their applied values with the `// adhd:off-system — <reason>` comment in Phase 7.

## Phase 3: Read both sides

**React side (update mode only):** use `Read` on `<react-path>` (from Phase 2). Identify:
- The exported function component name (look for `export function <Name>(`).
- Exported `type X = "a" | "b" | ...` string-literal unions.
- The component's props interface (`<Name>Props`) — note which prop name maps to which union (e.g. `size?: AvatarSize` → axis `size` corresponds to union `AvatarSize`).
- Top-level `export const TABLE: Record<Union, string> = { ... }` and `Record<Outer, Record<Inner, string>>` lookup tables.

If the file lacks ALL of (exported function + props interface + at least one Record<Union, string> table), abort: "`<path>` doesn't follow the lookup-table convention. v1 requires it."

Write a brief structured summary of what you found to `/tmp/adhd-pull-component/local-summary.md` (for forensics and so the final report can reference it).

**Figma side:** use another `use_figma` call (separate from Phase 2.5's structural extract) that, for every variant in the Component Set, captures the resolved Tailwind class string for each design-token-bearing property on each named layer.

For each `boundVariables.fills[].id`, you have the variable's `name` (from Phase 2.5's `vars.json`). The mapping from variable name → Tailwind class is direct:
- `color/zinc/800` → `bg-zinc-800` (for a fill) or `text-zinc-800` (for a text color) — disambiguate by the layer/property context.
- `typography/text/xs` → `text-xs`.
- `radius/lg` → `rounded-lg`.
- `spacing/2` → `p-2` / `px-2` / etc. — context-dependent.

For unbound (raw) values, write the Tailwind arbitrary form: `bg-[#abcdef]`, `text-[10px]`, `rounded-[32px]`. These only appear if Phase 2.5's escape was used.

Save the result to `/tmp/adhd-pull-component/figma.json` with this shape (write it via `Bash` heredoc with the JSON you compose):

```json
{
  "componentSetId": "<id>",
  "componentName": "<name>",
  "variantAxes": { "size": ["xs","sm","md","lg","xl"], ... },
  "variants": [
    {
      "props": { "size": "lg", "shape": "circle", "status": "away" },
      "tokens": {
        "avatar-body.fill": "bg-zinc-800",
        "avatar-body.cornerRadius": "rounded-full",
        "initials.fontSize": "text-base",
        "initials.fill": "bg-zinc-100",
        "status-dot.fill": "bg-amber-500"
      }
    }
  ]
}
```

The `tokens` key is `<layer-name>.<property>`. Layer names come from Figma; properties are one of `fill`, `stroke`, `fontSize`, `cornerRadius`, `padding{Top,Right,Bottom,Left}`, `itemSpacing`, `effectStyle`.

Hash the JSON (for the Phase 6 drift check) and store the hash in working memory.

## Phase 4: Diff

In working memory, walk both sides and produce three buckets:

1. **`unionDiff`** — for each Figma `variantAxes` entry, compare its values to the corresponding local union. Record adds (Figma has, local doesn't) and removes (local has, Figma doesn't). Skip if no matching local union (becomes `unmapped`).

2. **`tableDiff`** — for each local lookup table:
   - Determine its axis (the union the Record is keyed by, mapped to a prop name via the props interface).
   - For each entry in the local table, find Figma variant(s) whose `props[axis]` matches the key.
   - The relevant Figma token is the one whose layer/property maps to this table's "thing." This requires knowing what the table affects — use the convention: `SIZE_BOX` and similar h-/w- tables describe the root element; `SIZE_TEXT` describes text size; `STATUS_COLOR` describes a status indicator's fill.
   - If the local class string differs from the Figma class string for the matched variant, record a cell diff entry.

3. **`unmapped`** — Figma axes with no matching local prop/union; local tables whose axis isn't in Figma.

Write a human-readable summary to `/tmp/adhd-pull-component/diff.md` so the final report can reference it. Keep the structured form in working memory for Phase 5/7.

If all three buckets are empty AND mode is `update`: print "No changes — Avatar is in sync with Figma." Skip to Phase 11 cleanup. Exit 0.

## Phase 5: Resolve divergences

Top-of-loop short-circuit via `AskUserQuestion` with these options:

```
Pull plan:
  • <N> union change(s)
  • <M> table(s) with cell changes
  • <K> unmapped Figma properties

How to proceed?
  [1] Apply ALL Figma values
  [2] Keep ALL local values (no-op — exits)
  [3] Review each
```

If `Apply ALL`: short-circuit — every unionDiff add accepted, every cell diff accepted (Figma wins). Skip the per-axis/per-table prompts and proceed to Phase 6.

If `Keep ALL`: skip to Phase 10 final report (nothing applied).

If `Review each`:

### 5a — Union changes (asked first)

For each `unionDiff` entry, ask via `AskUserQuestion`:

```
Variant axis `<axis>` differs:
  Local (<Union>):  <existing members>
  Figma:            <Figma members>

  [1] Add <new-value> to <Union> + cascade entries to all Record<<Union>, ...> tables
  [2] Skip — leave union as-is (table cells for this axis also skipped)
```

For removals:

```
Variant axis `<axis>` is missing values in Figma:
  Local:  ... | <removed-value>
  Figma:  ...

  [1] Remove `<removed-value>` from <Union> + all Record<<Union>, ...> entries
  [2] Skip — keep `<removed-value>` (you may have logic that uses it)
```

If the user skips an axis, mark it so Phase 5b's prompts for that axis are also skipped.

### 5b — Table cells

For each table in `tableDiff` (whose axis is NOT skipped from 5a), show:

```
<TABLE_NAME> (Record<<Union>, string>):

  <key>  local              figma
  ─────────────────────────────────
  ...
  ⚠ <K> changes.

  [1] Apply Figma's values to all <K> cells
  [2] Review each one
  [3] Keep all local values (skip this table)
```

`Review each one` → per-cell:

```
<TABLE_NAME>.<key>
  Local: <local>
  Figma: <figma>

  [1] Use Figma (<figma>)
  [2] Keep local (<local>)
```

### 5c — Unmapped (informational)

Print, no prompts:

```
ℹ Figma has <K> variant axis/axes with no matching Record<...> table in your code:

  • <axis> (Figma values: ...) — add `export type ...` and a Record table, then re-run.
```

Accumulate resolutions in working memory: which union members to add/remove, which cells to apply, which to keep.

## Phase 6: Drift check

Re-fetch the Figma CS via `use_figma`, re-serialize the variants+tokens shape (same script as Phase 3). Hash the JSON, compare to the Phase 3 hash. If different, abort:

> "Figma changed during pull. Re-run /adhd:pull-component."

## Phase 7: Apply

**Update mode:** for each resolution, use `Edit` on `<react-path>`:

- **Cell update** (`tableDiff` cell accepted): identify the property line in the relevant `Record<...>` table. `Edit` with `old_string` matching the line (including enough context to be unique — usually the key name itself suffices, but include the indent/value if needed), `new_string` with the new value. Preserve trailing comma.

  ```
  Edit:
    old_string: "  md: \"text-sm\","
    new_string: "  md: \"text-base\","
  ```

- **Union add** (`unionDiff` add accepted): two-step:
  1. `Edit` the type alias to include the new member. Example:
     ```
     old_string: "export type AvatarSize = \"xs\" | \"sm\" | \"md\" | \"lg\" | \"xl\";"
     new_string: "export type AvatarSize = \"xs\" | \"sm\" | \"md\" | \"lg\" | \"xl\" | \"xxl\";"
     ```
  2. For each `Record<<Union>, ...>` table in the file, `Edit` to insert a new entry. Find the closing brace and insert the new entry just before it, matching the existing indentation. For 2-axis tables, insert into each outer entry's inner Record.

  If a new value is off-system (Phase 2.5 escape was active for this property), prepend a `// adhd:off-system — <reason>` comment on its own line above the new entry.

- **Union remove** (`unionDiff` remove accepted):
  1. `Edit` the type alias to drop the member.
  2. For each `Record<<Union>, ...>` table, `Edit` to remove the corresponding entry (the property line including its trailing newline).

**Scaffold mode:** compose the new file with `Write`. Template:

```tsx
export type <Component>Size = "<v1>" | "<v2>" | ...;
// ...other axes

export interface <Component>Props {
  // axes from Figma variantAxes, optional
}

export const <COMPONENT>_<TABLE>: Record<<Component>Size, string> = {
  // entries from Figma tokens, one per variant value
};
// ...other tables

export function <Component>(/* props */) {
  return <span />; // adhd: scaffold stub — replace with your implementation
}
```

The function body is intentionally minimal. The user fills it in.

## Phase 8: Write mapping if scaffold mode

Only in `scaffold` mode:

```bash
node plugins/adhd/lib/pull-component/cli.js config-write \
  --config adhd.config.ts \
  --path "<new-relative-path>" \
  --figma-url "<figma-url>"
```

## Phase 9: Per-axis commit

Group applied resolutions by axis. For each axis with applied changes:

```bash
git add <react-path> [adhd.config.ts]
git commit -m "ADHD pull: <ComponentName>.<axis> (<N> changes)"
```

Zero applied changes → no commit. Multiple axes → multiple commits.

## Phase 10: Final report

```
✓ Pulled <ComponentName> from Figma:
  - <N> variant(s) added
  - <M> table cells updated
  - <K> cells kept local
  - <U> unmapped Figma properties
  - <O> off-system entries (use `git grep "adhd:off-system"` to find them)

Component file: <react-path>
Figma URL: <figma-url>
```

## Phase 11: Cleanup

Always runs (even on abort):

```bash
rm -rf /tmp/adhd-pull-component
```

---

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `No mapping for <path>` | Push it first: `/adhd:push-component <path>`. |
| `URL points at wrong file` | Open the configured file and copy a node URL from there. |
| `Pre-flight: <N> unbound values` | Bind values in Figma, or pass `--allow-unbound`. |
| `<react-path> doesn't follow the lookup-table convention` | This component uses inline classes or a non-Record pattern. v1 requires `Record<Union, string>` tables. |
| `Figma changed during pull` | Re-run `/adhd:pull-component`. |
| `Edit failed: text not found` | The expected text in the source didn't match. Re-read the file and adjust. |
````

- [ ] **Step 2: Validate SKILL frontmatter**

Run: `node scripts/validate-skill-frontmatter.js`
Expected: PASS — the validator checks the YAML shape; all required fields present.

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/pull-component/
git commit -m "Add /adhd:pull-component skill (LLM-driven orchestrator)

The skill is the brain: reads the React source, extracts the Figma
Component Set via use_figma, computes the diff in working memory,
prompts via AskUserQuestion, applies edits via the Edit tool. Every
invariant (function body untouched, off-system comment format,
abort conditions) is stated explicitly in the prompt.

Pre-flight reuses lint-engine via subprocess for STRUCT003/004/005
enforcement. Config mapping read/written via config-writer CLI."
```

---

## Task 3: push-component additive — write mapping on first push

**Files:**
- Modify: `plugins/adhd/skills/push-component/SKILL.md`

The push-component SKILL has phases 1-13. The mapping write goes between Phase 11 (Decide and finalize OR roll back) and Phase 12 (Final report). Only fires on the finalize path.

- [ ] **Step 1: Read push-component SKILL to confirm phase numbers**

Use `Read` on `plugins/adhd/skills/push-component/SKILL.md` to locate Phase 11 and Phase 12 headings.

- [ ] **Step 2: Insert new phase between 11 and 12**

Use `Edit` to add a new section just before the `## Phase 12: Final report` heading:

```markdown
## Phase 11.5: Write component mapping to adhd.config.ts

Only runs on the finalize path (skip on rollback — if the user chose roll back in Phase 11, the captured page is gone and there's no mapping to write).

Determine the relative path of the component file from the directory containing `adhd.config.ts`:

```bash
RELATIVE_PATH=$(node -e "
const path = require('path');
const cfgDir = path.dirname(path.resolve('adhd.config.ts'));
const comp = path.resolve('<component-path>');
process.stdout.write(path.relative(cfgDir, comp));
")
```

Build the Figma URL with the new page's node-id:

```bash
FIGMA_URL_BASE=$(node -e "
const { default: cfg } = require(require('path').resolve('adhd.config.ts'));
process.stdout.write(cfg.figma.url.replace(/\/?$/, '/'));
")
NODE_ID_ENCODED=$(echo "$PAGE_ID" | tr ':' '-')
FIGMA_URL="${FIGMA_URL_BASE}?node-id=${NODE_ID_ENCODED}"
```

Write the mapping (idempotent — re-pushing the same component does not duplicate the entry):

```bash
node plugins/adhd/lib/pull-component/cli.js config-write \
  --config adhd.config.ts \
  --path "$RELATIVE_PATH" \
  --figma-url "$FIGMA_URL"
```

This records the mapping so subsequent `/adhd:pull-component <path>` or `/adhd:pull-component <figma-url>` invocations can find each other. In v2, push will use this mapping to update the same Component Set instead of creating a new page each time.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/push-component/SKILL.md
git commit -m "push-component: write components mapping to adhd.config.ts on finalize"
```

---

## Task 4: README + marketplace updates

**Files:**
- Modify: `README.md`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update README command table**

Use `Read` on `README.md`. Locate the command table (around lines 19-28) and the "five slash commands" phrase.

Use `Edit` to change `After install, five slash commands are available:` → `After install, six slash commands are available:`.

Use `Edit` to add a row to the command table after the `/adhd:push-component` row (use enough context to make the Edit unique — match on a few lines around the insertion point):

```
| `/adhd:pull-component` | `<path \| figma-url> [--allow-unbound]` | Figma → code | Pulls a Figma Component Set into a React source file; updates lookup tables and union types only (function body untouched) |
```

- [ ] **Step 2: Add "Pull a component" subsection**

Use `Edit` to add (after the existing "Push a component" subsection):

```markdown
### Pull a component

```
# From the consumer repo, with a mapping already established by /adhd:push-component:
/adhd:pull-component app/components/avatar/index.tsx

# Or by Figma URL — reverse-resolves to the path via adhd.config.ts:
/adhd:pull-component https://www.figma.com/design/<KEY>?node-id=91-18

# Pre-flight is strict by default — if Figma has unbound raw values, pull aborts and asks the designer to bind them.
# To accept hardcoded fallbacks anyway (with adhd:off-system comments for greppability):
/adhd:pull-component app/components/avatar/index.tsx --allow-unbound
```

The skill reads the Figma Component Set, diffs it against the React file's `Record<Union, string>` lookup tables, prompts on each divergence, and rewrites only those tables (plus union type members). Function body, JSX, hooks, handlers, and imports are never modified.
```

- [ ] **Step 3: Update marketplace.json**

Use `Read` on `.claude-plugin/marketplace.json` to see current description. Use `Edit` to update the `adhd` plugin's description string to reflect 6 commands (preserve the existing phrasing style).

- [ ] **Step 4: Commit**

```bash
git add README.md .claude-plugin/marketplace.json
git commit -m "README + marketplace: document /adhd:pull-component"
```

---

## Task 5: Final verification + PR

- [ ] **Step 1: Run all lib tests**

```bash
node --test plugins/adhd/lib/lint-engine/__tests__/ \
              plugins/adhd/lib/design-system/__tests__/ \
              plugins/adhd/lib/push-component/__tests__/ \
              plugins/adhd/lib/pull-component/__tests__/
```

Expected: all PASS. Confirm count ≥ 268 (251 baseline + ~17 new from config-writer + cli tests).

- [ ] **Step 2: Run the SKILL frontmatter validator**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: PASS — all six SKILL.md files validated.

- [ ] **Step 3: Build the example app to sanity-check**

```bash
cd example && npm run build && cd ..
```

Expected: compile clean.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin adhd/pull-component
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "Add /adhd:pull-component skill" --body "$(cat <<'EOF'
## Summary

Adds `/adhd:pull-component <react-path | figma-url>` — pulls a Figma Component Set back into a React source file. Inverse direction of `/adhd:push-component`. Updates only design-token lookup tables (`Record<Union, string>`) and union type aliases — function body, JSX, hooks, handlers, and imports are never touched.

## Architecture: LLM as the diff/apply engine

This skill runs inside Claude Code, so the LLM is already in the orchestration loop. It reads the React source, extracts the Figma Component Set via `use_figma`, computes the diff in working memory, prompts the user via `AskUserQuestion`, and applies changes via `Edit` tool calls. Traditional code is reserved for the deterministic, testable parts:

- **`lib/pull-component/config-writer.js`** — reads & idempotently writes `components.<path>.figma.url` in `adhd.config.ts`. ~150 lines + 9 unit tests.
- **`lint-engine`** (existing, reused) — pre-flight runs the same `checkStructure` that `/adhd:lint` uses.
- **SKILL.md** — the 11-phase orchestrator that handles all the intelligent work via Read/use_figma/AskUserQuestion/Edit.

The first draft of this plan had `parse-react.js` / `differ.js` / `apply.js` modules. User gut-checked: "Claude Code is the reason we're doing this code gen. I want the intelligence of Claude Code to know how to diff this stuff. I don't want to use rigid, brittle code to do it when we have a full beautiful LLM to do it." Brittle AST manipulation was the wrong abstraction. The revised design pushes intelligence into the SKILL prompt where it belongs.

## Pipeline

1. Validate config
2. Resolve target (path / URL / scaffold mode)
3. Pre-flight lint of the Figma Component Set (same lint-engine as /adhd:lint)
4. Read React source + extract Figma variants
5. Diff (in working memory)
6. Prompt per-divergence
7. Drift check
8. Apply via Edit tool calls
9. Write component mapping if scaffold mode
10. Per-axis commit
11. Cleanup

## Key design

- **The React file IS the snapshot** — no parallel state stored in the repo. Lookup tables already encode every design-token value Figma cares about.
- **Bidirectional mapping** in `adhd.config.ts` under `components.<path>.figma.url`. Written by push on first push (Phase 11.5 added to push-component), by pull on first scaffold.
- **Symmetric pre-flight**: STRUCT003/004/005 violations on the Figma side block the pull. Designer-side variable discipline enforced in both directions.
- **Escape hatch**: `--allow-unbound` (or `allowUnboundFigma: true` in config) converts the abort to a confirm-prompt. Off-system entries land in code with `// adhd:off-system` comments — greppable, self-healing on future pulls.
- **Function body invariant**: the SKILL prompt explicitly tells Claude not to touch function declarations, function bodies, JSX, hooks, handlers, or imports.

## Out of scope (v1)

- JSX / function body changes — manual only
- Multi-component pulls in one command
- Components without the `Record<Union, string>` lookup-table convention (reported and aborted)

## Test plan

- [x] config-writer unit tests (9): idempotent add, append-to-existing, update-url, reverse lookup, etc.
- [x] cli surface tests (8): all subcommands, error paths
- [x] SKILL frontmatter validated
- [x] Example app builds clean
- [ ] Manual smoke test: pull-component against the merged-main Avatar component → 0 changes (in sync); manual Figma edit → 1-cell diff → applied → committed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: Verify CI is green**

```bash
sleep 30 && gh pr checks $(gh pr view --json number -q .number)
```

Expected: all checks pass.

---

## Self-review notes

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Final command surface | Task 2 (SKILL.md), Task 4 (README) |
| What lives in code vs. SKILL | Task 1 (lib), Task 2 (SKILL) |
| Pipeline Phases 1-11 | Task 2 |
| Pre-flight escape hatch | Task 2 |
| Config schema additions | Task 1 (config-writer), Task 3 (push-component additive), Task 4 (README) |
| Module layout | Task 1 |
| Edge cases | Task 2 (Common errors table) |
| Acceptance criteria 1-18 | Tasks 1-5 across the board |

No gaps.

**Type / signature consistency:**

- `readComponentMapping(source, relPath)` → `{ figma: { url } } | null` — Tasks 1, 2
- `reverseLookupPath(source, figmaUrl)` → `relPath | null` — Tasks 1, 2
- `addComponentMapping(source, relPath, figmaUrl)` → newSource — Tasks 1, 2, 3
- CLI exits: 0 on success, 1 on "not found" (config-read/reverse), 2 on usage error — consistent

**Placeholder scan:**

Searched for TODO/TBD/FIXME — only legitimate hits are inside markdown code blocks showing intentional placeholders for user customization (e.g. `// adhd: scaffold stub — replace with your implementation`). No actual plan placeholders.
