# /adhd:pull-component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/adhd:pull-component` — pulls a Figma Component Set back into a React source file, updating only design-token lookup tables and union type members; function body and JSX never modified.

**Architecture:** Zero-deps Node library at `plugins/adhd/lib/pull-component/`, mirroring the shape of `lib/push-component/`. Single skill at `plugins/adhd/skills/pull-component/SKILL.md` orchestrating an 11-phase flow. The React file is its own snapshot — no external state stored. Mapping (component path → Figma URL) lives in `adhd.config.ts` under `components.<path>.figma.url`, written by push on first push and by pull on first scaffold. Pre-flight reuses `lint-engine`'s `checkStructure` + variable-categorizer; class-resolver re-exports lint-engine's theme-parser + variable-categorizer to enforce one canonical Tailwind-to-design-token resolution.

**Tech Stack:** Node 20 (lib runs zero-deps), TypeScript Compiler API (transitive dep via Next.js for parse-react.js), `node --test` runner, Figma MCP `use_figma`/`generate_figma_design` invoked from the SKILL only.

---

## File structure (lock-in)

**New library — `plugins/adhd/lib/pull-component/`:**

| File | Responsibility |
|---|---|
| `parse-react.js` | TS compiler API walker; extract unions, props interface, lookup tables, function-body bounds |
| `class-resolver.js` | Re-exports lint-engine theme-parser + variable-categorizer; tokenizes multi-class strings; resolves each to design-token tuple |
| `differ.js` | Pure: `(localExtract, figmaExtract) → diff.json` |
| `apply.js` | Pure: `(sourceText, resolutions) → newSourceText`; preserves whitespace/comments/line endings |
| `config-writer.js` | Add/read `components.<path>.figma.url` in `adhd.config.ts`; idempotent |
| `cli.js` | Subcommands: `parse`, `extract`, `diff`, `apply`, `config-write` |
| `README.md` | One-paragraph module readme |
| `__tests__/parse-react.test.js` | Avatar fixture extraction tests |
| `__tests__/class-resolver.test.js` | Tailwind resolution tests |
| `__tests__/differ.test.js` | Diff shape tests |
| `__tests__/apply.test.js` | Source rewrite tests |
| `__tests__/config-writer.test.js` | Config update tests |
| `__tests__/cli.test.js` | Subcommand surface tests |
| `__fixtures__/badge-base.tsx` | Minimal synthetic component (Badge with 2 sizes + 2 variants) for fast unit tests |
| `__fixtures__/badge-figma-clean.json` | Figma extract matching `badge-base.tsx` |
| `__fixtures__/badge-figma-cell-change.json` | 1 cell differs |
| `__fixtures__/badge-figma-added-variant.json` | Figma has new variant value |
| `__fixtures__/badge-figma-removed-variant.json` | Figma missing a variant value |
| `__fixtures__/badge-figma-unbound.json` | Figma has unbound raw values |
| `__fixtures__/badge-after-cell-change.tsx` | Golden output after applying cell change |
| `__fixtures__/badge-after-added-variant.tsx` | Golden output after adding variant |
| `__fixtures__/badge-after-removed-variant.tsx` | Golden output after removing variant |
| `__fixtures__/badge-after-unbound-allowed.tsx` | Golden output after `--allow-unbound` confirm |

**New skill — `plugins/adhd/skills/pull-component/SKILL.md`:**
The 11-phase orchestrator, `disable-model-invocation: true`.

**Modified files:**
- `plugins/adhd/skills/push-component/SKILL.md` — insert mapping-write step between Phase 11 finalize and Phase 12 report
- `.claude-plugin/marketplace.json` — bump description to list 6 commands
- `README.md` — add pull-component row to command table; add scoped subsection
- `.github/workflows/ci.yml` — add `--test plugins/adhd/lib/pull-component/__tests__/`

---

## Task 1: Scaffold library, CI step, and the synthetic Badge fixture

**Files:**
- Create: `plugins/adhd/lib/pull-component/cli.js` (stub)
- Create: `plugins/adhd/lib/pull-component/README.md`
- Create: `plugins/adhd/lib/pull-component/__tests__/cli.test.js`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-base.tsx`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test for cli `--help`**

`plugins/adhd/lib/pull-component/__tests__/cli.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints subcommand usage and exits 0', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /parse/);
  assert.match(result.stdout, /extract/);
  assert.match(result.stdout, /diff/);
  assert.match(result.stdout, /apply/);
  assert.match(result.stdout, /config-write/);
});

test('cli with no args exits 2 with usage', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  const result = spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/cli.test.js`
Expected: FAIL — `cli.js` does not exist.

- [ ] **Step 3: Implement the cli stub**

`plugins/adhd/lib/pull-component/cli.js`:

```javascript
#!/usr/bin/env node
'use strict';

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
  cli.js parse <component-path> --output <manifest.json>
  cli.js extract <figma-state.json> --output <figma.json>
  cli.js diff --local <local.json> --figma <figma.json> --output <diff.json>
  cli.js apply --source <component.tsx> --resolutions <resolutions.json> --output <newsource.tsx>
  cli.js config-write --config <adhd.config.ts> --path <relative-path> --figma-url <url>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];
  // Subcommands wired in later tasks. Reject unknown to keep behavior strict.
  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
```

- [ ] **Step 4: Add the synthetic Badge fixture**

`plugins/adhd/lib/pull-component/__fixtures__/badge-base.tsx`:

```tsx
export type BadgeSize = "sm" | "md" | "lg";
export type BadgeTone = "neutral" | "danger";

export interface BadgeProps {
  label: string;
  size?: BadgeSize;
  tone?: BadgeTone;
}

export const BADGE_BOX: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5",
  md: "px-3 py-1",
  lg: "px-4 py-2",
};

export const BADGE_TEXT: Record<BadgeSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  danger: "bg-red-100 text-red-700",
};

export function Badge({ label, size = "md", tone = "neutral" }: BadgeProps) {
  // Function body — pull never modifies this region.
  const box = BADGE_BOX[size];
  const text = BADGE_TEXT[size];
  const tonecls = BADGE_TONE[tone];
  return <span className={`${box} ${text} ${tonecls} rounded`}>{label}</span>;
}
```

- [ ] **Step 5: Add module README**

`plugins/adhd/lib/pull-component/README.md`:

```markdown
# lib/pull-component

Engine modules for `/adhd:pull-component`. Reads a Figma Component Set and
reconciles it back into a React source file. Updates lookup tables and
union types only — never modifies the function body or JSX.

Modules:
- `parse-react.js` — TS compiler API walker (extracts unions, props, lookup tables)
- `class-resolver.js` — wraps lint-engine's Tailwind-to-design-token resolution
- `differ.js` — pure: local + figma → diff
- `apply.js` — pure: source + resolutions → new source
- `config-writer.js` — manages `adhd.config.ts` component mappings
- `cli.js` — orchestrator with subcommands invoked by SKILL.md

See `docs/superpowers/specs/2026-05-10-adhd-pull-component.md` for the
authoritative spec.
```

- [ ] **Step 6: Add CI step**

Modify `.github/workflows/ci.yml`. Locate the `lib-tests` job, add after the push-component test step:

```yaml
      - name: Run pull-component tests
        run: node --test plugins/adhd/lib/pull-component/__tests__/
```

- [ ] **Step 7: Run tests, verify pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/`
Expected: 3 cli tests PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/adhd/lib/pull-component .github/workflows/ci.yml
git commit -m "Scaffold lib/pull-component with cli stub + badge fixture"
```

---

## Task 2: parse-react.js — extract unions, props, lookup tables from a React file

**Files:**
- Create: `plugins/adhd/lib/pull-component/parse-react.js`
- Create: `plugins/adhd/lib/pull-component/__tests__/parse-react.test.js`

- [ ] **Step 1: Write the failing tests**

`plugins/adhd/lib/pull-component/__tests__/parse-react.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseReactComponent } = require('../parse-react');

const BADGE = fs.readFileSync(
  path.resolve(__dirname, '..', '__fixtures__', 'badge-base.tsx'),
  'utf8',
);

test('extracts string literal unions', () => {
  const result = parseReactComponent(BADGE);
  assert.deepEqual(result.unions.BadgeSize, ['sm', 'md', 'lg']);
  assert.deepEqual(result.unions.BadgeTone, ['neutral', 'danger']);
});

test('extracts props interface with union references', () => {
  const result = parseReactComponent(BADGE);
  assert.equal(result.componentName, 'Badge');
  assert.deepEqual(result.props.size, { unionRef: 'BadgeSize', optional: true });
  assert.deepEqual(result.props.tone, { unionRef: 'BadgeTone', optional: true });
  assert.deepEqual(result.props.label, { type: 'string', optional: false });
});

