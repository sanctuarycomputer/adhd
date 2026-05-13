# /adhd:push-design-system, /adhd:pull-design-system, and whole-file /adhd:lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DTCG/TokensBrücke flow with two direct push/pull commands powered by the Figma remote MCP's `use_figma` tool. Expand `/adhd:lint` to lint the whole file in one run.

**Architecture:** A new `plugins/adhd/lib/design-system/` library parses both sides into a canonical `DesignSystem` shape, compares them, and produces conflict / code-only / figma-only lists. Skills orchestrate: call `use_figma` to read Figma state, run the engine CLI, prompt the user via `AskUserQuestion`, then call `use_figma` again to write back. The old `lib/to-dtcg/` and the `to-dtcg` / `export-for-figma` skills are deleted entirely. `lib/lint-engine/` is kept and expanded for whole-file mode.

**Tech Stack:** Node 20+ (zero deps, matches existing libs), `node:test` for unit tests, Claude Code skills for user-facing commands, the official Figma MCP plugin (`figma@claude-plugins-official`) which exposes `use_figma`.

**Spec:** `docs/superpowers/specs/2026-05-10-adhd-push-pull-design-system.md`

---

## File structure

### New files

```
plugins/adhd/lib/design-system/
├── README.md
├── cli.js                              # orchestrator
├── code-parser.js                      # globals.css → DesignSystem (lifts logic from lint-engine/theme-parser.js)
├── code-writer.js                      # DesignSystem → globals.css edits
├── figma-parser.js                     # use_figma extract result → DesignSystem
├── figma-extract-script.js             # exports the JS string we feed to use_figma to read Figma state
├── figma-write-actions.js              # builds an "actions" array from resolved diff (consumed by figma-write-script)
├── figma-write-script.js               # exports JS string we feed to use_figma to apply actions
├── comparator.js                       # same / conflict / code-only / figma-only
└── __tests__/
    ├── code-parser.test.js
    ├── code-writer.test.js
    ├── figma-parser.test.js
    ├── comparator.test.js
    ├── figma-write-actions.test.js
    └── cli.test.js

plugins/adhd/skills/push-design-system/SKILL.md
plugins/adhd/skills/pull-design-system/SKILL.md
```

### Modified files

```
plugins/adhd/skills/lint/SKILL.md              # whole-file mode + use_figma extraction + sharper errors
plugins/adhd/lib/lint-engine/cli.js            # accept array-of-nodes for whole-file mode
plugins/adhd/lib/lint-engine/report-formatter.js  # group by page → top-level node
plugins/adhd/lib/lint-engine/variable-categorizer.js  # add "missing tokens" hint pointing at /adhd:pull-design-system
.github/workflows/ci.yml                        # drop to-dtcg test step; add design-system step
README.md                                       # command table reflects push / pull / lint
example/.gitignore                              # add adhd-push-result.json, adhd-pull-result.json
```

### Deleted files

```
plugins/adhd/lib/to-dtcg/                       # entire library
plugins/adhd/skills/to-dtcg/                    # whole skill
plugins/adhd/skills/export-for-figma/           # whole skill
plugins/adhd/skills/sync/                       # renamed to pull-design-system (Task 13 git-mvs the dir)
```

---

## Task 1: Delete to-dtcg + export-for-figma

**Files:**
- Delete: `plugins/adhd/lib/to-dtcg/`
- Delete: `plugins/adhd/skills/to-dtcg/`
- Delete: `plugins/adhd/skills/export-for-figma/`

- [ ] **Step 1: Confirm the lint-engine doesn't import from to-dtcg**

```bash
grep -r "to-dtcg" plugins/adhd/lib/lint-engine/
```
Expected: no matches. (lint-engine has its own value-normalizer; no shared module.)

- [ ] **Step 2: Delete the directories**

```bash
git rm -r plugins/adhd/lib/to-dtcg plugins/adhd/skills/to-dtcg plugins/adhd/skills/export-for-figma
```

- [ ] **Step 3: Verify nothing else references them**

```bash
git grep "to-dtcg\|export-for-figma" -- ':!docs/' ':!*.md' && echo "leftover refs found, fix them"
```
Expected: no matches outside docs/.

- [ ] **Step 4: Update CI workflow**

Edit `.github/workflows/ci.yml`. Find the `Run to-dtcg tests` step and remove it. Keep the `Run lint-engine tests` step. The job stays named "lib unit tests".

```yaml
      - name: Run lint-engine tests
        run: node --test plugins/adhd/lib/lint-engine/__tests__/
```

- [ ] **Step 5: Frontmatter validator should now show 3 skills**

```bash
node scripts/validate-skill-frontmatter.js
```
Expected: 3/3 valid (config, lint, sync). The to-dtcg and export-for-figma skills are gone.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Delete to-dtcg lib + to-dtcg/export-for-figma skills (replaced by direct use_figma sync)"
```

---

## Task 2: Scaffold lib/design-system/ + smoke test

**Files:**
- Create: `plugins/adhd/lib/design-system/cli.js`
- Create: `plugins/adhd/lib/design-system/__tests__/cli.test.js`
- Create: `plugins/adhd/lib/design-system/README.md`

- [ ] **Step 1: Create the CLI scaffolding**

Write `plugins/adhd/lib/design-system/cli.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * ADHD design-system CLI.
 *
 * Modes:
 *   compare  — read both sides, output { same, conflict, codeOnly, figmaOnly } as JSON
 *   apply    — read a resolved-actions JSON, output the write-script payload
 *
 * Inputs depend on mode; see --help.
 */

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage:
  cli.js compare --code <globals.css> --figma <figma.json> --output <diff.json>
  cli.js apply   --diff <diff.json> --resolutions <resolutions.json> --direction <push|pull> --output <actions.json>`);
    process.exit(0);
  }
  console.error('design-system: not implemented yet');
  process.exit(2);
}

main();
```

- [ ] **Step 2: Write the smoke test**

Write `plugins/adhd/lib/design-system/__tests__/cli.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints usage and exits 0', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /compare/);
  assert.match(result.stdout, /apply/);
});

test('cli with no args exits 2 with not-implemented message', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not implemented/);
});
```

- [ ] **Step 3: Run the test**

```bash
node --test plugins/adhd/lib/design-system/__tests__/cli.test.js
```
Expected: 2 tests passing.

- [ ] **Step 4: Add a brief README**

Write `plugins/adhd/lib/design-system/README.md`:

```markdown
# design-system

Pure-JS engine that powers `/adhd:push-design-system` and
`/adhd:pull-design-system`. Parses both sides (globals.css and Figma
variables) into a canonical `DesignSystem` shape, compares them, and
emits conflict reports / write actions.

## Architecture

- `code-parser.js` — globals.css → DesignSystem
- `figma-parser.js` — use_figma extract result → DesignSystem
- `comparator.js` — { same, conflict, codeOnly, figmaOnly }
- `code-writer.js` — DesignSystem → globals.css edits
- `figma-write-actions.js` — resolved diff → action list
- `figma-extract-script.js` — JS to inject into use_figma to read state
- `figma-write-script.js` — JS to inject into use_figma to apply actions
- `cli.js` — orchestrator

## Tests

```bash
node --test plugins/adhd/lib/design-system/__tests__/
```
```

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/design-system/
git commit -m "Scaffold lib/design-system with smoke-test CLI"
```

---

## Task 3: code-parser.js — globals.css → DesignSystem

The `DesignSystem` shape is the canonical form both sides translate to.

**Files:**
- Create: `plugins/adhd/lib/design-system/code-parser.js`
- Test: `plugins/adhd/lib/design-system/__tests__/code-parser.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/design-system/__tests__/code-parser.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCodeDesignSystem } = require('../code-parser');

test('parses primitives from @theme {} as default-mode literals', () => {
  const ds = parseCodeDesignSystem(`
    @theme {
      --color-gold-100: #faf0c5;
      --color-gold-900: #3f2909;
    }
  `);
  const gold100 = ds.tokens.find(t => t.path === 'gold/100' && t.domain === 'color');
  assert.ok(gold100);
  assert.deepEqual(gold100.values.default, { type: 'literal', value: '#faf0c5' });
  const gold900 = ds.tokens.find(t => t.path === 'gold/900' && t.domain === 'color');
  assert.deepEqual(gold900.values.default, { type: 'literal', value: '#3f2909' });
});

test('parses :root semantic vars as light-mode literals', () => {
  const ds = parseCodeDesignSystem(`
    :root {
      --background: #ffffff;
      --foreground: #171717;
    }
  `);
  const bg = ds.tokens.find(t => t.path === 'background');
  assert.ok(bg);
  assert.deepEqual(bg.values.light, { type: 'literal', value: '#ffffff' });
});

test('parses @media (prefers-color-scheme: dark) :root {} as dark-mode', () => {
  const ds = parseCodeDesignSystem(`
    :root { --background: #ffffff; }
    @media (prefers-color-scheme: dark) {
      :root { --background: #0a0a0a; }
    }
  `);
  const bg = ds.tokens.find(t => t.path === 'background');
  assert.deepEqual(bg.values.light, { type: 'literal', value: '#ffffff' });
  assert.deepEqual(bg.values.dark,  { type: 'literal', value: '#0a0a0a' });
});

test('parses :root[data-theme="dark"] as dark-mode (alternative form)', () => {
  const ds = parseCodeDesignSystem(`
    :root { --background: #ffffff; }
    :root[data-theme="dark"] { --background: #0a0a0a; }
  `);
  const bg = ds.tokens.find(t => t.path === 'background');
  assert.deepEqual(bg.values.light, { type: 'literal', value: '#ffffff' });
  assert.deepEqual(bg.values.dark,  { type: 'literal', value: '#0a0a0a' });
});

test('var(--x) references become aliases', () => {
  const ds = parseCodeDesignSystem(`
    :root {
      --brand-surface: var(--color-gold-100);
    }
    @media (prefers-color-scheme: dark) {
      :root { --brand-surface: var(--color-gold-900); }
    }
  `);
  const t = ds.tokens.find(x => x.path === 'brand/surface');
  assert.deepEqual(t.values.light, { type: 'alias', target: 'gold/100' });
  assert.deepEqual(t.values.dark,  { type: 'alias', target: 'gold/900' });
});