test('extracts single-axis Record<Union, string> lookup tables', () => {
  const result = parseReactComponent(BADGE);
  assert.deepEqual(result.tables.BADGE_BOX, {
    axis: 'BadgeSize',
    nested: false,
    entries: { sm: 'px-2 py-0.5', md: 'px-3 py-1', lg: 'px-4 py-2' },
  });
  assert.deepEqual(result.tables.BADGE_TONE, {
    axis: 'BadgeTone',
    nested: false,
    entries: { neutral: 'bg-zinc-100 text-zinc-700', danger: 'bg-red-100 text-red-700' },
  });
});

test('records function body bounds (start/end positions) and never visits inside', () => {
  const result = parseReactComponent(BADGE);
  // Body bounds must encompass the function body. Anything between
  // result.functionBody.start and .end is OFF LIMITS for apply().
  assert.ok(result.functionBody.start > 0);
  assert.ok(result.functionBody.end > result.functionBody.start);
  // The string at those bounds should contain "return" (the JSX return)
  assert.match(BADGE.slice(result.functionBody.start, result.functionBody.end), /return </);
});

test('handles a 2-axis nested Record table', () => {
  const SOURCE = `
export type S = "a" | "b";
export type T = "x" | "y";
export interface FooProps { s?: S; t?: T; }
export const T2: Record<S, Record<T, string>> = {
  a: { x: "p-1", y: "p-2" },
  b: { x: "p-3", y: "p-4" },
};
export function Foo({ s = "a", t = "x" }: FooProps) { return <span />; }
`;
  const result = parseReactComponent(SOURCE);
  assert.deepEqual(result.tables.T2, {
    axis: 'S',
    nested: true,
    innerAxis: 'T',
    entries: { a: { x: 'p-1', y: 'p-2' }, b: { x: 'p-3', y: 'p-4' } },
  });
});

test('ignores tables with non-string value types', () => {
  const SOURCE = `
export type S = "a" | "b";
export interface FooProps { s?: S; }
export const SIZE_PX: Record<S, number> = { a: 1, b: 2 };
export function Foo() { return <span />; }
`;
  const result = parseReactComponent(SOURCE);
  assert.equal(result.tables.SIZE_PX, undefined);
});

test('ignores tables defined inside a function body', () => {
  const SOURCE = `
export type S = "a" | "b";
export interface FooProps { s?: S; }
export function Foo() {
  const INLINE: Record<S, string> = { a: "x", b: "y" };
  return <span />;
}
`;
  const result = parseReactComponent(SOURCE);
  assert.equal(result.tables.INLINE, undefined);
});

test('aborts on file with no exported function component', () => {
  const SOURCE = `export const NOT_A_COMPONENT = 42;`;
  assert.throws(() => parseReactComponent(SOURCE), /no exported function component/i);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/parse-react.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parse-react.js**

`plugins/adhd/lib/pull-component/parse-react.js`:

```javascript
'use strict';

const ts = require('typescript');

function parseReactComponent(source) {
  const sourceFile = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const unions = {};
  const props = {};
  const tables = {};
  let componentName = null;
  let propsInterfaceName = null;
  let functionBody = null;

  // Pass 1: union aliases, props interface, function body bounds, function name.
  for (const stmt of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && ts.isUnionTypeNode(stmt.type)) {
      const members = [];
      let allLiterals = true;
      for (const member of stmt.type.types) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
          members.push(member.literal.text);
        } else {
          allLiterals = false;
          break;
        }
      }
      if (allLiterals) unions[stmt.name.text] = members;
    }
    if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && /Props$/.test(stmt.name.text)) {
      propsInterfaceName = stmt.name.text;
      const memberList = ts.isInterfaceDeclaration(stmt) ? stmt.members : (ts.isTypeLiteralNode(stmt.type) ? stmt.type.members : []);
      for (const member of memberList) {
        if (!ts.isPropertySignature(member) || !member.name) continue;
        const propName = member.name.getText(sourceFile);
        const optional = !!member.questionToken;
        if (member.type && ts.isTypeReferenceNode(member.type)) {
          const refName = member.type.typeName.getText(sourceFile);
          if (unions[refName]) {
            props[propName] = { unionRef: refName, optional };
          } else {
            props[propName] = { type: refName, optional };
          }
        } else if (member.type) {
          const kind = member.type.kind;
          if (kind === ts.SyntaxKind.StringKeyword) props[propName] = { type: 'string', optional };
          else if (kind === ts.SyntaxKind.NumberKeyword) props[propName] = { type: 'number', optional };
          else if (kind === ts.SyntaxKind.BooleanKeyword) props[propName] = { type: 'boolean', optional };
          else props[propName] = { type: 'unknown', optional };
        }
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.modifiers && stmt.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && stmt.name && stmt.body) {
      componentName = stmt.name.text;
      functionBody = { start: stmt.body.getStart(sourceFile), end: stmt.body.getEnd() };
    }
  }

  if (!componentName) {
    throw new Error('No exported function component found in source');
  }

  // Pass 2: lookup tables. Only top-level VariableStatement with a Record<Union, string> annotation.
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.name || !ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      const annot = decl.type;
      if (!annot || !ts.isTypeReferenceNode(annot)) continue;
      if (annot.typeName.getText(sourceFile) !== 'Record') continue;
      if (!annot.typeArguments || annot.typeArguments.length !== 2) continue;
      const outer = annot.typeArguments[0];
      const inner = annot.typeArguments[1];
      const outerName = outer.getText(sourceFile);
      if (!unions[outerName]) continue;

      const init = decl.initializer;
      if (!init || !ts.isObjectLiteralExpression(init)) continue;

      // 1-axis: Record<Union, string>
      if (inner.kind === ts.SyntaxKind.StringKeyword) {
        const entries = {};
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : (ts.isStringLiteral(prop.name) ? prop.name.text : null);
          if (!key) continue;
          if (!ts.isStringLiteral(prop.initializer)) continue;
          entries[key] = prop.initializer.text;
        }
        tables[name] = { axis: outerName, nested: false, entries };
        continue;
      }

      // 2-axis: Record<OuterUnion, Record<InnerUnion, string>>
      if (ts.isTypeReferenceNode(inner) && inner.typeName.getText(sourceFile) === 'Record' && inner.typeArguments && inner.typeArguments.length === 2 && inner.typeArguments[1].kind === ts.SyntaxKind.StringKeyword) {
        const innerName = inner.typeArguments[0].getText(sourceFile);
        if (!unions[innerName]) continue;
        const entries = {};
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const outerKey = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : (ts.isStringLiteral(prop.name) ? prop.name.text : null);
          if (!outerKey || !ts.isObjectLiteralExpression(prop.initializer)) continue;
          entries[outerKey] = {};
          for (const inProp of prop.initializer.properties) {
            if (!ts.isPropertyAssignment(inProp)) continue;
            const innerKey = inProp.name && ts.isIdentifier(inProp.name) ? inProp.name.text : (ts.isStringLiteral(inProp.name) ? inProp.name.text : null);
            if (!innerKey) continue;
            if (!ts.isStringLiteral(inProp.initializer)) continue;
            entries[outerKey][innerKey] = inProp.initializer.text;
          }
        }
        tables[name] = { axis: outerName, nested: true, innerAxis: innerName, entries };
      }
    }
  }

  return { componentName, propsInterfaceName, unions, props, tables, functionBody };
}

module.exports = { parseReactComponent };
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/parse-react.test.js`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/pull-component/parse-react.js plugins/adhd/lib/pull-component/__tests__/parse-react.test.js
git commit -m "parse-react: extract unions, props, lookup tables via TS compiler API"
```

---

## Task 3: class-resolver.js — wrap lint-engine for Tailwind-to-design-token resolution

**Files:**
- Create: `plugins/adhd/lib/pull-component/class-resolver.js`
- Create: `plugins/adhd/lib/pull-component/__tests__/class-resolver.test.js`

- [ ] **Step 1: Write the failing tests**

`plugins/adhd/lib/pull-component/__tests__/class-resolver.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveClassString, resolveClass } = require('../class-resolver');

const SAMPLE_GLOBALS_CSS = `
@import "tailwindcss";
@theme {
  --color-zinc-100: oklch(0.967 0.001 286.375);
  --color-red-100: oklch(0.936 0.032 17.717);
  --color-red-700: oklch(0.444 0.177 26.899);
  --color-zinc-700: oklch(0.37 0.013 285.805);
  --spacing: 0.25rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
}
`;

test('resolves a single utility class to a design-token tuple', () => {
  const r = resolveClass('bg-red-100', SAMPLE_GLOBALS_CSS);
  assert.equal(r.domain, 'color');
  assert.equal(r.path, 'red/100');
});

test('returns null for an unknown utility', () => {
  assert.equal(resolveClass('bg-not-a-color', SAMPLE_GLOBALS_CSS), null);
});

test('classifies layout-only tokens as ignored', () => {
  assert.equal(resolveClass('flex', SAMPLE_GLOBALS_CSS), null);
  assert.equal(resolveClass('items-center', SAMPLE_GLOBALS_CSS), null);
});

test('resolves a typography token', () => {
  const r = resolveClass('text-xs', SAMPLE_GLOBALS_CSS);
  assert.equal(r.domain, 'typography');
  assert.equal(r.path, 'text/xs');
});

test('resolveClassString splits multi-class strings and returns per-token resolution', () => {
  const r = resolveClassString('bg-red-100 text-red-700 flex items-center px-2', SAMPLE_GLOBALS_CSS);
  // Returns an ARRAY of { token, resolved } entries
  const byToken = Object.fromEntries(r.map(e => [e.token, e.resolved]));
  assert.equal(byToken['bg-red-100'].domain, 'color');
  assert.equal(byToken['text-red-700'].domain, 'color');
  assert.equal(byToken['flex'], null);
  assert.equal(byToken['items-center'], null);
});

test('preserves token order in resolveClassString output', () => {
  const r = resolveClassString('px-2 py-1 bg-zinc-100', SAMPLE_GLOBALS_CSS);
  assert.deepEqual(r.map(e => e.token), ['px-2', 'py-1', 'bg-zinc-100']);
});

test('arbitrary-value tokens (text-[10px], h-[80px]) return marker resolved: { domain: "arbitrary" }', () => {
  const r = resolveClass('text-[10px]', SAMPLE_GLOBALS_CSS);
  assert.equal(r && r.domain, 'arbitrary');
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/class-resolver.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement class-resolver.js**

`plugins/adhd/lib/pull-component/class-resolver.js`:

```javascript
'use strict';

// Re-exports + wraps lint-engine's Tailwind-to-design-token resolution.
// This is the symmetric-pipeline assertion — pull and lint share one resolver.

const { parseGlobalsCss } = require('../lint-engine/theme-parser');
const { categorizeVariable } = require('../lint-engine/variable-categorizer');

// Layout-only token prefixes — never represent design tokens.
const LAYOUT_PREFIXES = [
  'flex', 'grid', 'block', 'inline', 'hidden', 'absolute', 'relative', 'fixed', 'sticky',
  'items-', 'justify-', 'content-', 'self-', 'place-', 'order-', 'col-', 'row-',
  'overflow-', 'whitespace-', 'truncate', 'select-', 'cursor-', 'pointer-events-',
  'z-', 'opacity-', 'visible', 'invisible', 'isolate',
  'ring-offset-', 'outline-none', 'appearance-',
];

function isLayoutOnly(token) {
  return LAYOUT_PREFIXES.some(p => token === p.replace(/-$/, '') || token.startsWith(p));
}

// "bg-red-100" → { utility: "bg", value: "red-100" }
// "text-xs"    → { utility: "text", value: "xs" }
// "text-[10px]"→ { utility: "text", value: "[10px]" }
function parseToken(token) {
  const m = /^(bg|text|border|fill|stroke|h|w|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|rounded)-(.+)$/.exec(token);
  if (!m) return null;
  return { utility: m[1], value: m[2] };
}

// Map Tailwind utility prefix → design-token domain.
const UTILITY_TO_DOMAIN = {
  bg: 'color', text: 'typography-or-color', border: 'color', fill: 'color', stroke: 'color',
  h: 'sizing', w: 'sizing',
  p: 'spacing', px: 'spacing', py: 'spacing', pt: 'spacing', pb: 'spacing', pl: 'spacing', pr: 'spacing',
  m: 'spacing', mx: 'spacing', my: 'spacing', mt: 'spacing', mb: 'spacing', ml: 'spacing', mr: 'spacing',
  gap: 'spacing', rounded: 'radius',
};

function resolveClass(token, globalsCss) {
  if (isLayoutOnly(token)) return null;
  const parts = parseToken(token);
  if (!parts) return null;
  const { utility, value } = parts;

  // Arbitrary value (e.g. text-[10px], h-[80px]) — flagged with domain: "arbitrary".
  if (value.startsWith('[') && value.endsWith(']')) {
    return { domain: 'arbitrary', token, raw: value.slice(1, -1) };
  }

  const theme = parseGlobalsCss(globalsCss);

  if (utility === 'text') {
    // text-xs / text-sm / text-base → typography variable
    if (theme && theme.typography && theme.typography['text/' + value] !== undefined) {
      return { domain: 'typography', path: 'text/' + value };
    }
    // text-red-700 → color variable
    if (theme && theme.color && theme.color[value.replace(/-/g, '/')] !== undefined) {
      return { domain: 'color', path: value.replace(/-/g, '/') };
    }
    return null;
  }

  if (utility === 'bg' || utility === 'border' || utility === 'fill' || utility === 'stroke') {
    const path = value.replace(/-/g, '/');
    if (theme && theme.color && theme.color[path] !== undefined) {
      return { domain: 'color', path };
    }
    return null;
  }

  if (utility === 'rounded') {
    if (theme && theme.radius && theme.radius[value] !== undefined) {
      return { domain: 'radius', path: value };
    }
    return null;
  }

  // Sizing & spacing: Tailwind v4 uses a multiplier — `h-6` means 6 * --spacing.
  // For the diff, we just record the utility token; categorizeVariable does the
  // actual var-resolution. v1 records the resolved px value when possible.
  if (UTILITY_TO_DOMAIN[utility] === 'spacing' || UTILITY_TO_DOMAIN[utility] === 'sizing') {
    return { domain: UTILITY_TO_DOMAIN[utility], path: utility + '/' + value };
  }

  return null;
}

function resolveClassString(classString, globalsCss) {
  const tokens = (classString || '').split(/\s+/).filter(Boolean);
  return tokens.map(token => ({ token, resolved: resolveClass(token, globalsCss) }));
}

module.exports = { resolveClass, resolveClassString };
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/class-resolver.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/pull-component/class-resolver.js plugins/adhd/lib/pull-component/__tests__/class-resolver.test.js
git commit -m "class-resolver: wrap lint-engine theme-parser for class-to-token resolution"
```

---

## Task 4: differ.js — pure function for local vs Figma diff

**Files:**
- Create: `plugins/adhd/lib/pull-component/differ.js`
- Create: `plugins/adhd/lib/pull-component/__tests__/differ.test.js`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-figma-clean.json`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-figma-cell-change.json`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-figma-added-variant.json`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-figma-removed-variant.json`

- [ ] **Step 1: Write the four Figma fixture files**

The Figma extract shape mirrors what the SKILL produces by serializing a Component Set. Each variant has resolved design tokens per relevant property; pull does NOT need the full Figma tree, only the per-variant per-property bound values.

`badge-figma-clean.json`:

```json
{
  "componentSetId": "100:1",
  "componentName": "Badge",
  "variantAxes": {
    "size": ["sm", "md", "lg"],
    "tone": ["neutral", "danger"]
  },
  "variants": [
    { "props": { "size": "sm", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-2 py-0.5", "BADGE_TEXT": "text-xs", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "md", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-3 py-1", "BADGE_TEXT": "text-sm", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "lg", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-4 py-2", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "sm", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-2 py-0.5", "BADGE_TEXT": "text-xs", "BADGE_TONE": "bg-red-100 text-red-700" } },
    { "props": { "size": "md", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-3 py-1", "BADGE_TEXT": "text-sm", "BADGE_TONE": "bg-red-100 text-red-700" } },
    { "props": { "size": "lg", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-4 py-2", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-red-100 text-red-700" } }
  ]
}
```

`badge-figma-cell-change.json`: same as clean except BADGE_TEXT.md is `text-base` (changed from `text-sm`):

```json
{
  "componentSetId": "100:1",
  "componentName": "Badge",
  "variantAxes": {
    "size": ["sm", "md", "lg"],
    "tone": ["neutral", "danger"]
  },
  "variants": [
    { "props": { "size": "sm", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-2 py-0.5", "BADGE_TEXT": "text-xs", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "md", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-3 py-1", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "lg", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-4 py-2", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "sm", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-2 py-0.5", "BADGE_TEXT": "text-xs", "BADGE_TONE": "bg-red-100 text-red-700" } },
    { "props": { "size": "md", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-3 py-1", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-red-100 text-red-700" } },
    { "props": { "size": "lg", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-4 py-2", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-red-100 text-red-700" } }
  ]
}
```

`badge-figma-added-variant.json`: clean plus a new size=xl variant:

```json
{
  "componentSetId": "100:1",
  "componentName": "Badge",
  "variantAxes": {
    "size": ["sm", "md", "lg", "xl"],
    "tone": ["neutral", "danger"]
  },
  "variants": [
    { "props": { "size": "sm", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-2 py-0.5", "BADGE_TEXT": "text-xs", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "md", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-3 py-1", "BADGE_TEXT": "text-sm", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "lg", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-4 py-2", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "xl", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-5 py-3", "BADGE_TEXT": "text-lg", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "sm", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-2 py-0.5", "BADGE_TEXT": "text-xs", "BADGE_TONE": "bg-red-100 text-red-700" } },
    { "props": { "size": "md", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-3 py-1", "BADGE_TEXT": "text-sm", "BADGE_TONE": "bg-red-100 text-red-700" } },
    { "props": { "size": "lg", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-4 py-2", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-red-100 text-red-700" } },
    { "props": { "size": "xl", "tone": "danger" }, "tokens": { "BADGE_BOX": "px-5 py-3", "BADGE_TEXT": "text-lg", "BADGE_TONE": "bg-red-100 text-red-700" } }
  ]
}
```

`badge-figma-removed-variant.json`: clean minus all `tone=danger` variants:

```json
{
  "componentSetId": "100:1",
  "componentName": "Badge",
  "variantAxes": {
    "size": ["sm", "md", "lg"],
    "tone": ["neutral"]
  },
  "variants": [
    { "props": { "size": "sm", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-2 py-0.5", "BADGE_TEXT": "text-xs", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "md", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-3 py-1", "BADGE_TEXT": "text-sm", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } },
    { "props": { "size": "lg", "tone": "neutral" }, "tokens": { "BADGE_BOX": "px-4 py-2", "BADGE_TEXT": "text-base", "BADGE_TONE": "bg-zinc-100 text-zinc-700" } }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`plugins/adhd/lib/pull-component/__tests__/differ.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseReactComponent } = require('../parse-react');
const { diffLocalVsFigma } = require('../differ');

const FX = (n) => path.resolve(__dirname, '..', '__fixtures__', n);
const BADGE = fs.readFileSync(FX('badge-base.tsx'), 'utf8');

function loadFigma(name) {
  return JSON.parse(fs.readFileSync(FX(name), 'utf8'));
}

test('clean figma produces empty diff', () => {
  const local = parseReactComponent(BADGE);
  const figma = loadFigma('badge-figma-clean.json');
  const diff = diffLocalVsFigma(local, figma);
  assert.deepEqual(diff.unionDiff, []);
  assert.deepEqual(diff.tableDiff, []);
  assert.deepEqual(diff.unmapped, []);
});

test('one cell change shows up in tableDiff', () => {
  const local = parseReactComponent(BADGE);
  const figma = loadFigma('badge-figma-cell-change.json');
  const diff = diffLocalVsFigma(local, figma);
  assert.equal(diff.tableDiff.length, 1);
  const t = diff.tableDiff[0];
  assert.equal(t.table, 'BADGE_TEXT');
  assert.equal(t.axis, 'size');
  assert.equal(t.cells.length, 1);
  assert.deepEqual(t.cells[0], { key: 'md', local: 'text-sm', figma: 'text-base' });
});

test('figma added a variant value → unionDiff has add entry', () => {
  const local = parseReactComponent(BADGE);
  const figma = loadFigma('badge-figma-added-variant.json');
  const diff = diffLocalVsFigma(local, figma);
  assert.equal(diff.unionDiff.length, 1);
  assert.deepEqual(diff.unionDiff[0], {
    union: 'BadgeSize', axis: 'size', add: ['xl'], remove: [],
  });
});

test('figma removed a variant value → unionDiff has remove entry', () => {
  const local = parseReactComponent(BADGE);
  const figma = loadFigma('badge-figma-removed-variant.json');
  const diff = diffLocalVsFigma(local, figma);
  const tone = diff.unionDiff.find(d => d.axis === 'tone');
  assert.ok(tone);
  assert.deepEqual(tone.remove, ['danger']);
});

test('figma has axis with no matching Record<...> → unmapped entry', () => {
  const local = parseReactComponent(BADGE);
  const figma = loadFigma('badge-figma-clean.json');
  // Synthesize an extra axis
  figma.variantAxes.theme = ['light', 'dark'];
  const diff = diffLocalVsFigma(local, figma);
  const unmapped = diff.unmapped.find(u => u.figmaAxis === 'theme');
  assert.ok(unmapped);
  assert.deepEqual(unmapped.values, ['light', 'dark']);
});
```

- [ ] **Step 3: Verify tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/differ.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement differ.js**

`plugins/adhd/lib/pull-component/differ.js`:

```javascript
'use strict';

// Pure function: (parseReactComponent output, figma extract) → diff
// Diff shape (see spec section "Build the diff"):
//   { unionDiff: [...], tableDiff: [...], unmapped: [...] }

function diffLocalVsFigma(local, figma) {
  const unionDiff = [];
  const tableDiff = [];
  const unmapped = [];

  // Build axis → union name lookup from props (e.g. props.size = { unionRef: "BadgeSize" })
  const axisToUnion = {};
  for (const [propName, propDef] of Object.entries(local.props || {})) {
    if (propDef.unionRef) axisToUnion[propName] = propDef.unionRef;
  }

  // --- Union diff: per axis, compare local union members vs figma variantAxes.
  for (const [axis, figmaMembers] of Object.entries(figma.variantAxes || {})) {
    const unionName = axisToUnion[axis];
    if (!unionName) {
      // Figma has an axis but local has no matching prop/union → unmapped.
      unmapped.push({ figmaAxis: axis, values: [...figmaMembers], reason: 'no matching prop/union' });
      continue;
    }
    const localMembers = local.unions[unionName] || [];
    const add = figmaMembers.filter(v => !localMembers.includes(v));
    const remove = localMembers.filter(v => !figmaMembers.includes(v));
    if (add.length || remove.length) {
      unionDiff.push({ union: unionName, axis, add, remove });
    }
  }

  // --- Table diff: for each local table, walk figma variants whose props match the table's axis keys.
  for (const [tableName, table] of Object.entries(local.tables || {})) {
    const axisName = Object.entries(axisToUnion).find(([, u]) => u === table.axis)?.[0];
    if (!axisName) continue; // axis not in props → can't reverse-resolve

    if (!table.nested) {
      const cells = [];
      // For each key in local table, find the figma value(s) for variants where props[axisName] === key.
      // If figma values differ within the group, take the first (consistent across non-axis dims is the convention).
      for (const key of Object.keys(table.entries)) {
        const matching = (figma.variants || []).filter(v => v.props && v.props[axisName] === key);
        if (matching.length === 0) continue; // figma doesn't have this variant (handled by unionDiff)
        const figmaValue = matching[0].tokens && matching[0].tokens[tableName];
        if (figmaValue === undefined) continue; // figma extract didn't include this token
        const localValue = table.entries[key];
        if (localValue !== figmaValue) {
          cells.push({ key, local: localValue, figma: figmaValue });
        }
      }
      if (cells.length) {
        tableDiff.push({ table: tableName, axis: axisName, cells });
      }
    } else {
      // 2-axis: outerKey + innerKey
      const innerAxisName = Object.entries(axisToUnion).find(([, u]) => u === table.innerAxis)?.[0];
      if (!innerAxisName) continue;
      const cells = [];
      for (const [outerKey, inner] of Object.entries(table.entries)) {
        for (const [innerKey, localValue] of Object.entries(inner)) {
          const matching = (figma.variants || []).filter(v =>
            v.props && v.props[axisName] === outerKey && v.props[innerAxisName] === innerKey,
          );
          if (matching.length === 0) continue;
          const figmaValue = matching[0].tokens && matching[0].tokens[tableName];
          if (figmaValue === undefined) continue;
          if (localValue !== figmaValue) {
            cells.push({ key: `${outerKey}.${innerKey}`, outerKey, innerKey, local: localValue, figma: figmaValue });
          }
        }
      }
      if (cells.length) {
        tableDiff.push({ table: tableName, axis: axisName, innerAxis: innerAxisName, cells });
      }
    }
  }

  return { unionDiff, tableDiff, unmapped };
}

module.exports = { diffLocalVsFigma };
```

- [ ] **Step 5: Verify tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/differ.test.js`
Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/pull-component/differ.js plugins/adhd/lib/pull-component/__tests__/differ.test.js plugins/adhd/lib/pull-component/__fixtures__/badge-figma-*.json
git commit -m "differ: pure function comparing local extract to figma variants"
```

---

## Task 5: apply.js — AST-aware source rewrite

**Files:**
- Create: `plugins/adhd/lib/pull-component/apply.js`
- Create: `plugins/adhd/lib/pull-component/__tests__/apply.test.js`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-after-cell-change.tsx`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-after-added-variant.tsx`
- Create: `plugins/adhd/lib/pull-component/__fixtures__/badge-after-removed-variant.tsx`

- [ ] **Step 1: Write the golden output fixtures**

`badge-after-cell-change.tsx` — same as `badge-base.tsx` except BADGE_TEXT.md changed from `"text-sm"` to `"text-base"`. Preserve all surrounding whitespace and comments.

```tsx
export type BadgeSize = "sm" | "md" | "lg";
export type BadgeTone = "neutral" | "danger";

export interface BadgeProps {
  label: string;
  size?: BadgeSize;
  tone?: BadgeTone;
}

export const BADGE_BOX: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5",
  md: "px-3 py-1",
  lg: "px-4 py-2",
};

export const BADGE_TEXT: Record<BadgeSize, string> = {
  sm: "text-xs",
  md: "text-base",
  lg: "text-base",
};

export const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  danger: "bg-red-100 text-red-700",
};