test('@theme inline entries land in ds.exposure, not ds.tokens', () => {
  const ds = parseCodeDesignSystem(`
    :root { --brand-surface: var(--color-gold-100); }
    @theme inline {
      --color-brand-surface: var(--brand-surface);
    }
  `);
  // Token lives in tokens (it has its own value)
  assert.ok(ds.tokens.find(t => t.path === 'brand/surface'));
  // Exposure is a separate metadata layer
  assert.ok(ds.exposure.find(e => e.cssVar === '--color-brand-surface' && e.target === 'brand-surface'));
  // Token list does NOT contain the exposure-only var
  assert.equal(ds.tokens.find(t => t.path === 'color/brand/surface'), undefined);
});

test('infers domain from variable name prefix', () => {
  const ds = parseCodeDesignSystem(`
    @theme {
      --color-x: red;
      --space-2: 8px;
      --radius-sm: 4px;
      --shadow-md: 0 1px 2px rgba(0,0,0,0.1);
    }
  `);
  const byPath = Object.fromEntries(ds.tokens.map(t => [t.path, t.domain]));
  assert.equal(byPath['x'], 'color');
  assert.equal(byPath['2'], 'spacing');
  assert.equal(byPath['sm'], 'radius');
  assert.equal(byPath['md'], 'shadow');
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
node --test plugins/adhd/lib/design-system/__tests__/code-parser.test.js
```
Expected: failures with "Cannot find module '../code-parser'".

- [ ] **Step 3: Implement code-parser.js**

Create `plugins/adhd/lib/design-system/code-parser.js`:

```js
'use strict';

const fs = require('node:fs');

const VAR_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
const VAR_REF_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)/;

function findBlock(css, openRe) {
  const m = openRe.exec(css);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  return { start, end: i, body: css.slice(start, i), after: i + 1 };
}

function findAllBlocks(css, openRe) {
  const out = [];
  const re = new RegExp(openRe.source, 'g');
  let m;
  while ((m = re.exec(css)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    out.push({ start, end: i, body: css.slice(start, i) });
    re.lastIndex = i + 1;
  }
  return out;
}

function parseEntries(body) {
  const out = {};
  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(body)) !== null) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function inferDomain(cssVarName) {
  const stripped = cssVarName.replace(/^--/, '');
  if (stripped.startsWith('color-')) return 'color';
  if (stripped.startsWith('space-')) return 'spacing';
  if (stripped.startsWith('radius-')) return 'radius';
  if (stripped.startsWith('shadow-')) return 'shadow';
  if (stripped.startsWith('font-')) return 'typography';
  // Heuristic for semantic colors that don't have a "color-" prefix
  if (/^(background|foreground|brand|surface|text|border|accent)/i.test(stripped)) return 'color';
  return 'unknown';
}

function pathFromCssVar(cssVarName) {
  // --color-gold-100 → gold/100
  // --brand-surface → brand/surface
  // --space-2 → 2
  const stripped = cssVarName.replace(/^--/, '');
  const domain = inferDomain(cssVarName);
  const domainPrefix = {
    color: 'color-', spacing: 'space-', radius: 'radius-', shadow: 'shadow-', typography: 'font-',
  }[domain];
  let rest = stripped;
  if (domainPrefix && stripped.startsWith(domainPrefix)) {
    rest = stripped.slice(domainPrefix.length);
  }
  return rest.replace(/-/g, '/');
}

function valueFromString(raw) {
  const trimmed = raw.trim();
  const refMatch = VAR_REF_RE.exec(trimmed);
  if (refMatch) {
    return { type: 'alias', target: pathFromCssVar(refMatch[1]) };
  }
  return { type: 'literal', value: trimmed };
}

function findExtractedDarkBlocks(css) {
  // Extract @media (prefers-color-scheme: dark) { :root { ... } } bodies
  const out = [];
  const mediaRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  let m;
  while ((m = mediaRe.exec(css)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const inner = css.slice(start, i);
    const rootInner = findAllBlocks(inner, /:root\s*\{/);
    for (const blk of rootInner) out.push(blk.body);
    mediaRe.lastIndex = i + 1;
  }
  return out;
}

function parseCodeDesignSystem(css) {
  // Source can be a path or raw CSS — autodetect.
  let source = css;
  if (typeof css === 'string' && css.length < 1024 && fs.existsSync(css)) {
    source = fs.readFileSync(css, 'utf8');
  }
  if (typeof source !== 'string') {
    throw new TypeError('parseCodeDesignSystem expects a CSS string or a file path');
  }

  const tokens = new Map(); // path → token

  const upsert = (cssVar, mode, valueRaw) => {
    const path = pathFromCssVar(cssVar);
    const domain = inferDomain(cssVar);
    if (domain === 'unknown') return;
    if (!tokens.has(path)) {
      tokens.set(path, { domain, path, values: {}, cssVar });
    }
    tokens.get(path).values[mode] = valueFromString(valueRaw);
  };

  // 1. @theme {} (NOT @theme inline)
  // We need to find `@theme {` but NOT match `@theme inline {`.
  // Strategy: find all `@theme` openings, ignore inline ones.
  const themeOpenRe = /@theme(\s+inline)?\s*\{/g;
  let m;
  while ((m = themeOpenRe.exec(source)) !== null) {
    const isInline = !!m[1];
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const body = source.slice(start, i);
    if (isInline) {
      // Skip — handled below
    } else {
      const entries = parseEntries(body);
      for (const [cssVar, raw] of Object.entries(entries)) {
        upsert(cssVar, 'default', raw);
      }
    }
    themeOpenRe.lastIndex = i + 1;
  }

  // 2. :root {} blocks NOT inside @media (prefers-color-scheme: dark)
  // Strategy: blank out the dark @media block bodies, then look for :root {}.
  const darkBlocks = findExtractedDarkBlocks(source);
  let codeWithoutDark = source;
  // Remove the dark media wrappers so we can find non-dark :root {} blocks
  codeWithoutDark = source.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[\s\S]*?\}\s*\}/g, '');
  // Also remove [data-theme="dark"] :root blocks for the light pass
  codeWithoutDark = codeWithoutDark.replace(/:root\[data-theme=["']dark["']\]\s*\{[^}]*\}/g, '');
  const lightRoots = findAllBlocks(codeWithoutDark, /:root\s*\{/);
  for (const blk of lightRoots) {
    const entries = parseEntries(blk.body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'light', raw);
    }
  }

  // 3. Dark blocks (both forms)
  for (const body of darkBlocks) {
    const entries = parseEntries(body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'dark', raw);
    }
  }
  const dataThemeDark = findAllBlocks(source, /:root\[data-theme=["']dark["']\]\s*\{/);
  for (const blk of dataThemeDark) {
    const entries = parseEntries(blk.body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'dark', raw);
    }
  }

  // 4. @theme inline {} → exposure layer
  const exposure = [];
  const themeOpenRe2 = /@theme\s+inline\s*\{/g;
  while ((m = themeOpenRe2.exec(source)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const body = source.slice(start, i);
    const entries = parseEntries(body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      const refMatch = VAR_REF_RE.exec(raw);
      if (refMatch) {
        // exposure-only, alias to existing var
        exposure.push({
          cssVar,
          target: refMatch[1].replace(/^--/, ''),
        });
      }
      // else ignore (raw values in @theme inline are unusual)
    }
    themeOpenRe2.lastIndex = i + 1;
  }

  return { tokens: Array.from(tokens.values()), exposure };
}

module.exports = { parseCodeDesignSystem, pathFromCssVar, inferDomain };
```

- [ ] **Step 4: Run tests**

```bash
node --test plugins/adhd/lib/design-system/__tests__/code-parser.test.js
```
Expected: all 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/design-system/code-parser.js plugins/adhd/lib/design-system/__tests__/code-parser.test.js
git commit -m "Add code-parser for globals.css → DesignSystem"
```

---

## Task 4: figma-extract-script.js + figma-parser.js

The extract script is a JS string we feed to `use_figma`. The parser converts the result into a `DesignSystem`.

**Files:**
- Create: `plugins/adhd/lib/design-system/figma-extract-script.js`
- Create: `plugins/adhd/lib/design-system/figma-parser.js`
- Test: `plugins/adhd/lib/design-system/__tests__/figma-parser.test.js`

- [ ] **Step 1: Write the extract script**

Create `plugins/adhd/lib/design-system/figma-extract-script.js`:

```js
'use strict';

/**
 * JS string injected into use_figma. Returns the full design-system
 * state of the file: every variable in every collection (with its
 * per-mode values), every effect style, every text style.
 */
const EXTRACT_SCRIPT = `
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const colOut = [];
for (const c of collections) {
  const modes = c.modes.map(m => ({ id: m.modeId, name: m.name }));
  const vars = [];
  for (const vid of c.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (!v) continue;
    const valuesByMode = {};
    for (const m of c.modes) {
      const raw = v.valuesByMode[m.modeId];
      if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
        const target = await figma.variables.getVariableByIdAsync(raw.id);
        valuesByMode[m.name] = { kind: 'alias', targetName: target ? target.name : null, targetId: raw.id };
      } else if (raw && typeof raw === 'object' && 'r' in raw) {
        valuesByMode[m.name] = { kind: 'color', r: raw.r, g: raw.g, b: raw.b, a: 'a' in raw ? raw.a : 1 };
      } else {
        valuesByMode[m.name] = { kind: 'literal', value: raw };
      }
    }
    vars.push({
      id: v.id, name: v.name, resolvedType: v.resolvedType,
      scopes: v.scopes, valuesByMode,
    });
  }
  colOut.push({ id: c.id, name: c.name, modes, variables: vars });
}

const effectStyles = (await figma.getLocalEffectStylesAsync()).map(s => ({
  id: s.id, name: s.name, effects: s.effects,
}));
const textStyles = (await figma.getLocalTextStylesAsync()).map(s => ({
  id: s.id, name: s.name,
  fontName: s.fontName, fontSize: s.fontSize,
  lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
}));

return { collections: colOut, effectStyles, textStyles };
`;

module.exports = { EXTRACT_SCRIPT };
```

- [ ] **Step 2: Write the parser tests**

Create `plugins/adhd/lib/design-system/__tests__/figma-parser.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFigmaDesignSystem } = require('../figma-parser');

const EXTRACT_FIXTURE = {
  collections: [
    {
      id: 'VariableCollectionId:1', name: 'color',
      modes: [{ id: 'M1', name: 'Light' }, { id: 'M2', name: 'Dark' }],
      variables: [
        {
          id: 'V1', name: 'gold/100', resolvedType: 'COLOR',
          scopes: ['FRAME_FILL'],
          valuesByMode: {
            Light: { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
            Dark:  { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
          },
        },
        {
          id: 'V2', name: 'brand/surface', resolvedType: 'COLOR',
          scopes: ['FRAME_FILL'],
          valuesByMode: {
            Light: { kind: 'alias', targetName: 'gold/100', targetId: 'V1' },
            Dark:  { kind: 'alias', targetName: 'gold/900', targetId: 'V99' },
          },
        },
      ],
    },
  ],
  effectStyles: [
    {
      id: 'S1', name: 'shadow-2xs',
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.05 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true, blendMode: 'NORMAL' }],
    },
  ],
  textStyles: [],
};

test('produces tokens with light/dark literals from primitive variables', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'gold/100');
  assert.ok(t);
  assert.equal(t.domain, 'color');
  assert.equal(t.values.light.type, 'literal');
  assert.match(t.values.light.value, /^#[0-9a-f]{6}$/i);
});

test('alias values map to alias type with target path', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'brand/surface');
  assert.deepEqual(t.values.light, { type: 'alias', target: 'gold/100' });
  assert.deepEqual(t.values.dark,  { type: 'alias', target: 'gold/900' });
});

test('treats single-mode collections as default', () => {
  const ds = parseFigmaDesignSystem({
    collections: [{
      id: 'C', name: 'spacing',
      modes: [{ id: 'M', name: 'Mode 1' }],
      variables: [{
        id: 'V', name: '4', resolvedType: 'FLOAT', scopes: ['GAP'],
        valuesByMode: { 'Mode 1': { kind: 'literal', value: 16 } },
      }],
    }],
    effectStyles: [], textStyles: [],
  });
  const t = ds.tokens.find(x => x.path === '4');
  assert.equal(t.domain, 'spacing');
  assert.equal(t.values.default.type, 'literal');
});

test('infers domain from collection name', () => {
  const ds = parseFigmaDesignSystem({
    collections: [
      { id: 'A', name: 'spacing', modes: [{id:'X',name:'Mode 1'}], variables: [{id:'V1',name:'4',resolvedType:'FLOAT',scopes:[],valuesByMode:{'Mode 1':{kind:'literal',value:16}}}] },
      { id: 'B', name: 'radius',  modes: [{id:'Y',name:'Mode 1'}], variables: [{id:'V2',name:'sm',resolvedType:'FLOAT',scopes:[],valuesByMode:{'Mode 1':{kind:'literal',value:4}}}] },
    ],
    effectStyles: [], textStyles: [],
  });
  const byPath = Object.fromEntries(ds.tokens.map(t => [t.path, t.domain]));
  assert.equal(byPath['4'], 'spacing');
  assert.equal(byPath['sm'], 'radius');
});

test('color values normalize to 6-digit lowercase hex', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'gold/100');
  assert.equal(t.values.light.value.length, 7); // # + 6 hex chars
  assert.equal(t.values.light.value, t.values.light.value.toLowerCase());
});

test('effect styles and text styles surface as ds.styles', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  assert.equal(ds.styles.effects.length, 1);
  assert.equal(ds.styles.effects[0].name, 'shadow-2xs');
  assert.equal(ds.styles.text.length, 0);
});
```

- [ ] **Step 3: Run tests, confirm failure**

```bash
node --test plugins/adhd/lib/design-system/__tests__/figma-parser.test.js
```

- [ ] **Step 4: Implement figma-parser.js**

Create `plugins/adhd/lib/design-system/figma-parser.js`:

```js
'use strict';

function colorToHex({ r, g, b, a }) {
  const to2 = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  let hex = '#' + to2(r) + to2(g) + to2(b);
  if (a !== undefined && a < 1) hex += to2(a);
  return hex.toLowerCase();
}

function inferDomain(collectionName) {
  const n = collectionName.toLowerCase();
  if (n === 'color')      return 'color';
  if (n === 'spacing')    return 'spacing';
  if (n === 'radius')     return 'radius';
  if (n === 'shadow')     return 'shadow';
  if (n === 'typography') return 'typography';
  return 'unknown';
}

function modeNameToCanonical(figmaModeName, isMultiMode) {
  if (!isMultiMode) return 'default';
  const lc = figmaModeName.toLowerCase();
  if (lc === 'light') return 'light';
  if (lc === 'dark')  return 'dark';
  return lc;
}

function valueFromFigma(rawByMode) {
  if (rawByMode.kind === 'alias') {
    return { type: 'alias', target: rawByMode.targetName ?? '<unknown>' };
  }
  if (rawByMode.kind === 'color') {
    return { type: 'literal', value: colorToHex(rawByMode) };
  }
  if (rawByMode.kind === 'literal') {
    const v = rawByMode.value;
    if (typeof v === 'number') return { type: 'literal', value: String(v) + 'px' };
    return { type: 'literal', value: String(v) };
  }
  return { type: 'literal', value: String(rawByMode) };
}

function parseFigmaDesignSystem(extract) {
  const tokens = [];
  for (const col of extract.collections) {
    const domain = inferDomain(col.name);
    if (domain === 'unknown') continue;
    const isMultiMode = col.modes.length > 1;
    for (const v of col.variables) {
      const values = {};
      for (const [modeName, rawByMode] of Object.entries(v.valuesByMode)) {
        const canonical = modeNameToCanonical(modeName, isMultiMode);
        values[canonical] = valueFromFigma(rawByMode);
      }
      tokens.push({
        domain,
        path: v.name,
        values,
        figmaId: v.id,
        scopes: v.scopes,
      });
    }
  }

  return {
    tokens,
    exposure: [], // Figma has no exposure concept
    styles: {
      effects: extract.effectStyles ?? [],
      text:    extract.textStyles ?? [],
    },
  };
}

module.exports = { parseFigmaDesignSystem, colorToHex };
```

- [ ] **Step 5: Run tests**

```bash
node --test plugins/adhd/lib/design-system/__tests__/figma-parser.test.js
```
Expected: 6 tests passing.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/design-system/figma-extract-script.js \
        plugins/adhd/lib/design-system/figma-parser.js \
        plugins/adhd/lib/design-system/__tests__/figma-parser.test.js
git commit -m "Add figma-extract-script and figma-parser for Figma → DesignSystem"
```

---

## Task 5: comparator.js — diff two DesignSystems

**Files:**
- Create: `plugins/adhd/lib/design-system/comparator.js`
- Test: `plugins/adhd/lib/design-system/__tests__/comparator.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/design-system/__tests__/comparator.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareDesignSystems } = require('../comparator');

const codeOnly = {
  tokens: [
    { domain: 'color', path: 'gold/100', values: { default: { type: 'literal', value: '#faf0c5' } } },
  ],
  exposure: [],
  styles: { effects: [], text: [] },
};

test('classifies a token as same when both sides match exactly', () => {
  const figma = JSON.parse(JSON.stringify(codeOnly));
  const r = compareDesignSystems(codeOnly, figma);
  assert.equal(r.same.length, 1);
  assert.equal(r.conflict.length, 0);
});

test('classifies as conflict when same path different value', () => {
  const figma = {
    ...codeOnly,
    tokens: [{ domain: 'color', path: 'gold/100', values: { default: { type: 'literal', value: '#000000' } } }],
  };
  const r = compareDesignSystems(codeOnly, figma);
  assert.equal(r.conflict.length, 1);
  assert.equal(r.conflict[0].path, 'gold/100');
  assert.equal(r.conflict[0].mode, 'default');
});

test('classifies as code-only when figma lacks the token', () => {
  const figma = { tokens: [], exposure: [], styles: { effects: [], text: [] } };
  const r = compareDesignSystems(codeOnly, figma);
  assert.equal(r.codeOnly.length, 1);
  assert.equal(r.figmaOnly.length, 0);
});

test('classifies as figma-only when code lacks the token', () => {
  const empty = { tokens: [], exposure: [], styles: { effects: [], text: [] } };
  const r = compareDesignSystems(empty, codeOnly);
  assert.equal(r.figmaOnly.length, 1);
  assert.equal(r.codeOnly.length, 0);
});

test('treats hex case as equal', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'x', values: { default: { type: 'literal', value: '#ABCDEF' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{ domain: 'color', path: 'x', values: { default: { type: 'literal', value: '#abcdef' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.same.length, 1);
});

test('treats matching aliases as equal (alias to alias)', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'alias', target: 'gold/100' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = JSON.parse(JSON.stringify(code));
  const r = compareDesignSystems(code, figma);
  assert.equal(r.same.length, 1);
});

test('alias vs literal in same token is a conflict (broken alias)', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'alias', target: 'gold/100' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'literal', value: '#faf0c5' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.conflict.length, 1);
});

test('exposure-only entries do not appear in any classification', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'alias', target: 'gold/100' } } }],
    exposure: [{ cssVar: '--color-brand-surface', target: 'brand-surface' }],
    styles: { effects: [], text: [] },
  };
  const figma = JSON.parse(JSON.stringify(code));
  figma.exposure = [];
  const r = compareDesignSystems(code, figma);
  // brand/surface is `same`; exposure is silently filtered out (never compared)
  assert.equal(r.same.length, 1);
  assert.equal(r.conflict.length, 0);
  assert.equal(r.codeOnly.length, 0);
  assert.equal(r.figmaOnly.length, 0);
});

test('comparing per mode independently — token can be same in light, conflict in dark', () => {
  const code = {
    tokens: [{
      domain: 'color', path: 'brand/surface',
      values: {
        light: { type: 'alias', target: 'gold/100' },
        dark:  { type: 'alias', target: 'gold/900' },
      },
    }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{
      domain: 'color', path: 'brand/surface',
      values: {
        light: { type: 'alias', target: 'gold/100' },
        dark:  { type: 'alias', target: 'gold/100' }, // wrong dark!
      },
    }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.same.length, 1, 'light is same');
  assert.equal(r.conflict.length, 1, 'dark is a conflict');
  assert.equal(r.conflict[0].mode, 'dark');
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement comparator.js**

Create `plugins/adhd/lib/design-system/comparator.js`:

```js
'use strict';

function valuesEqual(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'alias') {
    return a.target === b.target;
  }
  // literal
  const av = String(a.value).toLowerCase();
  const bv = String(b.value).toLowerCase();
  return av === bv;
}

function compareDesignSystems(code, figma) {
  const same = [];
  const conflict = [];
  const codeOnly = [];
  const figmaOnly = [];

  const codeByPath = new Map(code.tokens.map(t => [t.path, t]));
  const figmaByPath = new Map(figma.tokens.map(t => [t.path, t]));

  // Tokens that exist on both sides
  for (const [path, codeTok] of codeByPath) {
    const figmaTok = figmaByPath.get(path);
    if (!figmaTok) {
      codeOnly.push(codeTok);
      continue;
    }
    // Compare per mode
    const allModes = new Set([
      ...Object.keys(codeTok.values),
      ...Object.keys(figmaTok.values),
    ]);
    let anyConflict = false;
    let anySame = false;
    for (const mode of allModes) {
      const codeVal = codeTok.values[mode];
      const figmaVal = figmaTok.values[mode];
      if (codeVal && figmaVal) {
        if (valuesEqual(codeVal, figmaVal)) {
          anySame = true;
        } else {
          anyConflict = true;
          conflict.push({
            path, mode,
            domain: codeTok.domain,
            code: codeVal,
            figma: figmaVal,
          });
        }
      } else if (codeVal && !figmaVal) {
        anyConflict = true;
        conflict.push({
          path, mode,
          domain: codeTok.domain,
          code: codeVal,
          figma: null,
        });
      } else if (figmaVal && !codeVal) {
        anyConflict = true;
        conflict.push({
          path, mode,
          domain: codeTok.domain,
          code: null,
          figma: figmaVal,
        });
      }
    }
    if (anySame && !anyConflict) {
      same.push(codeTok);
    }
  }

  // Tokens only on the figma side
  for (const [path, figmaTok] of figmaByPath) {
    if (!codeByPath.has(path)) {
      figmaOnly.push(figmaTok);
    }
  }

  return { same, conflict, codeOnly, figmaOnly };
}

module.exports = { compareDesignSystems, valuesEqual };
```

- [ ] **Step 4: Run tests**

Expected: all 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/design-system/comparator.js plugins/adhd/lib/design-system/__tests__/comparator.test.js
git commit -m "Add comparator: same / conflict / codeOnly / figmaOnly classification"
```

---

## Task 6: code-writer.js — DesignSystem → globals.css edits

**Files:**
- Create: `plugins/adhd/lib/design-system/code-writer.js`
- Test: `plugins/adhd/lib/design-system/__tests__/code-writer.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/design-system/__tests__/code-writer.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyToCss } = require('../code-writer');

const STARTER_CSS = `@import "tailwindcss";

@theme {
  --color-gold-100: #faf0c5;
}

:root {
  --background: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
  }
}

@theme inline {
  --color-background: var(--background);
}
`;

test('updates an existing primitive in @theme', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-primitive', cssVar: '--color-gold-100', value: '#fffacd' },
  ]);
  assert.match(out, /--color-gold-100:\s*#fffacd;/);
});