export function Badge({ label, size = "md", tone = "neutral" }: BadgeProps) {
  // Function body — pull never modifies this region.
  const box = BADGE_BOX[size];
  const text = BADGE_TEXT[size];
  const tonecls = BADGE_TONE[tone];
  return <span className={`${box} ${text} ${tonecls} rounded`}>{label}</span>;
}
```

`badge-after-added-variant.tsx` — adds `xl` to BadgeSize union and a new `xl` entry in each `Record<BadgeSize, ...>` table:

```tsx
export type BadgeSize = "sm" | "md" | "lg" | "xl";
export type BadgeTone = "neutral" | "danger";

export interface BadgeProps {
  label: string;
  size?: BadgeSize;
  tone?: BadgeTone;
}

export const BADGE_BOX: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5",
  md: "px-3 py-1",
  lg: "px-4 py-2",
  xl: "px-5 py-3",
};

export const BADGE_TEXT: Record<BadgeSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-lg",
};

export const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  danger: "bg-red-100 text-red-700",
};

export function Badge({ label, size = "md", tone = "neutral" }: BadgeProps) {
  // Function body — pull never modifies this region.
  const box = BADGE_BOX[size];
  const text = BADGE_TEXT[size];
  const tonecls = BADGE_TONE[tone];
  return <span className={`${box} ${text} ${tonecls} rounded`}>{label}</span>;
}
```

`badge-after-removed-variant.tsx` — removes `danger` from BadgeTone and from BADGE_TONE:

```tsx
export type BadgeSize = "sm" | "md" | "lg";
export type BadgeTone = "neutral";