test('adds a new primitive to @theme', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-primitive', cssVar: '--color-gold-200', value: '#f5dd87' },
  ]);
  assert.match(out, /--color-gold-200:\s*#f5dd87;/);
  // Existing entry preserved
  assert.match(out, /--color-gold-100:\s*#faf0c5;/);
});

test('updates a light-mode semantic var in :root', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--background', mode: 'light', value: '#fefefe' },
  ]);
  assert.match(out, /:root\s*\{[^}]*--background:\s*#fefefe;/);
});

test('updates a dark-mode semantic var inside @media block', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--background', mode: 'dark', value: '#000000' },
  ]);
  assert.match(out, /prefers-color-scheme:\s*dark[^}]+--background:\s*#000000;/s);
});

test('adds an exposure alias to @theme inline if it does not exist', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-exposure', cssVar: '--color-foreground', target: 'foreground' },
  ]);
  assert.match(out, /@theme\s+inline[^}]+--color-foreground:\s*var\(--foreground\);/s);
});

test('preserves existing entries when adding new ones', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--foreground', mode: 'light', value: '#171717' },
  ]);
  assert.match(out, /--background:\s*#ffffff;/);  // preserved
  assert.match(out, /--foreground:\s*#171717;/);  // added
});

test('aliases write as var() references', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--brand-surface', mode: 'light', valueAlias: '--color-gold-100' },
  ]);
  assert.match(out, /:root\s*\{[^}]*--brand-surface:\s*var\(--color-gold-100\);/);
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement code-writer.js**

Create `plugins/adhd/lib/design-system/code-writer.js`:

```js
'use strict';

function findBlockBounds(css, openRe) {
  const m = openRe.exec(css);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  return { open: m.index, contentStart: start, contentEnd: i, close: i + 1 };
}

function findThemeBlock(css) {
  // Match `@theme {` but not `@theme inline {`
  const re = /@theme(?!\s+inline)\s*\{/g;
  return findBlockBounds(css, re);
}

function findThemeInlineBlock(css) {
  return findBlockBounds(css, /@theme\s+inline\s*\{/);
}

function findRootLightBlock(css) {
  // The first :root {} that is NOT inside @media (prefers-color-scheme: dark)
  // and NOT a [data-theme="dark"] selector.
  // Strategy: blank dark wrappers and the data-theme selector, then find :root {}.
  let stripped = css.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[\s\S]*?\}\s*\}/g, ' '.repeat(50));
  stripped = stripped.replace(/:root\[data-theme=["']dark["']\]\s*\{[^}]*\}/g, ' '.repeat(50));
  return findBlockBounds(stripped, /:root\s*\{/);
}

function findRootDarkBlock(css) {
  // First look for :root[data-theme="dark"] {}
  const dataMatch = findBlockBounds(css, /:root\[data-theme=["']dark["']\]\s*\{/);
  if (dataMatch) return dataMatch;
  // Otherwise the :root {} inside @media (prefers-color-scheme: dark) {}
  const mediaRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  const m = mediaRe.exec(css);
  if (!m) return null;
  const mediaContentStart = m.index + m[0].length;
  return findBlockBounds(css.slice(mediaContentStart), /:root\s*\{/);
}

function setEntryInBlock(css, blockBounds, cssVar, valueRaw) {
  const body = css.slice(blockBounds.contentStart, blockBounds.contentEnd);
  const re = new RegExp('(' + cssVar.replace(/[-]/g, '\\-') + '\\s*:\\s*)([^;]+)(;)', '');
  if (re.test(body)) {
    const newBody = body.replace(re, '$1' + valueRaw + '$3');
    return css.slice(0, blockBounds.contentStart) + newBody + css.slice(blockBounds.contentEnd);
  }
  // Add a new entry, indented
  const indent = '  ';
  const insert = `\n${indent}${cssVar}: ${valueRaw};`;
  return css.slice(0, blockBounds.contentEnd) + insert + '\n' + css.slice(blockBounds.contentEnd);
}

function ensureThemeBlock(css) {
  let bounds = findThemeBlock(css);
  if (bounds) return { css, bounds };
  // Insert at the top, after @import line if present
  const importMatch = /@import[^;]+;/m.exec(css);
  const insertAt = importMatch ? importMatch.index + importMatch[0].length : 0;
  const block = '\n\n@theme {\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findThemeBlock(newCss);
  return { css: newCss, bounds };
}

function ensureRootBlock(css) {
  let bounds = findRootLightBlock(css);
  if (bounds) return { css, bounds };
  const insertAt = css.length;
  const block = '\n\n:root {\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findRootLightBlock(newCss);
  return { css: newCss, bounds };
}

function ensureRootDarkBlock(css) {
  let bounds = findRootDarkBlock(css);
  if (bounds) return { css, bounds };
  // Add a @media (prefers-color-scheme: dark) :root {} block
  const insertAt = css.length;
  const block = '\n\n@media (prefers-color-scheme: dark) {\n  :root {\n  }\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findRootDarkBlock(newCss);
  return { css: newCss, bounds };
}

function ensureThemeInlineBlock(css) {
  let bounds = findThemeInlineBlock(css);
  if (bounds) return { css, bounds };
  const insertAt = css.length;
  const block = '\n\n@theme inline {\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findThemeInlineBlock(newCss);
  return { css: newCss, bounds };
}

function applyToCss(css, actions) {
  let cur = css;
  for (const a of actions) {
    const value = a.valueAlias ? `var(${a.valueAlias})` : a.value;
    if (a.kind === 'set-primitive') {
      const ensured = ensureThemeBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, value);
    } else if (a.kind === 'set-semantic' && a.mode === 'light') {
      const ensured = ensureRootBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, value);
    } else if (a.kind === 'set-semantic' && a.mode === 'dark') {
      const ensured = ensureRootDarkBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, value);
    } else if (a.kind === 'set-exposure') {
      const ensured = ensureThemeInlineBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, `var(--${a.target})`);
    } else {
      throw new Error('Unknown action kind: ' + a.kind);
    }
  }
  return cur;
}

module.exports = { applyToCss };
```

- [ ] **Step 4: Run tests**

Expected: all 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/design-system/code-writer.js plugins/adhd/lib/design-system/__tests__/code-writer.test.js
git commit -m "Add code-writer for DesignSystem → globals.css edits"
```

---

## Task 7: figma-write-actions.js + figma-write-script.js

The actions list is what the skill builds after resolving prompts; the write script is what gets injected into `use_figma`.

**Files:**
- Create: `plugins/adhd/lib/design-system/figma-write-actions.js`
- Create: `plugins/adhd/lib/design-system/figma-write-script.js`
- Test: `plugins/adhd/lib/design-system/__tests__/figma-write-actions.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/design-system/__tests__/figma-write-actions.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFigmaActions } = require('../figma-write-actions');

test('emits create-variable action for code-only token (push)', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'color',
      path: 'gold/100',
      values: { default: { type: 'literal', value: '#faf0c5' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
  assert.equal(actions[0].collection, 'color');
  assert.equal(actions[0].path, 'gold/100');
});

test('emits update-variable action for resolved conflict (use code)', () => {
  const diff = {
    same: [], codeOnly: [], figmaOnly: [],
    conflict: [{
      domain: 'color',
      path: 'brand/surface',
      mode: 'light',
      code: { type: 'alias', target: 'gold/100' },
      figma: { type: 'alias', target: 'gold/200' },
    }],
  };
  const resolutions = [{ path: 'brand/surface', mode: 'light', winner: 'code' }];
  const actions = buildFigmaActions(diff, resolutions, 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'update-variable');
  assert.equal(actions[0].mode, 'light');
  assert.deepEqual(actions[0].newValue, { type: 'alias', target: 'gold/100' });
});

test('skips conflicts where user picked "figma" winner (push direction)', () => {
  const diff = {
    same: [], codeOnly: [], figmaOnly: [],
    conflict: [{
      domain: 'color', path: 'brand/surface', mode: 'light',
      code: { type: 'alias', target: 'gold/100' },
      figma: { type: 'alias', target: 'gold/200' },
    }],
  };
  const resolutions = [{ path: 'brand/surface', mode: 'light', winner: 'figma' }];
  const actions = buildFigmaActions(diff, resolutions, 'push');
  assert.equal(actions.length, 0);
});

test('push does NOT emit actions for figma-only tokens (additive policy)', () => {
  const diff = {
    same: [], conflict: [], codeOnly: [],
    figmaOnly: [{
      domain: 'color', path: 'extra/var', values: { default: { type: 'literal', value: '#fff' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 0);
});

test('pull direction inverts: emits actions for figma-only and overwrites code on resolved conflicts', () => {
  const diff = {
    same: [], codeOnly: [],
    figmaOnly: [{
      domain: 'color', path: 'extra', values: { default: { type: 'literal', value: '#fff' } },
    }],
    conflict: [{
      domain: 'color', path: 'brand/surface', mode: 'light',
      code: { type: 'literal', value: '#aaa' },
      figma: { type: 'literal', value: '#bbb' },
    }],
  };
  const resolutions = [{ path: 'brand/surface', mode: 'light', winner: 'figma' }];
  const actions = buildFigmaActions(diff, resolutions, 'pull');
  // Pull direction emits CODE actions, not Figma actions
  assert.ok(actions.find(a => a.kind === 'set-primitive' && a.cssVar.includes('extra')));
  assert.ok(actions.find(a => a.kind === 'set-semantic' && a.cssVar.includes('brand-surface')));
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement figma-write-actions.js**

Create `plugins/adhd/lib/design-system/figma-write-actions.js`:

```js
'use strict';

const DOMAIN_COLLECTION = {
  color: 'color',
  spacing: 'spacing',
  radius: 'radius',
  shadow: 'shadow',
  typography: 'typography',
};

const DOMAIN_PREFIX = {
  color: '--color-',
  spacing: '--space-',
  radius: '--radius-',
  shadow: '--shadow-',
  typography: '--font-',
};

function pathToCssVar(domain, path) {
  // gold/100 → --color-gold-100
  // brand/surface → --brand-surface (semantic colors don't use the color- prefix)
  const dashed = path.replace(/\//g, '-');
  if (domain === 'color' && (dashed.startsWith('brand') || /^(background|foreground|text|surface|accent|border)$/i.test(path))) {
    return '--' + dashed;
  }
  return DOMAIN_PREFIX[domain] + dashed;
}

function buildFigmaActions(diff, resolutions, direction) {
  const resolutionMap = new Map();
  for (const r of resolutions) {
    resolutionMap.set(r.path + ':' + (r.mode ?? 'default'), r.winner);
  }

  if (direction === 'push') {
    const actions = [];
    // Code-only: create in Figma
    for (const t of diff.codeOnly) {
      actions.push({
        kind: 'create-variable',
        collection: DOMAIN_COLLECTION[t.domain],
        path: t.path,
        domain: t.domain,
        valuesByMode: t.values,
      });
    }
    // Conflicts where user picked "code": overwrite Figma
    for (const c of diff.conflict) {
      const winner = resolutionMap.get(c.path + ':' + c.mode);
      if (winner === 'code') {
        actions.push({
          kind: 'update-variable',
          path: c.path,
          domain: c.domain,
          mode: c.mode,
          newValue: c.code,
        });
      }
    }
    return actions;
  }

  if (direction === 'pull') {
    const actions = [];
    // Figma-only: add to code
    for (const t of diff.figmaOnly) {
      const cssVar = pathToCssVar(t.domain, t.path);
      const isPrimitive = ('default' in t.values);
      for (const [mode, val] of Object.entries(t.values)) {
        if (mode === 'default') {
          actions.push({
            kind: 'set-primitive',
            cssVar,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        } else {
          actions.push({
            kind: 'set-semantic',
            cssVar, mode,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        }
      }
    }
    // Conflicts where user picked "figma": overwrite code
    for (const c of diff.conflict) {
      const winner = resolutionMap.get(c.path + ':' + c.mode);
      if (winner === 'figma') {
        const cssVar = pathToCssVar(c.domain, c.path);
        const val = c.figma;
        if (c.mode === 'default') {
          actions.push({
            kind: 'set-primitive',
            cssVar,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        } else {
          actions.push({
            kind: 'set-semantic',
            cssVar, mode: c.mode,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        }
      }
    }
    return actions;
  }

  throw new Error('Unknown direction: ' + direction);
}

module.exports = { buildFigmaActions, pathToCssVar };
```

- [ ] **Step 4: Implement figma-write-script.js**

Create `plugins/adhd/lib/design-system/figma-write-script.js`:

```js
'use strict';

/**
 * JS string injected into use_figma. Reads `__ACTIONS__` (a JSON array
 * of { kind, ... }) and applies each one to the Figma file. Returns
 * { applied: [...], skipped: [...], errors: [...] }.
 *
 * The skill is responsible for substituting __ACTIONS__ with the
 * stringified actions JSON before passing to use_figma.
 */
const WRITE_SCRIPT = `
const actions = __ACTIONS__;

const SCOPES = {
  color: ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'],
  spacing: ['GAP', 'WIDTH_HEIGHT'],
  radius: ['CORNER_RADIUS'],
  typography: ['FONT_SIZE'],
};

function hex(h) {
  const c = h.replace('#', '');
  const r = parseInt(c.slice(0,2),16) / 255;
  const g = parseInt(c.slice(2,4),16) / 255;
  const b = parseInt(c.slice(4,6),16) / 255;
  return { r, g, b };
}

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const collectionByName = {};
for (const c of collections) collectionByName[c.name] = c;

async function ensureCollection(name, withModes) {
  if (collectionByName[name]) return collectionByName[name];
  const col = figma.variables.createVariableCollection(name);
  if (withModes && withModes.length > 1) {
    // Default has 1 mode; rename it and add the rest
    col.renameMode(col.modes[0].modeId, withModes[0]);
    for (let i = 1; i < withModes.length; i++) {
      col.addMode(withModes[i]);
    }
  } else if (withModes && withModes.length === 1) {
    col.renameMode(col.modes[0].modeId, withModes[0]);
  }
  collectionByName[name] = col;
  return col;
}

async function findVarByName(col, name) {
  for (const vid of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (v && v.name === name) return v;
  }
  return null;
}

const applied = [];
const errors = [];

for (const a of actions) {
  try {
    if (a.kind === 'create-variable') {
      const modesNeeded = Object.keys(a.valuesByMode);
      const useModes = modesNeeded.includes('default') ? ['Mode 1'] : modesNeeded.map(m => m.charAt(0).toUpperCase() + m.slice(1));
      const col = await ensureCollection(a.collection, useModes);
      const figmaModeIds = {};
      for (const m of col.modes) figmaModeIds[m.name.toLowerCase()] = m.modeId;
      const type = a.domain === 'color' ? 'COLOR' : 'FLOAT';
      const v = figma.variables.createVariable(a.path, col, type);
      v.scopes = SCOPES[a.domain] || ['ALL_SCOPES'];
      for (const [mode, val] of Object.entries(a.valuesByMode)) {
        const modeId = figmaModeIds[mode === 'default' ? 'mode 1' : mode];
        if (!modeId) { errors.push({action: a, err: 'No mode ' + mode}); continue; }
        if (val.type === 'literal') {
          const v2 = a.domain === 'color' ? hex(val.value) : Number(val.value.toString().replace(/px$/, ''));
          v.setValueForMode(modeId, v2);
        } else if (val.type === 'alias') {
          const target = await findVarByName(col, val.target);
          if (!target) { errors.push({action: a, err: 'Alias target not found: ' + val.target}); continue; }
          v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
        }
      }
      applied.push(a);
    } else if (a.kind === 'update-variable') {
      // Find the variable across collections
      let v = null;
      for (const c of collections) {
        v = await findVarByName(c, a.path);
        if (v) break;
      }
      if (!v) { errors.push({action: a, err: 'Variable not found: ' + a.path}); continue; }
      const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      const modeId = col.modes.find(m => m.name.toLowerCase() === a.mode || (a.mode === 'default' && m.name === 'Mode 1'))?.modeId;
      if (!modeId) { errors.push({action: a, err: 'Mode not found: ' + a.mode}); continue; }
      if (a.newValue.type === 'literal') {
        const v2 = a.domain === 'color' ? hex(a.newValue.value) : Number(a.newValue.value.toString().replace(/px$/, ''));
        v.setValueForMode(modeId, v2);
      } else if (a.newValue.type === 'alias') {
        const target = await findVarByName(col, a.newValue.target);
        if (!target) { errors.push({action: a, err: 'Alias target not found: ' + a.newValue.target}); continue; }
        v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
      }
      applied.push(a);
    } else {
      errors.push({action: a, err: 'Unknown kind: ' + a.kind});
    }
  } catch (err) {
    errors.push({action: a, err: err.message});
  }
}

return { applied, errors };
`;

module.exports = { WRITE_SCRIPT };
```

- [ ] **Step 5: Run tests**

```bash
node --test plugins/adhd/lib/design-system/__tests__/figma-write-actions.test.js
```
Expected: 5 tests passing. (figma-write-script is just a JS string export — no separate test; integration-tested via the skill end-to-end.)

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/design-system/figma-write-actions.js \
        plugins/adhd/lib/design-system/figma-write-script.js \
        plugins/adhd/lib/design-system/__tests__/figma-write-actions.test.js
git commit -m "Add figma-write-actions and figma-write-script for resolved-diff → Figma writes"
```

---

## Task 8: cli.js — orchestrator

Wire compare and apply into a runnable CLI used by both skills.

**Files:**
- Modify: `plugins/adhd/lib/design-system/cli.js`
- Test: `plugins/adhd/lib/design-system/__tests__/cli.test.js`

- [ ] **Step 1: Extend the CLI test**

Replace `plugins/adhd/lib/design-system/__tests__/cli.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-' + Date.now() + '-' + filename);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

test('cli with --help prints usage', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('compare mode produces diff JSON to --output', () => {
  const css = tmp('globals.css', `
    @theme { --color-gold-100: #faf0c5; }
    :root { --background: #ffffff; }
    @media (prefers-color-scheme: dark) { :root { --background: #0a0a0a; } }
  `);
  const figma = tmp('figma.json', {
    collections: [
      { id: 'C1', name: 'color',
        modes: [{ id: 'M1', name: 'Light' }, { id: 'M2', name: 'Dark' }],
        variables: [
          {
            id: 'V1', name: 'gold/100', resolvedType: 'COLOR', scopes: [],
            valuesByMode: {
              Light: { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
              Dark:  { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
            },
          },
        ],
      },
    ],
    effectStyles: [], textStyles: [],
  });
  const out = path.join(os.tmpdir(), 'adhd-diff-' + Date.now() + '.json');

  const result = spawnSync('node', [CLI, 'compare', '--code', css, '--figma', figma, '--output', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const diff = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(Array.isArray(diff.same));
  assert.ok(Array.isArray(diff.conflict));
  assert.ok(Array.isArray(diff.codeOnly));
  assert.ok(Array.isArray(diff.figmaOnly));
});

test('apply mode produces actions list', () => {
  const diff = tmp('diff.json', {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{ domain: 'color', path: 'gold/100', values: { default: { type: 'literal', value: '#faf0c5' } } }],
  });
  const resolutions = tmp('resolutions.json', []);
  const out = path.join(os.tmpdir(), 'adhd-actions-' + Date.now() + '.json');

  const result = spawnSync('node', [CLI, 'apply', '--diff', diff, '--resolutions', resolutions, '--direction', 'push', '--output', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const actions = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Replace cli.js**

Overwrite `plugins/adhd/lib/design-system/cli.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseCodeDesignSystem } = require('./code-parser');
const { parseFigmaDesignSystem } = require('./figma-parser');
const { compareDesignSystems } = require('./comparator');
const { buildFigmaActions } = require('./figma-write-actions');

function parseArgs(argv) {
  const args = {};
  args._ = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js compare --code <globals.css> --figma <figma.json> --output <diff.json>
  cli.js apply   --diff <diff.json> --resolutions <resolutions.json> --direction <push|pull> --output <actions.json>

compare:
  Reads globals.css and a figma-extract JSON (the result of running
  figma-extract-script.js inside use_figma). Produces a diff JSON.

apply:
  Reads a diff JSON and a resolutions JSON (user's choices for each
  conflict). Produces an actions list. For push, actions are Figma
  variable mutations. For pull, actions are CSS edits.`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  const cmd = args._[0];

  if (cmd === 'compare') {
    const css = fs.readFileSync(args.code, 'utf8');
    const figmaExtract = JSON.parse(fs.readFileSync(args.figma, 'utf8'));
    const codeDS = parseCodeDesignSystem(css);
    const figmaDS = parseFigmaDesignSystem(figmaExtract);
    const diff = compareDesignSystems(codeDS, figmaDS);
    fs.writeFileSync(args.output, JSON.stringify(diff, null, 2));
    process.exit(0);
  }

  if (cmd === 'apply') {
    const diff = JSON.parse(fs.readFileSync(args.diff, 'utf8'));
    const resolutions = JSON.parse(fs.readFileSync(args.resolutions, 'utf8'));
    const actions = buildFigmaActions(diff, resolutions, args.direction);
    fs.writeFileSync(args.output, JSON.stringify(actions, null, 2));
    process.exit(0);
  }

  console.error('Unknown command. Use --help.');
  process.exit(2);
}

main();
```

- [ ] **Step 4: Run all design-system tests**

```bash
node --test plugins/adhd/lib/design-system/__tests__/
```
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/design-system/cli.js plugins/adhd/lib/design-system/__tests__/cli.test.js
git commit -m "Wire up design-system CLI orchestrator (compare + apply)"
```

---

## Task 9: /adhd:push-design-system skill

**Files:**
- Create: `plugins/adhd/skills/push-design-system/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `plugins/adhd/skills/push-design-system/SKILL.md`:

```markdown
---
description: "Push the local design system (globals.css variables + named styles) into the configured Figma file. Two-way diff with per-attribute conflict prompts; additive (never deletes from Figma). Reads adhd.config.ts at the repo root."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Push Design System

Pushes the codebase's design tokens (variables + named styles) into the configured Figma file. Compares both sides; for each conflicting variable, prompts the user; for variables that exist only in code, creates them in Figma; for variables that exist only in Figma, leaves them alone (additive policy).

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-push-pull-design-system.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root with the `Read` tool. If it doesn't exist, abort: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `cssEntry` (optional; auto-detect `app/globals.css` then `src/app/globals.css`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 2: Read both sides

Use the `Read` tool to read the resolved `globals.css` path. Save it to `/tmp/adhd-push/globals.css` via the `Write` tool.

Use `mcp__plugin_figma_figma__use_figma` with the file key, the `figma-use` skill name, and the extract script (load it from `plugins/adhd/lib/design-system/figma-extract-script.js`'s `EXTRACT_SCRIPT` export — the skill instructions are: read the file with `Read`, extract the value of the exported constant). Pass the script as the `code` parameter of `use_figma`. Save the response JSON to `/tmp/adhd-push/figma.json` via the `Write` tool.

## Phase 3: Run the comparator

Use `Bash`:
```bash
node plugins/adhd/lib/design-system/cli.js compare \
  --code /tmp/adhd-push/globals.css \
  --figma /tmp/adhd-push/figma.json \
  --output /tmp/adhd-push/diff.json
```

Read `/tmp/adhd-push/diff.json`. The diff has four arrays: `same`, `conflict`, `codeOnly`, `figmaOnly`.

If `conflict.length === 0` and `codeOnly.length === 0`, print "Figma is already in sync with code. No changes." and exit 0.

## Phase 4: Resolve conflicts via AskUserQuestion

For each conflict in `diff.conflict`, use `AskUserQuestion` with these four options:
- "Keep Figma value (no change)" → resolution `{path, mode, winner: 'figma'}`
- "Use code value (overwrite Figma)" → `{path, mode, winner: 'code'}`
- "Use Figma's values for all N conflicts" → batch confirm (see below)
- "Use code's values for all N conflicts" → batch confirm

If the user picks a batch option, follow up with another `AskUserQuestion`:
- "Apply all" → apply chosen winner to ALL remaining conflicts; continue without further per-conflict prompts
- "Cancel — go back to per-conflict review" → resume per-conflict loop at current position

Build a `resolutions` array of `{path, mode, winner}` objects. Save it to `/tmp/adhd-push/resolutions.json` via the `Write` tool.

## Phase 5: Build actions

```bash
node plugins/adhd/lib/design-system/cli.js apply \
  --diff /tmp/adhd-push/diff.json \
  --resolutions /tmp/adhd-push/resolutions.json \
  --direction push \
  --output /tmp/adhd-push/actions.json
```

Read `/tmp/adhd-push/actions.json`. If empty, print "Nothing to apply." and exit 0.

## Phase 6: Drift check (re-fetch Figma)

Re-run the extract script via `use_figma` (same call as Phase 2). Save the response to `/tmp/adhd-push/figma-recheck.json`. Compare to `/tmp/adhd-push/figma.json` byte-for-byte:

```bash
diff /tmp/adhd-push/figma.json /tmp/adhd-push/figma-recheck.json
```

If they differ, abort with: "Figma drifted during this run. Re-run /adhd:push-design-system to see fresh conflicts." Exit 1.

## Phase 7: Apply actions to Figma

Load the write script from `plugins/adhd/lib/design-system/figma-write-script.js`'s `WRITE_SCRIPT` export. Substitute `__ACTIONS__` with the contents of `/tmp/adhd-push/actions.json` (the actions array, JSON-stringified inline into the script).

Call `mcp__plugin_figma_figma__use_figma` with the substituted script. The response contains `{ applied, errors }`.

If `errors.length > 0`, print the error list and exit 1.

## Phase 8: Final report

Print:
```
✓ Pushed to Figma:
  - <N> variables created
  - <M> conflicts resolved
  - <K> figma-only variables left untouched (additive policy)
```

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `globals.css not found` | Pass `cssEntry` in adhd.config.ts or place the file at `app/globals.css`. |
| `Figma drifted during this run` | Someone changed Figma while you were resolving conflicts. Re-run `/adhd:push-design-system`. |
| `Figma MCP unreachable` | Verify the figma plugin is installed: `claude plugin install figma@claude-plugins-official`. |
```

- [ ] **Step 2: Validate frontmatter**

```bash
node scripts/validate-skill-frontmatter.js
```
Expected: 4/4 valid (config, lint, sync, push-design-system).

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/push-design-system/SKILL.md
git commit -m "Add /adhd:push-design-system skill"
```

---

## Task 10: Rename /adhd:sync → /adhd:pull-design-system + rewrite

**Files:**
- Rename: `plugins/adhd/skills/sync/` → `plugins/adhd/skills/pull-design-system/`
- Rewrite: `plugins/adhd/skills/pull-design-system/SKILL.md`

- [ ] **Step 1: Rename the directory**

```bash
git mv plugins/adhd/skills/sync plugins/adhd/skills/pull-design-system
```

- [ ] **Step 2: Rewrite the SKILL.md**

Overwrite `plugins/adhd/skills/pull-design-system/SKILL.md`:

```markdown
---
description: "Pull the design system (variables + named styles) from the configured Figma file into globals.css. Two-way diff with per-attribute conflict prompts; additive (never deletes from code). Reads adhd.config.ts at the repo root."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Pull Design System

Pulls Figma's design tokens (variables + named styles) into the codebase's `globals.css`. Compares both sides; for each conflicting variable, prompts the user; for variables that exist only in Figma, creates them in code; for variables that exist only in code, leaves them alone (additive policy).

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-push-pull-design-system.md`

## Phase 1: Validate config

(Same as /adhd:push-design-system Phase 1.)

## Phase 2: Read both sides

(Same as /adhd:push-design-system Phase 2 — read globals.css, run extract script via use_figma, save both to `/tmp/adhd-pull/`.)

## Phase 3: Run the comparator

```bash
node plugins/adhd/lib/design-system/cli.js compare \
  --code /tmp/adhd-pull/globals.css \
  --figma /tmp/adhd-pull/figma.json \
  --output /tmp/adhd-pull/diff.json
```

If `conflict.length === 0` and `figmaOnly.length === 0`, print "Code is already in sync with Figma. No changes." and exit 0.

## Phase 4: Resolve conflicts

For each conflict in `diff.conflict`, use `AskUserQuestion` with:
- "Keep Figma value (overwrite code)" → `{path, mode, winner: 'figma'}`
- "Use code value (no change)" → `{path, mode, winner: 'code'}`
- "Use Figma's values for all N conflicts" → batch confirm
- "Use code's values for all N conflicts" → batch confirm

(Same batch confirm flow as push.)

Save `resolutions.json` to `/tmp/adhd-pull/`.

## Phase 5: Build actions (pull direction)

```bash
node plugins/adhd/lib/design-system/cli.js apply \
  --diff /tmp/adhd-pull/diff.json \
  --resolutions /tmp/adhd-pull/resolutions.json \
  --direction pull \
  --output /tmp/adhd-pull/actions.json
```

Read `/tmp/adhd-pull/actions.json`. Each action has kind `set-primitive`, `set-semantic`, or `set-exposure`.

## Phase 6: Drift check

(Same as push Phase 6 — re-fetch Figma, diff against the original capture, abort on change.)

## Phase 7: Apply actions to globals.css

Use the `Read` tool to read the current `globals.css`. Apply each action by editing the relevant block:

- `set-primitive` → edit/insert in the `@theme {}` block
- `set-semantic` with `mode: light` → edit/insert in `:root {}`
- `set-semantic` with `mode: dark` → edit/insert in `:root[data-theme="dark"]` if it exists, else inside `@media (prefers-color-scheme: dark) :root {}` (create the block if neither exists)
- `set-exposure` → edit/insert in `@theme inline {}`

The block-targeting logic mirrors `lib/design-system/code-writer.js`'s `applyToCss`. To stay deterministic, the recommended approach: write `globals.css` to `/tmp/adhd-pull/globals-original.css`, then run a Bash one-liner that invokes a small Node helper:

```bash
node -e "
const { applyToCss } = require('plugins/adhd/lib/design-system/code-writer.js');
const fs = require('fs');
const css = fs.readFileSync('/tmp/adhd-pull/globals-original.css', 'utf8');
const actions = JSON.parse(fs.readFileSync('/tmp/adhd-pull/actions.json', 'utf8'));
process.stdout.write(applyToCss(css, actions));
" > /tmp/adhd-pull/globals-new.css
```

Then use the `Write` tool to write the new content back to the actual `globals.css` path (resolved in Phase 1).

## Phase 8: Per-domain commit

Group actions by domain (color / spacing / radius / shadow / typography). For each domain that received writes, create a commit:

```bash
git add <path-to-globals.css>
git commit -m "ADHD pull: <domain> (<count> changes)"
```

If multiple domains were touched, multiple commits land. If no domain received writes (all conflicts resolved as "keep code"), no commit.

## Phase 9: Final report

Print:
```
✓ Pulled from Figma:
  - <N> variables added to code
  - <M> conflicts resolved
  - <K> code-only variables left untouched (additive policy)
```

## Common errors

(Same table as push, plus:)

| Error | Fix-up guidance |
|---|---|
| `globals.css block missing` | The CSS doesn't have an `@theme {}` or `:root {}` block. Pull will create the block as needed. |
| `Edit failed: cannot find variable in target block` | The action expected to update an existing entry but didn't find it. Should never happen if the diff was current; if it does, re-run pull. |
```

- [ ] **Step 3: Validate frontmatter**

```bash
node scripts/validate-skill-frontmatter.js
```
Expected: 4/4 valid.

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/skills/pull-design-system/SKILL.md
git commit -m "Rename /adhd:sync → /adhd:pull-design-system; rewrite for new architecture"
```

---

## Task 11: Update /adhd:lint — whole-file mode + use_figma extraction

**Files:**
- Modify: `plugins/adhd/skills/lint/SKILL.md`
- Modify: `plugins/adhd/lib/lint-engine/cli.js`
- Modify: `plugins/adhd/lib/lint-engine/report-formatter.js`
- Test: `plugins/adhd/lib/lint-engine/__tests__/cli.test.js` (add a whole-file test)
- Test: `plugins/adhd/lib/lint-engine/__tests__/report-formatter.test.js` (add a whole-file test)

- [ ] **Step 1: Add a whole-file test for the lint-engine CLI**

Append to `plugins/adhd/lib/lint-engine/__tests__/cli.test.js`:

```js
test('cli accepts an array-of-nodes input via --design-context for whole-file mode', () => {
  const varDefs = tmp('vars.json', {});
  const ctx = tmp('ctx.json', {
    mode: 'whole-file',
    pages: [
      {
        id: '0:1', name: 'Page 1',
        nodes: [
          { id: '1:1', name: 'avatar', type: 'COMPONENT_SET', componentPropertyDefinitions: { size: { type: 'VARIANT', defaultValue: 'sm', variantOptions: ['sm', 'md'] } }, children: [] },
        ],
      },
    ],
  });
  const cssPath = tmp('globals.css', `@theme { } :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Whole file',
    '--target-url', 'https://figma.com/design/abc',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const report = fs.readFileSync(reportPath, 'utf8');
  assert.match(report, /Page: Page 1/);
});
```

- [ ] **Step 2: Run test, confirm failure**

- [ ] **Step 3: Update lint-engine cli.js to accept whole-file shape**

Edit `plugins/adhd/lib/lint-engine/cli.js`. Locate the section that calls `checkStructure(designCtx, ...)` and add this branching before:

```js
let structureViolations = [];
let pageGrouping = null;

if (designCtx && designCtx.mode === 'whole-file' && Array.isArray(designCtx.pages)) {
  // Whole-file mode: iterate pages, then top-level nodes per page
  pageGrouping = [];
  for (const page of designCtx.pages) {
    const pageEntry = { name: page.name, nodes: [] };
    for (const node of page.nodes) {
      const nodeViolations = checkStructure(node, { fileKey, namingConvention });
      // Tag each violation with the page name for grouping
      for (const v of nodeViolations) v._page = page.name;
      structureViolations.push(...nodeViolations);
      pageEntry.nodes.push({ name: node.name, type: node.type, violationCount: nodeViolations.length });
    }
    pageGrouping.push(pageEntry);
  }
} else {
  structureViolations = checkStructure(designCtx, { fileKey, namingConvention });
}
```

Then update the `formatReport` call to pass `pageGrouping`:

```js
const report = formatReport(
  { variable: variableViolations, structure: structureViolations },
  { ...meta, pageGrouping },
);
```

- [ ] **Step 4: Update report-formatter.js to handle the whole-file grouping**

Edit `plugins/adhd/lib/lint-engine/report-formatter.js`. Above the existing structure-issues section, add:

```js
if (meta.pageGrouping) {
  // Group structure violations by page, then by top-level node
  const byPage = new Map();
  for (const v of structure) {
    const pageName = v._page || '(unknown)';
    if (!byPage.has(pageName)) byPage.set(pageName, []);
    byPage.get(pageName).push(v);
  }
  for (const pageEntry of meta.pageGrouping) {
    lines.push(`## Page: ${pageEntry.name}`);
    lines.push('');
    for (const nodeEntry of pageEntry.nodes) {
      const status = nodeEntry.violationCount === 0 ? ' ✓ no violations' : ` ${nodeEntry.violationCount} violations`;
      lines.push(`### ${nodeEntry.name} (${nodeEntry.type}) ${status}`);
      // Show violations for this node
      const pageVs = byPage.get(pageEntry.name) || [];
      const nodeVs = pageVs.filter(v => v.nodePath?.split(' > ')[0] === nodeEntry.name);
      for (const v of nodeVs) {
        lines.push(`  - **${v.rule}** ${v.message} → ${v.nodePath} — [open](${v.deepLink})`);
      }
      lines.push('');
    }
  }
} else {
  // Existing single-target rendering: keep as-is
}
```

- [ ] **Step 5: Add the whole-file test for the report formatter**

Append to `plugins/adhd/lib/lint-engine/__tests__/report-formatter.test.js`:

```js
test('whole-file pageGrouping produces "Page: X" headers and node-level grouping', () => {
  const md = formatReport(
    { variable: [], structure: [
      { rule: 'STRUCT001', severity: 'error', nodeId: '1:1', nodePath: 'avatar > inner', message: 'Auto-layout missing', deepLink: 'http://x', _page: 'Page 1' },
    ] },
    {
      target: 'Whole file', targetUrl: 'http://x', runAt: new Date('2026-05-10T14:00:00Z'),
      pageGrouping: [{ name: 'Page 1', nodes: [{ name: 'avatar', type: 'COMPONENT_SET', violationCount: 1 }] }],
    },
  );
  assert.match(md, /## Page: Page 1/);
  assert.match(md, /### avatar \(COMPONENT_SET\)/);
  assert.match(md, /STRUCT001/);
});
```

- [ ] **Step 6: Run all lint-engine tests**

```bash
node --test plugins/adhd/lib/lint-engine/__tests__/
```
Expected: all tests pass (existing 58 + 2 new).

- [ ] **Step 7: Update /adhd:lint SKILL.md**

Edit `plugins/adhd/skills/lint/SKILL.md`:

1. Replace `allowed-tools` line with:
   ```
   allowed-tools: Read Write Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
   ```

2. Replace the description with:
   ```
   description: "Validate Figma frames/components/pages or the entire file against the local Tailwind design system + frame-structure best practices. Reads adhd.config.ts at the repo root. Read-only — no writes. Optional argument: a Figma URL with node-id (scoped lint). With no argument, lints the whole file."
   ```

3. Replace `argument-hint` with:
   ```
   argument-hint: "[<figma-url-with-node-id>]"
   ```

4. In Phase 2 (Resolve target node), add a top-level branch:
   - If `$ARGUMENTS` is empty → whole-file mode. Skip target resolution. The extract script will return ALL pages and ALL top-level lintable nodes.
   - If a URL is provided → scoped mode (existing behavior).

5. Replace Phase 3 with `use_figma`-based extraction. The skill should construct a JS string with two branches:
   - **Whole-file**: enumerate `figma.root.children`; for each page, find every COMPONENT_SET, top-level COMPONENT, and top-level FRAME; serialize each subtree. Return `{ mode: 'whole-file', pages: [{name, nodes: [...serializedSubtrees...]}] }`.
   - **Scoped**: take a node-id; serialize that subtree. Return the subtree directly (existing shape, no `mode` field).

   The serializer is the same `serializeNode()` function used in our earlier fixture work — captures `id`, `name`, `type`, `layoutMode`, padding/spacing/radius fields, fills, strokes, effects, boundVariables, componentPropertyDefinitions (for COMPONENT_SET), variantProperties, textStyleId/effectStyleId, etc.

   Save the response to `/tmp/adhd-lint/ctx.json`. Save `mcp__plugin_figma_figma__use_figma`'s `get_variable_defs` (or equivalent extraction) to `/tmp/adhd-lint/vars.json`. Note: get_variable_defs is from the *local* Figma MCP; with the remote MCP, run a small extraction inside use_figma to get the variables referenced by the target node(s) and return them in the same shape.

6. Phase 4 (run the engine) stays the same — invoke the lint-engine CLI as before.

7. Phase 5 (present results) — update the summary text to reflect whole-file mode when applicable: "✓ No issues found across all 12 top-level nodes." or "✗ N errors across X nodes on Y pages."

The full revised SKILL.md is large; the editor should preserve the existing common-errors table at the bottom and just rewrite Phases 2–5 per the above.

- [ ] **Step 8: Validate frontmatter**

```bash
node scripts/validate-skill-frontmatter.js
```
Expected: 4/4 valid.

- [ ] **Step 9: Commit**

```bash
git add plugins/adhd/lib/lint-engine/cli.js \
        plugins/adhd/lib/lint-engine/report-formatter.js \
        plugins/adhd/lib/lint-engine/__tests__/cli.test.js \
        plugins/adhd/lib/lint-engine/__tests__/report-formatter.test.js \
        plugins/adhd/skills/lint/SKILL.md
git commit -m "Expand /adhd:lint to whole-file mode; switch to use_figma extraction"
```

---

## Task 12: Improve /adhd:lint missing-token error message

**Files:**
- Modify: `plugins/adhd/lib/lint-engine/variable-categorizer.js`
- Modify: `plugins/adhd/lib/lint-engine/report-formatter.js`
- Test: `plugins/adhd/lib/lint-engine/__tests__/variable-categorizer.test.js`

- [ ] **Step 1: Add a test for the new hint message**

Append to `plugins/adhd/lib/lint-engine/__tests__/variable-categorizer.test.js`:

```js
test('missing variables include a suggested-fix hint', () => {
  const violations = categorizeVariables(
    { 'Primitives/color/brand/accent': '#5e3aee' },
    { primitives: {}, exposure: {}, light: {}, dark: {} },
  );
  const m = violations.find(v => v.status === 'missing');
  assert.ok(m);
  assert.equal(m.hint, 'Run /adhd:pull-design-system to import this token.');
});
```

- [ ] **Step 2: Run test, confirm failure**

- [ ] **Step 3: Add `hint` field**

Edit `plugins/adhd/lib/lint-engine/variable-categorizer.js`. Locate the missing-status return path and add `hint: 'Run /adhd:pull-design-system to import this token.'` to the violation object.

- [ ] **Step 4: Update report formatter to render the hint**

Edit `plugins/adhd/lib/lint-engine/report-formatter.js`. In the "Missing locally" section, render the hint after the variable line:

```
- `color/brand/accent` → `#5e3aee` ([open](deep-link))
  → Run /adhd:pull-design-system to import this token.
```

- [ ] **Step 5: Run tests**

```bash
node --test plugins/adhd/lib/lint-engine/__tests__/
```
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/lint-engine/variable-categorizer.js \
        plugins/adhd/lib/lint-engine/report-formatter.js \
        plugins/adhd/lib/lint-engine/__tests__/variable-categorizer.test.js
git commit -m "Add fix-up hint to missing-variable violations (suggest /adhd:pull-design-system)"
```

---

## Task 13: Hygiene — README, gitignore, marketplace metadata

**Files:**
- Modify: `README.md`
- Modify: `example/.gitignore`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update README command table**

Edit `README.md`. Find the command table (it currently lists `config`, `lint`, `sync`, `export-for-figma`, `to-dtcg`). Replace with:

```markdown
| Command | Direction | What it does |
|---|---|---|
| `/adhd:config` | — | Interactive wizard that produces `adhd.config.ts` |
| `/adhd:lint` | read-only | Validates the configured Figma file (or a single frame) against the local design system + structure best-practices |
| `/adhd:push-design-system` | code → Figma | Pushes globals.css variables + named styles into Figma directly via the remote MCP |
| `/adhd:pull-design-system` | Figma → code | Pulls Figma variables + named styles into globals.css |
```

Remove any sections referencing `/adhd:to-dtcg`, `/adhd:export-for-figma`, `TokensBrücke`, or DTCG JSON exports.

Update the install/setup section to note that `/adhd:push-design-system` and `/adhd:pull-design-system` require the official Figma plugin: `claude plugin install figma@claude-plugins-official`.

- [ ] **Step 2: Update example/.gitignore**

Edit `example/.gitignore`. The existing entry `adhd-export-for-figma.json` is now obsolete; replace with:

```
# ADHD command outputs
adhd-lint-report.md
adhd-push-result.json
adhd-pull-result.json
```

- [ ] **Step 3: Update marketplace metadata**

Edit `.claude-plugin/marketplace.json`. Update the description:

```json
{
  "name": "adhd",
  "source": "./plugins/adhd",
  "description": "Push, pull, and lint design tokens between Tailwind v4 and Figma via the remote MCP."
}
```

- [ ] **Step 4: Run all tests + validator**

```bash
node --test plugins/adhd/lib/lint-engine/__tests__/ plugins/adhd/lib/design-system/__tests__/
node scripts/validate-skill-frontmatter.js
```
Expected: all passing (lint-engine ~60 tests + design-system ~30 tests = ~90 tests; 4/4 skills valid).

- [ ] **Step 5: Commit**

```bash
git add README.md example/.gitignore .claude-plugin/marketplace.json
git commit -m "Update README, gitignore, marketplace for push/pull architecture"
```

---

## Self-review checklist

- [ ] **Spec coverage:**
  - Spec §Architecture (4 commands, no leader, no DTCG) → Task 1 (deletion), Tasks 9-10 (push/pull skills), Task 11 (lint expansion)
  - Spec §Conflict-resolution model → Task 5 (comparator) + Tasks 9-10 (skill prompt flow)
  - Spec §Translation layer → Tasks 3, 4, 6, 7 (parsers + writers + actions)
  - Spec §Collection conventions → Task 7 (figma-write-script applies SCOPES + naming)
  - Spec §Lint integration (whole-file + drift hints) → Tasks 11, 12
  - Spec §Migration table → Task 1 (deletions) + Task 13 (hygiene)
  - Spec §Acceptance criteria — all 16 mapped:
    - #1-2 (push behavior) → Task 9 + figma-write-script
    - #3-5 (prompt UX + batch confirm + cancel) → Task 9 Phase 4
    - #6 (pull symmetric) → Task 10
    - #7 (alias round-trip) → Task 3 (code-parser) + Task 4 (figma-parser) + Task 7 (write-actions)
    - #8 (drift detection) → Task 9 Phase 6 + Task 10 Phase 6
    - #9 (lint missing-token error) → Task 12
    - #10 (additive policy) → Task 7 (figma-write-actions tests)
    - #11 (deletions) → Task 1
    - #12-13 (whole-file lint) → Task 11
    - #14 (no exposure-only push) → Task 7 (figma-write-actions filters exposure)
    - #15 (pull preserves @theme inline) → Task 6 (code-writer's set-exposure action)
    - #16 (exposure filtered from compare) → Task 5 (comparator test asserts this)

- [ ] **Placeholder scan:** all tasks have concrete code, exact file paths, expected test counts.

- [ ] **Type consistency:**
  - `parseCodeDesignSystem(css|path) → { tokens, exposure }` (Task 3) → consumed by `compareDesignSystems` (Task 5) and `cli.js` (Task 8) ✓
  - `parseFigmaDesignSystem(extract) → { tokens, exposure: [], styles }` (Task 4) → same consumers ✓
  - `compareDesignSystems(code, figma) → { same, conflict, codeOnly, figmaOnly }` (Task 5) → consumed by `buildFigmaActions` (Task 7) ✓
  - `buildFigmaActions(diff, resolutions, direction) → actions[]` (Task 7) → consumed by `cli.js apply` (Task 8) and skills (Tasks 9, 10) ✓
  - `applyToCss(css, actions) → string` (Task 6) → consumed by pull skill (Task 10) Phase 7 ✓
  - Token shape `{ domain, path, values: {[mode]: TokenValue} }` consistent across parsers and consumers ✓
  - TokenValue union `{ type: 'literal', value } | { type: 'alias', target }` consistent across parsers and comparator ✓