export interface BadgeProps {
  label: string;
  size?: BadgeSize;
  tone?: BadgeTone;
}

export const BADGE_BOX: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5",
  md: "px-3 py-1",
  lg: "px-4 py-2",
};

export const BADGE_TEXT: Record<BadgeSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
};

export function Badge({ label, size = "md", tone = "neutral" }: BadgeProps) {
  // Function body — pull never modifies this region.
  const box = BADGE_BOX[size];
  const text = BADGE_TEXT[size];
  const tonecls = BADGE_TONE[tone];
  return <span className={`${box} ${text} ${tonecls} rounded`}>{label}</span>;
}
```

- [ ] **Step 2: Write the failing tests**

`plugins/adhd/lib/pull-component/__tests__/apply.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applyResolutions } = require('../apply');

const FX = (n) => path.resolve(__dirname, '..', '__fixtures__', n);
const BADGE = fs.readFileSync(FX('badge-base.tsx'), 'utf8');

test('empty resolutions returns byte-identical source', () => {
  const out = applyResolutions(BADGE, { unions: {}, tables: {} });
  assert.equal(out, BADGE);
});

test('single cell update preserves surrounding whitespace and other entries', () => {
  const resolutions = { unions: {}, tables: { BADGE_TEXT: { md: 'text-base' } } };
  const out = applyResolutions(BADGE, resolutions);
  const expected = fs.readFileSync(FX('badge-after-cell-change.tsx'), 'utf8');
  assert.equal(out, expected);
});

test('adding a union value appends to union and adds entry to every Record<That, ...> table', () => {
  const resolutions = {
    unions: { BadgeSize: { add: ['xl'], remove: [] } },
    tables: {
      BADGE_BOX: { xl: 'px-5 py-3' },
      BADGE_TEXT: { xl: 'text-lg' },
    },
  };
  const out = applyResolutions(BADGE, resolutions);
  const expected = fs.readFileSync(FX('badge-after-added-variant.tsx'), 'utf8');
  assert.equal(out, expected);
});

test('removing a union value strips it from union and from every Record<That, ...> table', () => {
  const resolutions = {
    unions: { BadgeTone: { add: [], remove: ['danger'] } },
    tables: {},
  };
  const out = applyResolutions(BADGE, resolutions);
  const expected = fs.readFileSync(FX('badge-after-removed-variant.tsx'), 'utf8');
  assert.equal(out, expected);
});

test('preserves CRLF line endings if input has them', () => {
  const crlfSource = BADGE.replace(/\n/g, '\r\n');
  const out = applyResolutions(crlfSource, { unions: {}, tables: { BADGE_TEXT: { md: 'text-base' } } });
  assert.ok(out.includes('\r\n'));
  assert.ok(!out.match(/[^\r]\n/));
});

test('does not modify text inside the function body region', () => {
  const sourceWithBodyHook = BADGE.replace(
    'const box = BADGE_BOX[size];',
    'const box = BADGE_BOX[size]; // hand-written',
  );
  const out = applyResolutions(sourceWithBodyHook, { unions: {}, tables: { BADGE_TEXT: { md: 'text-base' } } });
  assert.match(out, /BADGE_BOX\[size\]; \/\/ hand-written/);
});
```

- [ ] **Step 3: Verify tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/apply.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement apply.js**

`plugins/adhd/lib/pull-component/apply.js`:

```javascript
'use strict';

const ts = require('typescript');
const { parseReactComponent } = require('./parse-react');

// Pure function: source text + resolutions → new source text.
// Strategy:
//   1. Re-parse the source to get AST node positions for: unions and tables.
//   2. Compute edits as { start, end, newText }, ordered by descending start.
//   3. Apply edits to a single mutable string, splicing in reverse order so
//      earlier positions don't shift later ones.
// Function body bounds from parseReactComponent are NEVER referenced — we only
// touch the union type alias declarations and the lookup-table object literals.

function applyResolutions(source, resolutions) {
  const sourceFile = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const local = parseReactComponent(source);
  const edits = [];

  // 1. Union edits.
  for (const [unionName, change] of Object.entries(resolutions.unions || {})) {
    if (!change || ((!change.add || change.add.length === 0) && (!change.remove || change.remove.length === 0))) continue;
    const unionStmt = sourceFile.statements.find(s =>
      ts.isTypeAliasDeclaration(s) && s.name.text === unionName,
    );
    if (!unionStmt || !ts.isUnionTypeNode(unionStmt.type)) continue;
    const currentMembers = local.unions[unionName] || [];
    const removeSet = new Set(change.remove || []);
    const updated = currentMembers.filter(m => !removeSet.has(m)).concat((change.add || []).filter(m => !currentMembers.includes(m)));
    const newUnionText = updated.map(m => `"${m}"`).join(' | ');
    edits.push({
      start: unionStmt.type.getStart(sourceFile),
      end: unionStmt.type.getEnd(),
      newText: newUnionText,
    });
  }

  // Build a map: unionName → list of (tableName, table, varStmt, init)
  const tablesByUnion = {};
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.name || !ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      if (!local.tables[name]) continue;
      if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue;
      const axis = local.tables[name].axis;
      (tablesByUnion[axis] ||= []).push({ name, stmt, decl, init: decl.initializer });
    }
  }

  // 2. Cascade union add/remove into every table whose axis matches the union.
  for (const [unionName, change] of Object.entries(resolutions.unions || {})) {
    const targets = tablesByUnion[unionName] || [];
    for (const t of targets) {
      // Removal: drop properties whose key is in `remove`.
      if (change.remove && change.remove.length > 0) {
        const removeSet = new Set(change.remove);
        for (const prop of t.init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const keyName = prop.name && (ts.isIdentifier(prop.name) ? prop.name.text : (ts.isStringLiteral(prop.name) ? prop.name.text : null));
          if (keyName && removeSet.has(keyName)) {
            // Edit deletes the entire property + its trailing comma + leading newline/whitespace.
            const start = findLineStart(source, prop.getStart(sourceFile));
            const end = findEndOfPropertyLine(source, prop.getEnd());
            edits.push({ start, end, newText: '' });
          }
        }
      }
      // Addition: append a property at the end of the object literal.
      if (change.add && change.add.length > 0 && resolutions.tables && resolutions.tables[t.name]) {
        for (const newKey of change.add) {
          const newValue = resolutions.tables[t.name][newKey];
          if (newValue === undefined) continue;
          // Insertion point: just before the closing brace of the object literal.
          const closeBrace = t.init.getEnd() - 1; // the `}` itself
          // Detect indentation from the first existing property (if any).
          let indent = '  ';
          if (t.init.properties.length > 0) {
            const firstPropStart = t.init.properties[0].getStart(sourceFile);
            const lineStart = findLineStart(source, firstPropStart);
            indent = source.slice(lineStart, firstPropStart);
          }
          // If the off-system marker is needed, the resolutions.tables value should include it as a comment prefix.
          // For simplicity here, resolutions.tables values are plain strings; the SKILL preprocesses unbound
          // entries by setting resolutions.tables[name][key] to include the comment + newline.
          const newProp = `${indent}${newKey}: "${newValue}",\n`;
          edits.push({ start: closeBrace, end: closeBrace, newText: newProp });
        }
      }
    }
  }

  // 3. Cell-only updates: change property values where resolutions.tables specifies a key NOT covered by union add.
  for (const [tableName, cells] of Object.entries(resolutions.tables || {})) {
    const t = (Object.values(tablesByUnion).flat()).find(x => x.name === tableName);
    if (!t) continue;
    const axisUnion = local.tables[tableName].axis;
    const addedSet = new Set((resolutions.unions && resolutions.unions[axisUnion] && resolutions.unions[axisUnion].add) || []);
    for (const [key, newValue] of Object.entries(cells)) {
      if (addedSet.has(key)) continue; // already handled by addition path above
      // 2-axis table: key has form "outerKey.innerKey"
      if (local.tables[tableName].nested && key.includes('.')) {
        const [outerKey, innerKey] = key.split('.');
        const outerProp = t.init.properties.find(p =>
          ts.isPropertyAssignment(p) && p.name && ((ts.isIdentifier(p.name) && p.name.text === outerKey) || (ts.isStringLiteral(p.name) && p.name.text === outerKey)),
        );
        if (!outerProp || !ts.isObjectLiteralExpression(outerProp.initializer)) continue;
        const innerProp = outerProp.initializer.properties.find(p =>
          ts.isPropertyAssignment(p) && p.name && ((ts.isIdentifier(p.name) && p.name.text === innerKey) || (ts.isStringLiteral(p.name) && p.name.text === innerKey)),
        );
        if (!innerProp || !ts.isStringLiteral(innerProp.initializer)) continue;
        edits.push({
          start: innerProp.initializer.getStart(sourceFile),
          end: innerProp.initializer.getEnd(),
          newText: `"${newValue}"`,
        });
        continue;
      }
      // 1-axis
      const prop = t.init.properties.find(p =>
        ts.isPropertyAssignment(p) && p.name && ((ts.isIdentifier(p.name) && p.name.text === key) || (ts.isStringLiteral(p.name) && p.name.text === key)),
      );
      if (!prop || !ts.isStringLiteral(prop.initializer)) continue;
      edits.push({
        start: prop.initializer.getStart(sourceFile),
        end: prop.initializer.getEnd(),
        newText: `"${newValue}"`,
      });
    }
  }

  // Apply edits in reverse position order.
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

function findLineStart(source, position) {
  let i = position;
  while (i > 0 && source[i - 1] !== '\n') i--;
  return i;
}

function findEndOfPropertyLine(source, position) {
  // Move past trailing comma and any whitespace through the newline.
  let i = position;
  if (source[i] === ',') i++;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
  if (source[i] === '\r') i++;
  if (source[i] === '\n') i++;
  return i;
}

module.exports = { applyResolutions };
```

- [ ] **Step 5: Verify tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/apply.test.js`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/pull-component/apply.js plugins/adhd/lib/pull-component/__tests__/apply.test.js plugins/adhd/lib/pull-component/__fixtures__/badge-after-*.tsx
git commit -m "apply: AST-aware source rewrite scoped to unions + lookup tables"
```

---

## Task 6: config-writer.js — read and write component mappings in adhd.config.ts

**Files:**
- Create: `plugins/adhd/lib/pull-component/config-writer.js`
- Create: `plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`

- [ ] **Step 1: Write the failing tests**

`plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readComponentMapping, addComponentMapping } = require('../config-writer');

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
  const result = readComponentMapping(MINIMAL_CONFIG, 'app/components/badge.tsx');
  assert.equal(result, null);
});

test('readComponentMapping returns entry when path matches', () => {
  const result = readComponentMapping(WITH_COMPONENTS, 'app/components/avatar/index.tsx');
  assert.equal(result && result.figma.url, 'https://figma.com/design/ABC/?node-id=91-18');
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
  const { reverseLookupPath } = require('../config-writer');
  const path = reverseLookupPath(WITH_COMPONENTS, 'https://figma.com/design/ABC/?node-id=91-18');
  assert.equal(path, 'app/components/avatar/index.tsx');
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement config-writer.js**

`plugins/adhd/lib/pull-component/config-writer.js`:

```javascript
'use strict';

const ts = require('typescript');

function parse(source) {
  return ts.createSourceFile('adhd.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// Locate the object literal assigned to `const config = { ... }`.
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

  // Case 1: existing components.<relPath> with a different URL → replace its url inline.
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
    // Case 2: components exists but not this path → append a new entry before its closing brace.
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
  // Detect the indentation used inside config (first existing property).
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

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/config-writer.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/pull-component/config-writer.js plugins/adhd/lib/pull-component/__tests__/config-writer.test.js
git commit -m "config-writer: idempotent add/read of components.<path>.figma.url"
```

---

## Task 7: cli.js — wire subcommands

**Files:**
- Modify: `plugins/adhd/lib/pull-component/cli.js`
- Modify: `plugins/adhd/lib/pull-component/__tests__/cli.test.js`

- [ ] **Step 1: Extend cli tests for each subcommand**

Append to `plugins/adhd/lib/pull-component/__tests__/cli.test.js`:

```javascript
const fs = require('node:fs');
const os = require('node:os');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-pull-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, content);
  return p;
}

const BADGE_PATH = path.resolve(__dirname, '..', '__fixtures__', 'badge-base.tsx');

test('parse subcommand writes a local.json manifest', () => {
  const out = tmp('local.json', '');
  const r = spawnSync('node', [CLI, 'parse', BADGE_PATH, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(m.componentName, 'Badge');
  assert.ok(m.unions.BadgeSize);
  assert.ok(m.tables.BADGE_BOX);
});

test('diff subcommand writes a diff.json', () => {
  // parse first
  const local = tmp('local.json', '');
  spawnSync('node', [CLI, 'parse', BADGE_PATH, '--output', local], { encoding: 'utf8' });
  // figma fixture
  const figma = path.resolve(__dirname, '..', '__fixtures__', 'badge-figma-cell-change.json');
  const out = tmp('diff.json', '');
  const r = spawnSync('node', [CLI, 'diff', '--local', local, '--figma', figma, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(d.tableDiff.length, 1);
});

test('apply subcommand rewrites the source file via resolutions', () => {
  const src = fs.readFileSync(BADGE_PATH, 'utf8');
  const srcPath = tmp('Badge.tsx', src);
  const resolutions = tmp('res.json', JSON.stringify({
    unions: {},
    tables: { BADGE_TEXT: { md: 'text-base' } },
  }));
  const out = tmp('out.tsx', '');
  const r = spawnSync('node', [CLI, 'apply', '--source', srcPath, '--resolutions', resolutions, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const result = fs.readFileSync(out, 'utf8');
  assert.match(result, /md: "text-base"/);
});

test('config-write subcommand adds a components entry', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-write', '--config', cfgPath, '--path', 'app/components/x.tsx', '--figma-url', 'https://figma.com/design/ABC/?node-id=1-1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.match(after, /"app\/components\/x\.tsx":/);
});
```

- [ ] **Step 2: Verify the new tests fail**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/cli.test.js`
Expected: 4 new subcommand tests FAIL; original 3 still pass.

- [ ] **Step 3: Implement cli.js full surface**

`plugins/adhd/lib/pull-component/cli.js`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseReactComponent } = require('./parse-react');
const { diffLocalVsFigma } = require('./differ');
const { applyResolutions } = require('./apply');
const { addComponentMapping } = require('./config-writer');

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
  cli.js parse <component-path> --output <local.json>
  cli.js extract <figma-state.json> --output <figma.json>
  cli.js diff --local <local.json> --figma <figma.json> --output <diff.json>
  cli.js apply --source <component.tsx> --resolutions <resolutions.json> --output <newsource.tsx>
  cli.js config-write --config <adhd.config.ts> --path <relative-path> --figma-url <url>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];

  if (cmd === 'parse') {
    const componentPath = args._[1];
    if (!componentPath || !args.output) { console.error('Usage: parse <path> --output <json>'); process.exit(2); }
    const source = fs.readFileSync(componentPath, 'utf8');
    const result = parseReactComponent(source);
    fs.writeFileSync(args.output, JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (cmd === 'extract') {
    // Passthrough: SKILL builds the figma extract via use_figma and writes it to the path.
    // This subcommand is a no-op (placeholder for symmetry); validates the file is JSON.
    const figmaState = args._[1];
    if (!figmaState || !args.output) { console.error('Usage: extract <figma-state.json> --output <figma.json>'); process.exit(2); }
    const raw = fs.readFileSync(figmaState, 'utf8');
    JSON.parse(raw); // validation
    fs.writeFileSync(args.output, raw);
    process.exit(0);
  }

  if (cmd === 'diff') {
    if (!args.local || !args.figma || !args.output) { console.error('Usage: diff --local <json> --figma <json> --output <json>'); process.exit(2); }
    const local = JSON.parse(fs.readFileSync(args.local, 'utf8'));
    const figma = JSON.parse(fs.readFileSync(args.figma, 'utf8'));
    const diff = diffLocalVsFigma(local, figma);
    fs.writeFileSync(args.output, JSON.stringify(diff, null, 2));
    process.exit(0);
  }

  if (cmd === 'apply') {
    if (!args.source || !args.resolutions || !args.output) { console.error('Usage: apply --source <tsx> --resolutions <json> --output <tsx>'); process.exit(2); }
    const source = fs.readFileSync(args.source, 'utf8');
    const resolutions = JSON.parse(fs.readFileSync(args.resolutions, 'utf8'));
    const out = applyResolutions(source, resolutions);
    fs.writeFileSync(args.output, out);
    process.exit(0);
  }

  if (cmd === 'config-write') {
    if (!args.config || !args.path || !args['figma-url']) { console.error('Usage: config-write --config <adhd.config.ts> --path <rel> --figma-url <url>'); process.exit(2); }
    const source = fs.readFileSync(args.config, 'utf8');
    const out = addComponentMapping(source, args.path, args['figma-url']);
    fs.writeFileSync(args.config, out);
    process.exit(0);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/pull-component/__tests__/cli.test.js`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/pull-component/cli.js plugins/adhd/lib/pull-component/__tests__/cli.test.js
git commit -m "cli: wire parse/extract/diff/apply/config-write subcommands"
```

---

## Task 8: SKILL.md — orchestrate the 11-phase flow

**Files:**
- Create: `plugins/adhd/skills/pull-component/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

`plugins/adhd/skills/pull-component/SKILL.md`:

```markdown
---
description: "Pull a Figma Component Set into a React component source file. Inverse of /adhd:push-component. Updates only design-token lookup tables and union types — function body, JSX, hooks, handlers, and imports are never modified. Reads adhd.config.ts and uses the mapping at components.<path>.figma.url. Pre-flight validates the Figma source using the same lint engine /adhd:lint uses; structural violations abort the pull."
disable-model-invocation: true
argument-hint: "<react-path | figma-url> [--allow-unbound]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Pull Component

Reconciles a Figma Component Set back into a React source file. Symmetric with /adhd:push-component: the same lint engine, the same Tailwind-to-design-token resolver. Updates are scoped to lookup tables (Record<Union, string>) and union type aliases — never the function body.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-pull-component.md`

## Phase 1: Validate config

Read `adhd.config.ts`. Require `figma.url`. If missing: abort with "Run /adhd:config first to set up ADHD."

## Phase 2: Resolve target

Parse `$ARGUMENTS`. First positional is either a path (existing file) or a Figma URL (starts with `https://`).

Use `Bash` to invoke a helper:

```bash
node -e "
const fs = require('fs');
const { readComponentMapping, reverseLookupPath } = require('./plugins/adhd/lib/pull-component/config-writer');
const src = fs.readFileSync('adhd.config.ts', 'utf8');
const arg = process.argv[1];
if (arg.startsWith('https://')) {
  const path = reverseLookupPath(src, arg);
  console.log(JSON.stringify({ mode: path ? 'update' : 'scaffold', path, figmaUrl: arg }));
} else {
  const entry = readComponentMapping(src, arg);
  if (!entry) { console.error('No mapping for ' + arg); process.exit(2); }
  console.log(JSON.stringify({ mode: 'update', path: arg, figmaUrl: entry.figma.url }));
}
" "$ARG"
```

Validate the file key in the resolved URL matches `config.figma.url`'s file key. On mismatch abort: "URL points at file <X>, but adhd.config.ts is configured for file <Y>."

If scaffold mode (URL form, no mapping): use `AskUserQuestion` to ask: "Where should this component be created? (relative path from adhd.config.ts directory)". Validate the path doesn't already exist.

Save the resolved `{ mode, path, figmaUrl }` to `/tmp/adhd-pull-component/target.json`.

## Phase 2.5: Pre-flight lint

Extract the Component Set's structural data via `mcp__plugin_figma_figma__use_figma`, scoped to the resolved node-id. Save to `/tmp/adhd-pull-component/ctx.json` and `/tmp/adhd-pull-component/vars.json`.

Run the same lint engine /adhd:lint uses:

```bash
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd-pull-component/vars.json \
  --design-context /tmp/adhd-pull-component/ctx.json \
  --globals-css <path-resolved-from-config> \
  --config adhd.config.ts \
  --target "PullComponent Preflight" \
  --target-url "$FIGMA_URL" \
  --output /tmp/adhd-pull-component/preflight.md
```

Parse the report for STRUCT003/004/005 errors specifically (variable-binding violations). Other errors are reported in the final report but do not block.

If variable-binding errors exist AND neither `--allow-unbound` (CLI) nor `components.<path>.allowUnboundFigma === true` (config): abort with the helpful error listing each offending layer with its variant path and property (see spec section "Pre-flight lint of the Figma Component Set").

If variable-binding errors exist AND the escape is active: render the confirm-prompt via `AskUserQuestion` ("Continue with arbitrary classes? (y/N)"). On `n` or no answer, abort. On `y`, mark offending entries for off-system handling in Phase 7.

## Phase 3: Read both sides

In scaffold mode, there is no local file to parse; create an empty `local.json` (no unions, no tables) and skip ahead — Phase 7 will materialize a fresh file using all of Figma's values.

In update mode:

```bash
node plugins/adhd/lib/pull-component/cli.js parse <react-path> --output /tmp/adhd-pull-component/local.json
```

For Figma: use `mcp__plugin_figma_figma__use_figma` to walk the Component Set and serialize per-variant per-table tokens. The Figma extract script must produce the shape used in __fixtures__/badge-figma-clean.json — variants with `props` and `tokens` keys. Save to `/tmp/adhd-pull-component/figma.json`.

## Phase 4: Build the diff

```bash
node plugins/adhd/lib/pull-component/cli.js diff \
  --local /tmp/adhd-pull-component/local.json \
  --figma /tmp/adhd-pull-component/figma.json \
  --output /tmp/adhd-pull-component/diff.json
```

Read `diff.json`. If all three buckets are empty AND mode is update: print "No changes" and exit 0.

## Phase 5: Resolve divergences

Top-of-loop short-circuit via `AskUserQuestion`:
- "Apply ALL Figma values"
- "Keep ALL local values (no-op — exits here)"
- "Review each"

If "Apply ALL", short-circuit by writing a resolutions.json that accepts everything Figma proposes (every unionDiff.add, every cell). Skip 5a and 5b.

If "Review each":

**5a — Union changes.** For each entry in `diff.unionDiff`, prompt:
- "Add `<x>` to <Union> + cascade to all Record<<Union>, ...> tables"
- "Skip — leave union as-is (table cells for this axis also skipped)"

If the user skips an axis, mark it skipped — Phase 5b's per-axis prompts for that axis are NOT shown.

**5b — Table cells.** For each `tableDiff` entry, show the table + cells, prompt:
- "Apply Figma's values to all N cells"
- "Review each one"
- "Keep all local values (skip this table)"

`Review each one` → per-cell binary choice.

**5c — Unmapped.** Print informational notice for each `unmapped` entry (no prompts).

Accumulate into `/tmp/adhd-pull-component/resolutions.json`. For off-system entries from Phase 2.5, prefix each table value with the `// adhd:off-system` comment (literal newline included), so apply.js emits the comment above the property.

## Phase 6: Drift check

Re-fetch the Figma CS, hash the variant tree, compare to the hash from Phase 3 (saved in `/tmp/adhd-pull-component/figma.hash`). On mismatch abort: "Figma changed during pull. Re-run /adhd:pull-component."

## Phase 7: Apply

In scaffold mode: generate the source file from the diff (treat all Figma values as additions). Use a small template — types from `figma.variantAxes`, tables from variants. Write to the target path. The function body is a minimal stub:

```tsx
export function <ComponentName>(/* props */) {
  return <span />; // adhd: scaffold stub — replace with your implementation
}
```

In update mode:

```bash
node plugins/adhd/lib/pull-component/cli.js apply \
  --source <react-path> \
  --resolutions /tmp/adhd-pull-component/resolutions.json \
  --output /tmp/adhd-pull-component/newsource.tsx
```

Then `Write` `/tmp/adhd-pull-component/newsource.tsx` content back to `<react-path>` (single Write call — atomic per file).

## Phase 8: Write mapping if scaffold mode

```bash
node plugins/adhd/lib/pull-component/cli.js config-write \
  --config adhd.config.ts \
  --path <new-relative-path> \
  --figma-url <figma-url>
```

## Phase 9: Per-axis commit

Group applied resolutions by axis (from `diff.json`). For each axis with applied changes:

```bash
git add <react-path> [adhd.config.ts]
git commit -m "ADHD pull: <ComponentName>.<axis> (<N> changes)"
```

## Phase 10: Final report

```
✓ Pulled <ComponentName> from Figma:
  - <N> variant(s) added
  - <M> table cells updated
  - <K> cells kept local
  - <U> unmapped Figma properties

Component file: <react-path>
Figma URL: <figma-url>
```

## Phase 11: Cleanup

Always runs. `rm -rf /tmp/adhd-pull-component`.

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `No mapping for <path>` | Push it first: `/adhd:push-component <path>`. |
| `URL points at wrong file` | Open the configured file and copy a node URL from there. |
| `Pre-flight: <N> unbound values` | See the error message — bind values in Figma, or pass `--allow-unbound`. |
| `<react-path> has no Record<Union, string> tables` | This component doesn't follow the lookup-table convention. v1 requires it. |
| `Figma changed during pull` | Re-run `/adhd:pull-component`. |
```

- [ ] **Step 2: Validate SKILL frontmatter**

Run: `node scripts/validate-skill-frontmatter.js`
Expected: PASS (the validator checks the frontmatter shape; this SKILL has the same surface as push-component).

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/pull-component/
git commit -m "Add /adhd:pull-component skill orchestrating 11-phase pull flow"
```

---

## Task 9: push-component additive — write mapping on first push

**Files:**
- Modify: `plugins/adhd/skills/push-component/SKILL.md`

- [ ] **Step 1: Locate the insertion point in push-component SKILL.md**

The mapping write should appear between Phase 11 (finalize) and Phase 12 (final report). Only run on the finalize path (when preflight passes or user chose "keep").

- [ ] **Step 2: Insert the new step**

Add to `plugins/adhd/skills/push-component/SKILL.md` between Phase 11 and Phase 12:

```markdown
## Phase 11.5: Write component mapping to adhd.config.ts

Only runs on the finalize path (skip on rollback).

```bash
RELATIVE_PATH=$(realpath --relative-to=$(dirname adhd.config.ts) <component-path>)
FIGMA_URL="<figma.url-from-config>?node-id=$(echo $PAGE_ID | tr ':' '-')"
node plugins/adhd/lib/pull-component/cli.js config-write \
  --config adhd.config.ts \
  --path "$RELATIVE_PATH" \
  --figma-url "$FIGMA_URL"
```

This records the mapping so subsequent `/adhd:pull-component <component-path>` and `/adhd:pull-component <figma-url>` invocations can find each other. Idempotent — re-pushing the same component does not duplicate the entry.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/push-component/SKILL.md
git commit -m "push-component: write mapping to adhd.config.ts on finalize"
```

---

## Task 10: README and marketplace updates

**Files:**
- Modify: `README.md`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Read current README command table**

Identify lines 19-28 (the command table). The fifth command `/adhd:push-component` is the last row.

- [ ] **Step 2: Add pull-component row to the command table**

Edit `README.md`:

Replace `After install, five slash commands are available:` with `After install, six slash commands are available:`.

Add a row to the command table after `/adhd:push-component`:

```
| `/adhd:pull-component` | `<path \| figma-url> [--allow-unbound]` | Figma → code | Pulls a Figma Component Set into a React source file; updates lookup tables and union types only (function body untouched) |
```

- [ ] **Step 3: Add a "Pull a component" subsection**

After the existing "Push a component" subsection, add:

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

- [ ] **Step 4: Update marketplace.json description**

`.claude-plugin/marketplace.json` — update the `description` field of the `adhd` plugin to reflect 6 commands. Use the `Read` tool first to see the current value, then `Edit` to update.

- [ ] **Step 5: Commit**

```bash
git add README.md .claude-plugin/marketplace.json
git commit -m "README + marketplace: document /adhd:pull-component"
```

---

## Task 11: Final smoke + PR prep

- [ ] **Step 1: Run all lib tests**

```bash
node --test plugins/adhd/lib/lint-engine/__tests__/ plugins/adhd/lib/design-system/__tests__/ plugins/adhd/lib/push-component/__tests__/ plugins/adhd/lib/pull-component/__tests__/
```

Expected: all tests PASS. Confirm count is at least 280 (current 251 + ~30 new).

- [ ] **Step 2: Run the SKILL frontmatter validator**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: PASS — all six SKILL.md files have valid frontmatter.

- [ ] **Step 3: Build the example app to sanity-check no regressions**

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

### Pipeline

1. Validate config
2. Resolve target (path / URL / scaffold mode)
3. Pre-flight lint of the Figma Component Set (same lint-engine as /adhd:lint)
4. Parse React file (TS compiler API) + extract Figma variants
5. Build the diff (union changes / table cells / unmapped axes)
6. Prompt per-divergence
7. Drift check
8. Apply via AST surgery scoped to unions + tables
9. Write component mapping if scaffold mode
10. Per-axis commit
11. Cleanup

### Key design

- **The React file IS the snapshot** — no parallel state stored in the repo. Lookup tables already encode every design-token value Figma cares about.
- **Bidirectional mapping** in `adhd.config.ts` under `components.<path>.figma.url`. Written by push on first push (this PR adds Phase 11.5 to push-component), by pull on first scaffold.
- **Symmetric pre-flight**: STRUCT003/004/005 violations on the Figma side block the pull. Designer-side variable discipline enforced in both directions.
- **Escape hatch**: `--allow-unbound` (or `allowUnboundFigma: true` in config) converts the abort to a confirm-prompt. Off-system entries land in code with `// adhd:off-system` comments — greppable, self-healing on future pulls.
- **Function body invariant**: AST walker visits only top-level TypeAliasDeclarations and VariableStatements with Record<Union, string> annotations. Function bodies are out-of-bounds.

### Out of scope (v1)

- JSX / function body changes — manual only
- Multi-component pulls in one command
- Components without the `Record<Union, string>` lookup-table convention (reported and aborted)

## Test plan

- [x] All lib unit tests passing (parse-react, class-resolver, differ, apply, config-writer, cli)
- [x] Integration tests against synthetic Badge fixture with 4 Figma scenarios (clean, cell-change, added-variant, removed-variant)
- [x] SKILL frontmatter validated
- [x] Example app builds clean
- [ ] Manual smoke test: pull-component against the merged-main Avatar component → 0 changes (in sync); manual Figma edit → 1-cell diff → applied → committed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: Verify CI is green**

Run: `gh pr checks $(gh pr view --json number -q .number)`
Expected: all checks pass.

---

## Self-review notes

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Final command surface | Task 8 (SKILL.md), Task 10 (README) |
| Pipeline Phase 1 | Task 8 |
| Pipeline Phase 2 | Task 8 (target resolution); Task 6 (config-writer reverseLookupPath, readComponentMapping) |
| Pipeline Phase 2.5 (pre-flight) | Task 8 (SKILL invokes lint-engine subprocess) |
| Pipeline Phase 3 | Task 8 (SKILL); Task 2 (parse-react) |
| Pipeline Phase 4 | Task 4 (differ) |
| Pipeline Phase 5 | Task 8 (prompt UX in SKILL) |
| Pipeline Phase 6 | Task 8 (drift check) |
| Pipeline Phase 7 | Task 5 (apply) |
| Pipeline Phase 8 | Task 6 (config-writer addComponentMapping) |
| Pipeline Phase 9 | Task 8 (commits) |
| Pipeline Phase 10 | Task 8 (report) |
| Pipeline Phase 11 | Task 8 (cleanup) |
| Lookup-table convention | Task 2 (parse-react implements detection) |
| Config schema additions | Task 6 (config-writer); Task 9 (push-component additive); Task 10 (README documents) |
| Module layout | Tasks 1-7 each create one module |
| Edge cases | Task 8 (SKILL "Common errors" table) |
| Pre-flight escape hatch | Task 8 (SKILL Phase 2.5) |
| Symmetric-pipeline assertions | Task 3 (class-resolver imports lint-engine) |
| Testing strategy | Tasks 1, 2, 3, 4, 5, 6 (each module has __tests__) |
| Acceptance criteria 1-18 | Covered across Tasks 2-11 |

No gaps.

**Type / signature consistency check:**

- `parseReactComponent(source)` → `{ componentName, propsInterfaceName, unions, props, tables, functionBody }` — same signature in Tasks 2, 4, 5, 7
- `diffLocalVsFigma(local, figma)` → `{ unionDiff, tableDiff, unmapped }` — same in Tasks 4, 7
- `applyResolutions(source, resolutions)` → `newSource` (string) — same in Tasks 5, 7
- Resolutions shape `{ unions: { <name>: { add, remove } }, tables: { <name>: { <key>: <value> } } }` — same across Tasks 5, 7, 8
- `addComponentMapping(source, relPath, figmaUrl)` → newSource — same in Tasks 6, 7, 9
- `readComponentMapping(source, relPath)` → `{ figma: { url } } | null` — same in Tasks 6, 8
- `reverseLookupPath(source, figmaUrl)` → `relPath | null` — same in Tasks 6, 8
