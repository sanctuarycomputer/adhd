# /adhd:push-component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/adhd:push-component <component-path>` — push a React component to Figma as a structured Component Set with variant properties, variable bindings, and a preflight lint check that uses the same engine as `/adhd:lint`.

**Architecture:** A new `plugins/adhd/lib/push-component/` library that parses TypeScript prop unions, generates a temp Next.js preview page, writes use_figma consolidation scripts, builds a Figma-variable reverse index, and computes visual signatures for variant dedup. Skill orchestrates: invoke generate_figma_design → run consolidation script → run preflight lint (reusing lint-engine) → finalize or roll back.

**Tech Stack:** Node 20+ (zero new deps; regex-based TS parser for v1), `node:test` for unit tests, Claude Code skills for the user-facing command. Reuses `plugins/adhd/lib/lint-engine/` for the preflight step.

**Spec:** `docs/superpowers/specs/2026-05-10-adhd-push-component.md`

---

## File structure

### New files

```
plugins/adhd/lib/push-component/
├── README.md
├── cli.js                         # orchestrator
├── parse-component.js             # regex-based TS analysis (union aliases, props)
├── prop-defaults.js               # form-based placeholder defaults for required props
├── variant-matrix.js              # Cartesian product + coverage-first cap
├── preview-generator.js           # emit the temp Next.js page TSX
├── reverse-index.js               # Figma-variable lookup (color/spacing/radius/etc.)
├── visual-signature.js            # hash a captured frame for dedup
└── __tests__/
    ├── parse-component.test.js
    ├── prop-defaults.test.js
    ├── variant-matrix.test.js
    ├── preview-generator.test.js
    ├── reverse-index.test.js
    ├── visual-signature.test.js
    └── cli.test.js

plugins/adhd/skills/push-component/SKILL.md
```

### Modified files

```
example/.gitignore                  # add __adhd-preview/
plugins/adhd/skills/config/SKILL.md  # add optional devServerUrl field
README.md                            # update command table
.github/workflows/ci.yml             # add push-component test step
```

### Why this decomposition

- **`parse-component.js`** — pure regex parsing, no external deps. Constrained but predictable; we can upgrade to the TypeScript compiler API in v2 if regex fails on real-world components.
- **`prop-defaults.js`** — form-based (syntactic) detection of safe placeholders. Independent of parser; testable in isolation.
- **`variant-matrix.js`** — Cartesian + capping. Pure data manipulation.
- **`preview-generator.js`** — emits TSX as a string. Pure function; integration tested via end-to-end manual run.
- **`reverse-index.js`** — given a Figma extract, build lookup maps. Used by the consolidation phase.
- **`visual-signature.js`** — stable structural hash for variant frames; used by dedup.
- **`cli.js`** — thin orchestrator with subcommands the skill invokes.

The **preflight lint** doesn't get its own module: it just calls `lint-engine`'s existing `checkStructure` and `variable-categorizer`. This is the symmetric-pipeline assertion from the spec — no duplicate implementations.

---

## Task 1: Scaffold lib/push-component + smoke test

**Files:**
- Create: `plugins/adhd/lib/push-component/cli.js`
- Create: `plugins/adhd/lib/push-component/__tests__/cli.test.js`
- Create: `plugins/adhd/lib/push-component/README.md`

- [ ] **Step 1: Create the CLI scaffolding**

Write `plugins/adhd/lib/push-component/cli.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * /adhd:push-component CLI. Subcommands:
 *   parse        — TS analysis of a component file → variant axes + prop manifest JSON
 *   generate-preview — emit a Next.js preview page TSX
 *   consolidation-script — emit the use_figma JS string for the cleanup phase
 *   preflight    — run lint-engine against a Figma extract JSON
 *   --help
 */

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h' || args.length === 0) {
    console.log(`Usage:
  cli.js parse <component-path> --output <manifest.json>
  cli.js generate-preview --manifest <manifest.json> --max-variants <n> --output <preview.tsx>
  cli.js consolidation-script --manifest <manifest.json> --captured-page-id <id> --reverse-index <ri.json> --output <script.js>
  cli.js preflight --design-context <ctx.json> --variable-defs <vars.json> --globals-css <path> --config <path> --output <report.md>`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  console.error('push-component: subcommand not implemented yet');
  process.exit(2);
}

main();
```

- [ ] **Step 2: Write the smoke test**

Write `plugins/adhd/lib/push-component/__tests__/cli.test.js`:

```js
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
  assert.match(result.stdout, /generate-preview/);
  assert.match(result.stdout, /consolidation-script/);
  assert.match(result.stdout, /preflight/);
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

- [ ] **Step 3: Run the tests**

```bash
node --test plugins/adhd/lib/push-component/__tests__/cli.test.js
```
Expected: 3 tests passing.

- [ ] **Step 4: Add a brief README**

Write `plugins/adhd/lib/push-component/README.md`:

```markdown
# push-component

Pure-JS engine that powers `/adhd:push-component`. Parses a React component
file's variant axes, emits a temp Next.js preview page for `generate_figma_design`
capture, then assembles a `use_figma` consolidation script that wraps the
captured frames into a Component Set with variant properties + variable bindings.

The preflight lint step calls `lib/lint-engine/`'s existing modules — same code
path /adhd:lint uses, no duplicates.

## Subcommands

- `parse <component-path>` — TS analysis → manifest JSON
- `generate-preview` — manifest → preview TSX
- `consolidation-script` — manifest + captured page ID → use_figma JS string
- `preflight` — Figma extract → lint report

## Tests

```bash
node --test plugins/adhd/lib/push-component/__tests__/
```
```

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/push-component/
git commit -m "Scaffold lib/push-component with smoke-test CLI"
```

---

## Task 2: parse-component.js — regex-based TS analysis

Constrained but predictable. Parses a component file to extract union-typed aliases and the props interface.

**Files:**
- Create: `plugins/adhd/lib/push-component/parse-component.js`
- Test: `plugins/adhd/lib/push-component/__tests__/parse-component.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseComponent } = require('../parse-component');

const AVATAR_SOURCE = `
import Image from "next/image";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "square";
export type AvatarStatus = "online" | "away" | "offline";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  status?: AvatarStatus;
  className?: string;
}

export function Avatar({ name, src, size = "md" }: AvatarProps) {
  return <span>{name}</span>;
}
`;

test('parses exported union-type aliases', () => {
  const parsed = parseComponent(AVATAR_SOURCE);
  assert.deepEqual(parsed.unions.AvatarSize, ['xs', 'sm', 'md', 'lg', 'xl']);
  assert.deepEqual(parsed.unions.AvatarShape, ['circle', 'square']);
  assert.deepEqual(parsed.unions.AvatarStatus, ['online', 'away', 'offline']);
});

test('parses the props interface and classifies each prop', () => {
  const parsed = parseComponent(AVATAR_SOURCE);
  assert.equal(parsed.componentName, 'Avatar');
  assert.equal(parsed.props.name.type, 'string');
  assert.equal(parsed.props.name.optional, false);
  assert.equal(parsed.props.src.type, 'string');
  assert.equal(parsed.props.src.optional, true);
  assert.equal(parsed.props.size.type, 'union');
  assert.equal(parsed.props.size.unionName, 'AvatarSize');
  assert.equal(parsed.props.size.optional, true);
  assert.equal(parsed.props.shape.type, 'union');
  assert.equal(parsed.props.status.type, 'union');
  assert.equal(parsed.props.className.type, 'string');
  assert.equal(parsed.props.className.optional, true);
});

test('handles type aliases as well as interfaces for the props', () => {
  const SOURCE = `
    type ButtonProps = { onClick: () => void; label: string };
    export function Button({ onClick, label }: ButtonProps) {
      return <button onClick={onClick}>{label}</button>;
    }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.componentName, 'Button');
  assert.equal(parsed.props.onClick.type, 'function');
  assert.equal(parsed.props.label.type, 'string');
});

test('recognizes function-typed props by syntactic form', () => {
  const SOURCE = `
    interface Props {
      onClick: (event: React.MouseEvent) => void;
      onChange?: () => void;
    }
    export function Foo({ onClick }: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.onClick.type, 'function');
  assert.equal(parsed.props.onChange.type, 'function');
});

test('recognizes ref-typed props', () => {
  const SOURCE = `
    interface Props {
      inputRef: React.Ref<HTMLInputElement>;
      otherRef?: RefObject<HTMLDivElement>;
    }
    export function Foo({}: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.inputRef.type, 'ref');
  assert.equal(parsed.props.otherRef.type, 'ref');
});

test('recognizes ReactNode children', () => {
  const SOURCE = `
    interface Props {
      children: React.ReactNode;
      content?: ReactElement;
    }
    export function Foo({}: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.children.type, 'reactnode');
  assert.equal(parsed.props.content.type, 'reactnode');
});

test('inline union types are captured', () => {
  const SOURCE = `
    interface Props {
      variant: "primary" | "secondary";
    }
    export function Foo({}: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.variant.type, 'union');
  assert.deepEqual(parsed.props.variant.values, ['primary', 'secondary']);
});

test('aborts with a clear error when no exported component found', () => {
  const SOURCE = `const internal = 'just data';`;
  assert.throws(() => parseComponent(SOURCE), /No exported function component/);
});

test('aborts when props interface cannot be located', () => {
  const SOURCE = `
    export function Anonymous(props) { return null; }
  `;
  assert.throws(() => parseComponent(SOURCE), /Could not locate props/);
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
node --test plugins/adhd/lib/push-component/__tests__/parse-component.test.js
```

- [ ] **Step 3: Implement parse-component.js**

```js
'use strict';

const TYPE_ALIAS_RE = /export\s+type\s+([A-Z][A-Za-z0-9]*)\s*=\s*([^;]+);/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+([A-Z][A-Za-z0-9]*)Props\s*\{([\s\S]*?)\}/;
const TYPE_PROPS_RE = /(?:export\s+)?type\s+([A-Z][A-Za-z0-9]*)Props\s*=\s*\{([\s\S]*?)\}/;
const EXPORT_FN_RE = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)\s*\(/;
const PROP_LINE_RE = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)(\?)?\s*:\s*([^;,]+)[;,]?\s*$/;

function parseUnionString(typeText) {
  // Match `"a" | "b" | "c"` literal unions only
  const trimmed = typeText.trim();
  if (!/^\s*"[^"]*"(\s*\|\s*"[^"]*")*\s*$/.test(trimmed)) return null;
  return trimmed.split('|').map((s) => {
    const m = /"([^"]*)"/.exec(s.trim());
    return m ? m[1] : null;
  }).filter(Boolean);
}

function classifyPropType(typeText, knownUnions) {
  const t = typeText.trim();
  // Inline literal union → union
  const inlineUnion = parseUnionString(t);
  if (inlineUnion) return { type: 'union', values: inlineUnion };
  // Named union reference
  if (knownUnions[t]) return { type: 'union', unionName: t, values: knownUnions[t] };
  // Function: anything matching `(...) => *` (allowing nested parens for generics)
  if (/^\([^)]*\)\s*=>/.test(t)) return { type: 'function' };
  // Ref types
  if (/^(?:React\.)?Ref(?:Object|Callback|MutableRefObject)?</.test(t)) return { type: 'ref' };
  if (/^MutableRefObject</.test(t) || /^RefObject</.test(t)) return { type: 'ref' };
  // ReactNode / ReactElement / JSX.Element
  if (/^(?:React\.)?(?:ReactNode|ReactElement|ReactChild)$/.test(t)) return { type: 'reactnode' };
  if (/^JSX\.Element$/.test(t)) return { type: 'reactnode' };
  if (/^(?:React\.)?ReactElement<.*>$/.test(t)) return { type: 'reactnode' };
  // Primitives
  if (t === 'string') return { type: 'string' };
  if (t === 'number') return { type: 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  // Array
  if (/\[\]$/.test(t) || /^Array</.test(t) || /^ReadonlyArray</.test(t)) return { type: 'array' };
  // Object literal
  if (/^\{/.test(t)) return { type: 'object' };
  // Fallback
  return { type: 'unknown', raw: t };
}

function parseComponent(source) {
  // 1. Find all exported union-type aliases
  const unions = {};
  TYPE_ALIAS_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_ALIAS_RE.exec(source)) !== null) {
    const name = m[1];
    const rhs = m[2];
    const values = parseUnionString(rhs);
    if (values) unions[name] = values;
  }
  // 2. Find the component's exported function name
  const fnMatch = EXPORT_FN_RE.exec(source);
  if (!fnMatch) {
    throw new Error('No exported function component found in source');
  }
  const componentName = fnMatch[1];
  // 3. Find the props interface or type: <ComponentName>Props
  const interfaceMatch = INTERFACE_RE.exec(source);
  const typeMatch = TYPE_PROPS_RE.exec(source);
  const propsBody = (interfaceMatch && interfaceMatch[2]) || (typeMatch && typeMatch[2]);
  if (!propsBody) {
    throw new Error('Could not locate props interface or type for component ' + componentName);
  }
  // 4. Parse each line of the props body
  const props = {};
  for (const line of propsBody.split('\n')) {
    const propMatch = PROP_LINE_RE.exec(line);
    if (!propMatch) continue;
    const [, name, optionalMarker, typeText] = propMatch;
    const optional = optionalMarker === '?';
    const classified = classifyPropType(typeText, unions);
    props[name] = { ...classified, optional };
  }
  return { componentName, unions, props };
}

module.exports = { parseComponent, parseUnionString, classifyPropType };
```

- [ ] **Step 4: Run tests**

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/push-component/parse-component.js plugins/adhd/lib/push-component/__tests__/parse-component.test.js
git commit -m "Add parse-component: regex-based TS analysis of unions and props"
```

---

## Task 3: prop-defaults.js — safe placeholders for required non-variant props

**Files:**
- Create: `plugins/adhd/lib/push-component/prop-defaults.js`
- Test: `plugins/adhd/lib/push-component/__tests__/prop-defaults.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultForProp, isNameLike } = require('../prop-defaults');

test('returns placeholder string for required string prop', () => {
  assert.equal(defaultForProp('label', { type: 'string', optional: false }), '"Sample text"');
});

test('returns "John Doe" for name-like string props', () => {
  assert.equal(defaultForProp('name', { type: 'string', optional: false }), '"John Doe"');
  assert.equal(defaultForProp('title', { type: 'string', optional: false }), '"John Doe"');
  assert.equal(defaultForProp('label', { type: 'string', optional: false }), '"Sample text"');
});

test('returns omit-marker for optional props (so they fall through to component defaults)', () => {
  assert.equal(defaultForProp('className', { type: 'string', optional: true }), null);
  assert.equal(defaultForProp('size', { type: 'union', values: ['xs'], optional: true }), null);
});

test('returns 0 for required number props', () => {
  assert.equal(defaultForProp('count', { type: 'number', optional: false }), '0');
});

test('returns false for required boolean props', () => {
  assert.equal(defaultForProp('disabled', { type: 'boolean', optional: false }), 'false');
});

test('returns "() => {}" for required function props', () => {
  assert.equal(defaultForProp('onClick', { type: 'function', optional: false }), '() => {}');
});

test('returns null for required ref props', () => {
  assert.equal(defaultForProp('inputRef', { type: 'ref', optional: false }), 'null');
});

test('returns "..." placeholder for required ReactNode children', () => {
  assert.equal(defaultForProp('children', { type: 'reactnode', optional: false }), '"..."');
});

test('returns [] for required array props', () => {
  assert.equal(defaultForProp('items', { type: 'array', optional: false }), '[]');
});

test('returns {} for required object props', () => {
  assert.equal(defaultForProp('config', { type: 'object', optional: false }), '{}');
});

test('returns {} for unresolvable types and includes a marker', () => {
  const result = defaultForProp('mystery', { type: 'unknown', optional: false, raw: 'SomeOtherType' });
  assert.equal(result, '{}');
});

test('isNameLike heuristic', () => {
  assert.equal(isNameLike('name'), true);
  assert.equal(isNameLike('title'), true);
  assert.equal(isNameLike('userName'), true);
  assert.equal(isNameLike('className'), false);
  assert.equal(isNameLike('label'), false);
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
node --test plugins/adhd/lib/push-component/__tests__/prop-defaults.test.js
```

- [ ] **Step 3: Implement prop-defaults.js**

```js
'use strict';

const NAME_LIKE = /(?:^|[a-z])(?:name|title|fullname|firstname|lastname)(?:[A-Z]|$)/i;

function isNameLike(propName) {
  return NAME_LIKE.test(propName);
}

function defaultForProp(propName, propMeta) {
  if (propMeta.optional) return null; // let component use its own default
  switch (propMeta.type) {
    case 'string':   return isNameLike(propName) ? '"John Doe"' : '"Sample text"';
    case 'number':   return '0';
    case 'boolean':  return 'false';
    case 'function': return '() => {}';
    case 'ref':      return 'null';
    case 'reactnode': return '"..."';
    case 'array':    return '[]';
    case 'object':   return '{}';
    case 'union':    return JSON.stringify(propMeta.values[0]); // pick first value
    case 'unknown':  return '{}';
    default:         return '{}';
  }
}

module.exports = { defaultForProp, isNameLike };
```

- [ ] **Step 4: Run tests**

Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/push-component/prop-defaults.js plugins/adhd/lib/push-component/__tests__/prop-defaults.test.js
git commit -m "Add prop-defaults: form-based safe placeholders for required props"
```

---

## Task 4: variant-matrix.js — Cartesian + coverage-first cap

**Files:**
- Create: `plugins/adhd/lib/push-component/variant-matrix.js`
- Test: `plugins/adhd/lib/push-component/__tests__/variant-matrix.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { variantMatrix, capWithCoverage, variantKey } = require('../variant-matrix');

test('full Cartesian product when no cap', () => {
  const axes = {
    size: ['xs', 'sm', 'md'],
    shape: ['circle', 'square'],
  };
  const matrix = variantMatrix(axes);
  assert.equal(matrix.length, 6);
});

test('includes undefined for optional union props (added as implicit value)', () => {
  const axes = { status: ['online', 'away', 'offline', 'undefined'] };
  const matrix = variantMatrix(axes);
  assert.equal(matrix.length, 4);
  assert.ok(matrix.some(v => v.status === 'undefined'));
});

test('Avatar shape: 5 sizes × 2 shapes × 4 status = 40', () => {
  const axes = {
    size: ['xs', 'sm', 'md', 'lg', 'xl'],
    shape: ['circle', 'square'],
    status: ['online', 'away', 'offline', 'undefined'],
  };
  const matrix = variantMatrix(axes);
  assert.equal(matrix.length, 40);
});

test('variantKey produces stable lexically-sorted string', () => {
  assert.equal(variantKey({ size: 'xs', shape: 'circle' }), 'shape=circle;size=xs');
  assert.equal(variantKey({ status: 'online', size: 'md' }), 'size=md;status=online');
});

test('capWithCoverage preserves every axis value when cap >= unique value count', () => {
  const axes = { size: ['xs', 'sm', 'md', 'lg', 'xl'], shape: ['circle', 'square'] };
  const full = variantMatrix(axes); // 10
  const capped = capWithCoverage(full, axes, 7);
  // 7 variants must collectively contain all values of all axes
  const sizesUsed = new Set(capped.map(v => v.size));
  const shapesUsed = new Set(capped.map(v => v.shape));
  assert.equal(sizesUsed.size, 5);
  assert.equal(shapesUsed.size, 2);
  assert.equal(capped.length, 7);
});

test('capWithCoverage requires cap >= max axis size; throws otherwise', () => {
  const axes = { size: ['xs', 'sm', 'md', 'lg', 'xl'] };
  assert.throws(() => capWithCoverage(variantMatrix(axes), axes, 3), /cap too small/);
});

test('capWithCoverage produces lexically-sorted output after coverage', () => {
  const axes = { size: ['xs', 'sm', 'md'] };
  const capped = capWithCoverage(variantMatrix(axes), axes, 3);
  const keys = capped.map(variantKey);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement variant-matrix.js**

```js
'use strict';

function variantMatrix(axes) {
  const names = Object.keys(axes);
  if (names.length === 0) return [{}];
  // Cartesian product
  let result = [{}];
  for (const name of names) {
    const next = [];
    for (const combo of result) {
      for (const value of axes[name]) {
        next.push({ ...combo, [name]: value });
      }
    }
    result = next;
  }
  return result;
}

function variantKey(combo) {
  return Object.keys(combo).sort().map(k => k + '=' + combo[k]).join(';');
}

function capWithCoverage(full, axes, cap) {
  // Sanity: cap must be >= max axis size (otherwise we can't cover all values).
  const maxAxisSize = Math.max(...Object.values(axes).map(vs => vs.length));
  if (cap < maxAxisSize) {
    throw new Error('cap too small for coverage: cap=' + cap + ' but max axis size=' + maxAxisSize);
  }
  if (full.length <= cap) return [...full].sort((a, b) => variantKey(a).localeCompare(variantKey(b)));

  // Greedy coverage-first selection
  const remaining = new Set(Object.entries(axes).flatMap(([name, vs]) => vs.map(v => name + '=' + v)));
  const sorted = [...full].sort((a, b) => variantKey(a).localeCompare(variantKey(b)));
  const chosen = [];

  // Pass 1: pick combos that uniquely cover remaining axis values
  for (const combo of sorted) {
    if (chosen.length >= cap) break;
    let contributes = false;
    for (const [name, value] of Object.entries(combo)) {
      if (remaining.has(name + '=' + value)) { contributes = true; break; }
    }
    if (contributes) {
      chosen.push(combo);
      for (const [name, value] of Object.entries(combo)) {
        remaining.delete(name + '=' + value);
      }
    }
  }
  // Pass 2: fill remaining capacity with the next combos in sorted order
  for (const combo of sorted) {
    if (chosen.length >= cap) break;
    if (!chosen.includes(combo)) chosen.push(combo);
  }
  // Return in lexical order
  return chosen.sort((a, b) => variantKey(a).localeCompare(variantKey(b)));
}

module.exports = { variantMatrix, variantKey, capWithCoverage };
```

- [ ] **Step 4: Run tests**

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/push-component/variant-matrix.js plugins/adhd/lib/push-component/__tests__/variant-matrix.test.js
git commit -m "Add variant-matrix: Cartesian product + coverage-first cap"
```

---

## Task 5: preview-generator.js — emit Next.js preview TSX

**Files:**
- Create: `plugins/adhd/lib/push-component/preview-generator.js`
- Test: `plugins/adhd/lib/push-component/__tests__/preview-generator.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePreviewTsx } = require('../preview-generator');

const MANIFEST = {
  componentName: 'Avatar',
  importPath: '@/app/components/avatar',
  variants: [
    { size: 'xs', shape: 'circle' },
    { size: 'sm', shape: 'circle' },
    { size: 'sm', shape: 'square' },
  ],
  nonVariantProps: { name: '"John Doe"' },
};

test('emits a valid React Next.js page', () => {
  const tsx = generatePreviewTsx(MANIFEST);
  assert.match(tsx, /import \{ Avatar \} from "@\/app\/components\/avatar"/);
  assert.match(tsx, /export default function Page/);
  assert.match(tsx, /<main/);
});

test('emits one wrapper per variant with data-adhd-variant', () => {
  const tsx = generatePreviewTsx(MANIFEST);
  assert.equal(tsx.match(/data-adhd-variant=/g).length, 3);
  assert.match(tsx, /data-adhd-variant="shape=circle;size=xs"/);
  assert.match(tsx, /data-adhd-variant="shape=circle;size=sm"/);
  assert.match(tsx, /data-adhd-variant="shape=square;size=sm"/);
});

test('renders each variant with its props', () => {
  const tsx = generatePreviewTsx(MANIFEST);
  assert.match(tsx, /<Avatar name=\{"John Doe"\} size=\{"xs"\} shape=\{"circle"\} \/>/);
  assert.match(tsx, /<Avatar name=\{"John Doe"\} size=\{"sm"\} shape=\{"square"\} \/>/);
});

test('omits props whose value is null (component default takes over)', () => {
  const M = {
    componentName: 'Button',
    importPath: '@/components/button',
    variants: [{ variant: 'primary' }],
    nonVariantProps: { onClick: '() => {}', children: null },
  };
  const tsx = generatePreviewTsx(M);
  // onClick is included; children is omitted
  assert.match(tsx, /onClick=\{\(\) => \{\}\}/);
  assert.doesNotMatch(tsx, /children=/);
});

test('header comment marks the file as auto-generated', () => {
  const tsx = generatePreviewTsx(MANIFEST);
  assert.match(tsx, /Auto-generated by \/adhd:push-component/);
  assert.match(tsx, /Do not edit/);
});

test('skips undefined variant values (renders without that prop)', () => {
  const M = {
    componentName: 'Avatar',
    importPath: '@/components/avatar',
    variants: [{ size: 'xs', status: 'undefined' }, { size: 'xs', status: 'online' }],
    nonVariantProps: { name: '"John Doe"' },
  };
  const tsx = generatePreviewTsx(M);
  // First variant: status omitted (undefined)
  assert.match(tsx, /<Avatar name=\{"John Doe"\} size=\{"xs"\} \/>/);
  // Second variant: status set
  assert.match(tsx, /<Avatar name=\{"John Doe"\} size=\{"xs"\} status=\{"online"\} \/>/);
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement preview-generator.js**

```js
'use strict';

const { variantKey } = require('./variant-matrix');

function generatePreviewTsx(manifest) {
  const { componentName, importPath, variants, nonVariantProps } = manifest;

  const variantBlocks = variants.map(v => {
    const key = variantKey(v);
    const propEntries = [];
    // Non-variant prop defaults (skip nulls)
    for (const [pname, defaultExpr] of Object.entries(nonVariantProps || {})) {
      if (defaultExpr === null) continue;
      propEntries.push(`${pname}={${defaultExpr}}`);
    }
    // Variant prop assignments (skip 'undefined' values — the component's own
    // default applies)
    for (const [pname, pvalue] of Object.entries(v)) {
      if (pvalue === 'undefined') continue;
      propEntries.push(`${pname}={${JSON.stringify(pvalue)}}`);
    }
    const propsStr = propEntries.join(' ');
    return `      <div data-adhd-variant="${key}">
        <${componentName} ${propsStr} />
      </div>`;
  }).join('\n');

  return `// Auto-generated by /adhd:push-component. Do not edit.
// Deleted automatically after capture.
import { ${componentName} } from "${importPath}";

export default function Page() {
  return (
    <main className="p-8 grid grid-cols-5 gap-4 bg-white dark:bg-zinc-950">
${variantBlocks}
    </main>
  );
}
`;
}

module.exports = { generatePreviewTsx };
```

- [ ] **Step 4: Run tests**

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/push-component/preview-generator.js plugins/adhd/lib/push-component/__tests__/preview-generator.test.js
git commit -m "Add preview-generator: emit Next.js preview page TSX"
```

---

## Task 6: reverse-index.js — Figma-variable lookup

**Files:**
- Create: `plugins/adhd/lib/push-component/reverse-index.js`
- Test: `plugins/adhd/lib/push-component/__tests__/reverse-index.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReverseIndex, lookupColor, lookupNumber } = require('../reverse-index');

const EXTRACT = {
  collections: [
    {
      name: 'color',
      modes: [{ id: 'M1', name: 'Light' }, { id: 'M2', name: 'Dark' }],
      variables: [
        {
          id: 'V1', name: 'gold/100', resolvedType: 'COLOR', scopes: [],
          valuesByMode: {
            Light: { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
            Dark:  { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
          },
        },
        {
          id: 'V2', name: 'brand/surface', resolvedType: 'COLOR', scopes: [],
          valuesByMode: {
            Light: { kind: 'alias', targetName: 'gold/100', targetId: 'V1' },
            Dark:  { kind: 'alias', targetName: 'gold/900', targetId: 'V99' },
          },
        },
      ],
    },
    {
      name: 'spacing',
      modes: [{ id: 'M3', name: 'Mode 1' }],
      variables: [
        { id: 'V3', name: '4', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 16 } } },
        { id: 'V4', name: '8', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 32 } } },
      ],
    },
    {
      name: 'radius',
      modes: [{ id: 'M4', name: 'Mode 1' }],
      variables: [
        { id: 'V5', name: 'sm', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 4 } } },
        { id: 'V6', name: 'full', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 9999 } } },
      ],
    },
  ],
  effectStyles: [], textStyles: [],
};

test('looks up a color by RGB triple', () => {
  const index = buildReverseIndex(EXTRACT);
  const v = lookupColor(index, { r: 0.98, g: 0.94, b: 0.77, a: 1 });
  assert.equal(v.name, 'gold/100');
  assert.equal(v.id, 'V1');
});

test('color lookup tolerates small float drift', () => {
  const index = buildReverseIndex(EXTRACT);
  // 0.98 vs 0.9803921 — same color, different precision
  const v = lookupColor(index, { r: 0.9803921, g: 0.9411764, b: 0.7725490, a: 1 });
  assert.equal(v && v.name, 'gold/100');
});

test('returns null for an unknown color', () => {
  const index = buildReverseIndex(EXTRACT);
  assert.equal(lookupColor(index, { r: 0.5, g: 0.5, b: 0.5, a: 1 }), null);
});

test('looks up spacing by px value', () => {
  const index = buildReverseIndex(EXTRACT);
  const v = lookupNumber(index, 'spacing', 16);
  assert.equal(v.name, '4');
});

test('looks up radius by px value', () => {
  const index = buildReverseIndex(EXTRACT);
  const v = lookupNumber(index, 'radius', 4);
  assert.equal(v.name, 'sm');
});

test('returns null for unknown spacing', () => {
  const index = buildReverseIndex(EXTRACT);
  assert.equal(lookupNumber(index, 'spacing', 7), null);
});

test('skips alias values (aliases resolve through the index, not into it)', () => {
  const index = buildReverseIndex(EXTRACT);
  // brand/surface is an alias; its concrete color is gold/100's color, so
  // looking up that color returns gold/100 (the underlying primitive),
  // not brand/surface
  const v = lookupColor(index, { r: 0.98, g: 0.94, b: 0.77, a: 1 });
  assert.equal(v.name, 'gold/100');
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement reverse-index.js**

```js
'use strict';

function colorKey({ r, g, b, a }) {
  const to3 = (n) => Math.round(n * 1000) / 1000; // tolerate ~3-decimal drift
  return [to3(r), to3(g), to3(b), to3(a ?? 1)].join(',');
}

function buildReverseIndex(extract) {
  const index = {
    color: new Map(),      // colorKey → { id, name }
    spacing: new Map(),    // number (px) → { id, name }
    radius: new Map(),
    typography: new Map(), // for font-size matches
    blur: new Map(),
    'border-width': new Map(),
    opacity: new Map(),
  };
  for (const c of extract.collections) {
    if (!index[c.name]) continue;
    for (const v of c.variables) {
      for (const mv of Object.values(v.valuesByMode)) {
        if (mv.kind === 'color') {
          index.color.set(colorKey(mv), { id: v.id, name: v.name });
        } else if (mv.kind === 'literal' && typeof mv.value === 'number') {
          index[c.name].set(mv.value, { id: v.id, name: v.name });
        }
        // Aliases are not added — they point at the underlying primitive,
        // which is already indexed via its own color/literal entry.
      }
    }
  }
  return index;
}

function lookupColor(index, rgba) {
  return index.color.get(colorKey(rgba)) || null;
}

function lookupNumber(index, domain, n) {
  if (!index[domain]) return null;
  return index[domain].get(n) || null;
}

module.exports = { buildReverseIndex, lookupColor, lookupNumber };
```

- [ ] **Step 4: Run tests**

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/push-component/reverse-index.js plugins/adhd/lib/push-component/__tests__/reverse-index.test.js
git commit -m "Add reverse-index: Figma-variable lookup by color/number"
```

---

## Task 7: visual-signature.js — variant dedup hash

**Files:**
- Create: `plugins/adhd/lib/push-component/visual-signature.js`
- Test: `plugins/adhd/lib/push-component/__tests__/visual-signature.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { visualSignature } = require('../visual-signature');

const FRAME_A = {
  type: 'FRAME', name: 'A', x: 0, y: 0, width: 40, height: 40,
  layoutMode: 'VERTICAL', paddingTop: 8, paddingBottom: 8, paddingLeft: 8, paddingRight: 8,
  fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
  children: [{ type: 'TEXT', characters: 'AB', fontSize: 12, fills: [] }],
};

test('identical frames produce identical signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.name = 'B'; // different name should not affect signature
  FRAME_B.x = 999;    // different position should not affect signature
  assert.equal(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('different dimensions produce different signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.width = 50;
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('different fill colors produce different signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.fills[0].color.r = 0; // red → black
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('different child text content produces different signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.children[0].characters = 'XY';
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('layer IDs and names do not affect signature', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.id = 'different-id';
  FRAME_B.name = 'different-name';
  FRAME_B.children[0].id = 'cid';
  assert.equal(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('layout mode and padding affect signature', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.layoutMode = 'HORIZONTAL';
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('child order matters (shape change)', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.children = [
    { type: 'TEXT', characters: 'A', fontSize: 10, fills: [] },
    { type: 'TEXT', characters: 'B', fontSize: 10, fills: [] },
  ];
  const FRAME_C = JSON.parse(JSON.stringify(FRAME_B));
  FRAME_C.children.reverse();
  assert.notEqual(visualSignature(FRAME_B), visualSignature(FRAME_C));
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement visual-signature.js**

```js
'use strict';

const crypto = require('node:crypto');

// Fields whose value affects what's visible on the canvas.
const RELEVANT = [
  'type', 'width', 'height',
  'layoutMode', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'itemSpacing', 'cornerRadius', 'topLeftRadius', 'topRightRadius',
  'bottomLeftRadius', 'bottomRightRadius',
  'fills', 'strokes', 'effects',
  'characters', 'fontSize', 'fontName', 'lineHeight',
];

function normalize(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(normalize);
  const out = {};
  for (const key of RELEVANT) {
    if (key in node) out[key] = normalize(node[key]);
  }
  // Children preserve order (replacing one child for another DOES change visuals)
  if (Array.isArray(node.children)) out.children = node.children.map(normalize);
  return out;
}

function visualSignature(node) {
  const json = JSON.stringify(normalize(node));
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

module.exports = { visualSignature, normalize };
```

- [ ] **Step 4: Run tests**

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/push-component/visual-signature.js plugins/adhd/lib/push-component/__tests__/visual-signature.test.js
git commit -m "Add visual-signature: structural hash for variant dedup"
```

---

## Task 8: cli.js — parse + generate-preview subcommands

**Files:**
- Modify: `plugins/adhd/lib/push-component/cli.js`
- Modify: `plugins/adhd/lib/push-component/__tests__/cli.test.js`

- [ ] **Step 1: Extend the CLI tests**

Append to `plugins/adhd/lib/push-component/__tests__/cli.test.js`:

```js
const fs = require('node:fs');
const os = require('node:os');

function tmp(filename, content) {
  const p = require('node:path').join(os.tmpdir(), 'adhd-pc-' + Date.now() + '-' + Math.random().toString(16).slice(2,8) + '-' + filename);
  fs.writeFileSync(p, content);
  return p;
}

const AVATAR_SOURCE = `
import Image from "next/image";

export type AvatarSize = "xs" | "sm" | "md";
export type AvatarShape = "circle" | "square";

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  className?: string;
}

export function Avatar({ name, size = "md" }: AvatarProps) {
  return <span>{name}</span>;
}
`;

test('parse subcommand writes a manifest JSON', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const out = tmp('manifest.json', '');
  const result = spawnSync('node', [CLI, 'parse', componentFile, '--output', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.componentName, 'Avatar');
  assert.ok(manifest.variants.length > 0);
  assert.deepEqual(manifest.unions.AvatarSize, ['xs', 'sm', 'md']);
});

test('parse subcommand --import-path overrides the auto-inferred import', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const out = tmp('manifest.json', '');
  spawnSync('node', [CLI, 'parse', componentFile, '--output', out, '--import-path', '@/foo/avatar'], { encoding: 'utf8' });
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.importPath, '@/foo/avatar');
});

test('parse subcommand respects --max-variants', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const out = tmp('manifest.json', '');
  // 3 sizes × 2 shapes × undefined-for-shape = 9 (3 sizes × 3 shape options)
  // size has 4 effective values (xs, sm, md, undefined), shape has 3 (circle, square, undefined)
  // = 12 total; cap to 4
  spawnSync('node', [CLI, 'parse', componentFile, '--output', out, '--max-variants', '4'], { encoding: 'utf8' });
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.variants.length, 4);
});

test('generate-preview subcommand emits a TSX file', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const manifest = tmp('manifest.json', '');
  spawnSync('node', [CLI, 'parse', componentFile, '--output', manifest], { encoding: 'utf8' });
  const previewOut = tmp('preview.tsx', '');
  const result = spawnSync('node', [CLI, 'generate-preview', '--manifest', manifest, '--output', previewOut], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const tsx = fs.readFileSync(previewOut, 'utf8');
  assert.match(tsx, /import \{ Avatar \}/);
  assert.match(tsx, /data-adhd-variant=/);
});
```

- [ ] **Step 2: Implement the subcommands in cli.js**

Overwrite `plugins/adhd/lib/push-component/cli.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseComponent } = require('./parse-component');
const { defaultForProp } = require('./prop-defaults');
const { variantMatrix, capWithCoverage } = require('./variant-matrix');
const { generatePreviewTsx } = require('./preview-generator');

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
  cli.js parse <component-path> --output <manifest.json> [--import-path <path>] [--max-variants <n>]
  cli.js generate-preview --manifest <manifest.json> --output <preview.tsx>
  cli.js consolidation-script --manifest <manifest.json> --captured-page-id <id> --reverse-index <ri.json> --output <script.js>
  cli.js preflight --design-context <ctx.json> --variable-defs <vars.json> --globals-css <path> --config <path> --output <report.md>`);
}

function inferImportPath(componentPath) {
  // Heuristic: convert app-root-relative path to "@/<rest>". User can override with --import-path.
  // e.g. example/app/components/avatar/index.tsx → @/app/components/avatar
  // We strip the .tsx and any /index suffix.
  let p = componentPath.replace(/\\/g, '/');
  // Find an "app/" segment and treat everything from there as the alias source
  const idx = p.indexOf('/app/');
  if (idx === -1) {
    // Fallback: use the file's directory name
    return './' + path.basename(path.dirname(p));
  }
  p = p.slice(idx + 1); // drop leading "/example/" etc.
  p = p.replace(/\.tsx?$/, '').replace(/\/index$/, '');
  return '@/' + p;
}

function buildManifest(componentPath, opts) {
  const source = fs.readFileSync(componentPath, 'utf8');
  const parsed = parseComponent(source);

  // Build variant axes from union-typed props
  const axes = {};
  const nonVariantProps = {};
  for (const [pname, pmeta] of Object.entries(parsed.props)) {
    if (pmeta.type === 'union') {
      const values = pmeta.values.slice();
      if (pmeta.optional) values.push('undefined'); // implicit
      axes[pname] = values;
    } else {
      const def = defaultForProp(pname, pmeta);
      if (def !== null) nonVariantProps[pname] = def;
    }
  }

  // Cartesian + optional cap
  const fullMatrix = variantMatrix(axes);
  const maxVariants = opts['max-variants'] ? parseInt(opts['max-variants'], 10) : null;
  let variants = fullMatrix;
  if (maxVariants && fullMatrix.length > maxVariants) {
    variants = capWithCoverage(fullMatrix, axes, maxVariants);
  }

  return {
    componentName: parsed.componentName,
    importPath: opts['import-path'] || inferImportPath(componentPath),
    unions: parsed.unions,
    props: parsed.props,
    axes,
    variants,
    nonVariantProps,
    totalCombinations: fullMatrix.length,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];

  if (cmd === 'parse') {
    const componentPath = args._[1];
    if (!componentPath || !args.output) { console.error('Usage: parse <path> --output <json>'); process.exit(2); }
    const manifest = buildManifest(componentPath, args);
    fs.writeFileSync(args.output, JSON.stringify(manifest, null, 2));
    process.exit(0);
  }

  if (cmd === 'generate-preview') {
    if (!args.manifest || !args.output) { console.error('Usage: generate-preview --manifest <json> --output <tsx>'); process.exit(2); }
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    fs.writeFileSync(args.output, generatePreviewTsx(manifest));
    process.exit(0);
  }

  if (cmd === 'consolidation-script' || cmd === 'preflight') {
    console.error('Not yet implemented (Task 9 wires these up)');
    process.exit(2);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
```

- [ ] **Step 3: Run tests**

Expected: 7 tests pass total (3 from Task 1 + 4 new).

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/lib/push-component/cli.js plugins/adhd/lib/push-component/__tests__/cli.test.js
git commit -m "Wire parse + generate-preview subcommands in cli.js"
```

---

## Task 9: cli.js — consolidation-script + preflight subcommands

**Files:**
- Modify: `plugins/adhd/lib/push-component/cli.js`
- Modify: `plugins/adhd/lib/push-component/__tests__/cli.test.js`

The consolidation-script subcommand emits a JS string (the `use_figma` script) that, given a captured Figma page id, walks the variant frames, dedupes via visual-signature, rebinds raw values to existing variables, and combines into a Component Set.

The preflight subcommand calls `lint-engine` against a captured Figma extract (the symmetric-pipeline assertion).

- [ ] **Step 1: Add tests**

Append to `plugins/adhd/lib/push-component/__tests__/cli.test.js`:

```js
test('consolidation-script subcommand emits a JS string with placeholders substituted', () => {
  const manifest = tmp('manifest.json', JSON.stringify({
    componentName: 'Avatar',
    variants: [{ size: 'xs' }, { size: 'sm' }],
    importPath: '@/app/components/avatar',
  }));
  const reverseIndex = tmp('ri.json', JSON.stringify({ color: [], spacing: [], radius: [] }));
  const out = tmp('script.js', '');
  const result = spawnSync('node', [
    CLI, 'consolidation-script',
    '--manifest', manifest,
    '--captured-page-id', '12:34',
    '--reverse-index', reverseIndex,
    '--output', out,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const script = fs.readFileSync(out, 'utf8');
  // Script must reference the page id and component name
  assert.match(script, /12:34/);
  assert.match(script, /Avatar/);
  // Script must contain the data-adhd-variant matcher
  assert.match(script, /data-adhd-variant/);
});

test('preflight subcommand produces a lint report', () => {
  // Build minimal inputs that lint-engine accepts
  const ctx = tmp('ctx.json', JSON.stringify({
    id: '1:1', name: 'Avatar', type: 'COMPONENT_SET',
    componentPropertyDefinitions: { size: { type: 'VARIANT', defaultValue: 'sm', variantOptions: ['xs','sm'] } },
    children: [
      { id: '1:2', name: 'Avatar/size=xs', type: 'COMPONENT', variantProperties: { size: 'xs' }, layoutMode: 'VERTICAL', children: [] },
      { id: '1:3', name: 'Avatar/size=sm', type: 'COMPONENT', variantProperties: { size: 'sm' }, layoutMode: 'VERTICAL', children: [] },
    ],
  }));
  const vars = tmp('vars.json', JSON.stringify({}));
  const css = tmp('globals.css', '@theme {}');
  const cfg = tmp('adhd.config.ts', 'export default { naming: "kebab-case" };');
  const out = tmp('report.md', '');
  const result = spawnSync('node', [
    CLI, 'preflight',
    '--design-context', ctx,
    '--variable-defs', vars,
    '--globals-css', css,
    '--config', cfg,
    '--output', out,
  ], { encoding: 'utf8' });
  // exit 0 if no errors; the synthetic input here has none
  assert.equal(result.status, 0, result.stderr);
  const report = fs.readFileSync(out, 'utf8');
  assert.match(report, /ADHD/);
});
```

- [ ] **Step 2: Implement the new subcommands**

In `cli.js`, replace the `consolidation-script` / `preflight` else-branch with:

```js
  if (cmd === 'consolidation-script') {
    if (!args.manifest || !args['captured-page-id'] || !args['reverse-index'] || !args.output) {
      console.error('Usage: consolidation-script --manifest <json> --captured-page-id <id> --reverse-index <json> --output <js>');
      process.exit(2);
    }
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const reverseIndex = JSON.parse(fs.readFileSync(args['reverse-index'], 'utf8'));
    const pageId = args['captured-page-id'];
    const script = buildConsolidationScript(manifest, reverseIndex, pageId);
    fs.writeFileSync(args.output, script);
    process.exit(0);
  }

  if (cmd === 'preflight') {
    if (!args['design-context'] || !args['variable-defs'] || !args['globals-css'] || !args.config || !args.output) {
      console.error('Usage: preflight --design-context <ctx.json> --variable-defs <vars.json> --globals-css <path> --config <path> --output <report.md>');
      process.exit(2);
    }
    // Reuse lint-engine's CLI by invoking it as a subprocess. This is the
    // symmetric-pipeline assertion — same code path as /adhd:lint.
    const lintCli = path.resolve(__dirname, '..', 'lint-engine', 'cli.js');
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('node', [
      lintCli,
      '--design-context', args['design-context'],
      '--variable-defs', args['variable-defs'],
      '--globals-css', args['globals-css'],
      '--config', args.config,
      '--target', 'PushComponent Preflight',
      '--target-url', 'about:blank',
      '--output', args.output,
    ], { encoding: 'utf8', stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
```

Add the helper `buildConsolidationScript` above `main()`:

```js
function buildConsolidationScript(manifest, reverseIndex, pageId) {
  // The script is injected into use_figma; it walks the captured page,
  // matches variant frames by data-adhd-variant (in name or metadata),
  // dedupes via visual signature, rebinds to existing variables, and
  // wraps into a Component Set with declared variant properties.
  const MANIFEST_JSON = JSON.stringify(manifest);
  const RI_JSON = JSON.stringify(reverseIndex);
  return `
const PAGE_ID = ${JSON.stringify(pageId)};
const MANIFEST = ${MANIFEST_JSON};
const REVERSE_INDEX = ${RI_JSON};

// 1. Load the captured page
const page = await figma.getNodeByIdAsync(PAGE_ID);
if (!page || page.type !== 'PAGE') throw new Error('Captured page not found: ' + PAGE_ID);
await figma.setCurrentPageAsync(page);

// 2. Find variant frames by data-adhd-variant in layer name
function findVariants(root) {
  const out = [];
  function walk(n) {
    if (n.name && n.name.includes('data-adhd-variant=')) {
      out.push(n);
      return; // don't recurse into a variant frame
    }
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  }
  walk(root);
  return out;
}

let variantFrames = findVariants(page);

if (variantFrames.length === 0) {
  throw new Error('Capture produced no recognizable variant frames (no nodes with data-adhd-variant name)');
}

// 3. Parse the variant key out of each frame's name
function variantKeyFromName(name) {
  const m = /data-adhd-variant="?([^"]+)"?/.exec(name);
  return m ? m[1] : null;
}
function keyToProps(key) {
  const out = {};
  for (const pair of key.split(';')) {
    const [k, v] = pair.split('=');
    out[k] = v;
  }
  return out;
}

// 4. Combine into a Component Set
const sortedFrames = variantFrames.sort((a, b) => {
  const ka = variantKeyFromName(a.name) || '';
  const kb = variantKeyFromName(b.name) || '';
  return ka.localeCompare(kb);
});

const componentSet = figma.combineAsVariants(sortedFrames, page);
componentSet.name = MANIFEST.componentName;

// 5. Declare variant properties per child
for (const child of componentSet.children) {
  const key = variantKeyFromName(child.name);
  if (!key) continue;
  const props = keyToProps(key);
  // Drop 'undefined' values — they represent the component's natural default
  for (const k of Object.keys(props)) if (props[k] === 'undefined') delete props[k];
  child.variantProperties = props;
}

// 6. Position the Component Set
componentSet.x = 40;
componentSet.y = 40;

// 7. Rename page
page.name = MANIFEST.componentName;

return {
  componentSetId: componentSet.id,
  variantCount: componentSet.children.length,
  pageId: page.id,
};
`;
}
```

- [ ] **Step 3: Run all tests**

```bash
node --test plugins/adhd/lib/push-component/__tests__/
```

Expected: 9+ tests passing.

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/lib/push-component/cli.js plugins/adhd/lib/push-component/__tests__/cli.test.js
git commit -m "Add consolidation-script + preflight subcommands to push-component CLI"
```

---

## Task 10: skills/push-component/SKILL.md

**Files:**
- Create: `plugins/adhd/skills/push-component/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
description: "Push a React component to the configured Figma file as a structured Component Set. Reads adhd.config.ts. Parses the component's variant axes from its TypeScript prop unions, generates a temp Next.js preview route, captures it via generate_figma_design, wraps the captured frames into a Component Set with variant properties, rebinds raw values to existing design-system variables, and runs the same lint engine /adhd:lint uses as a preflight check before finalizing."
disable-model-invocation: true
argument-hint: "<component-path> [--max-variants <n>]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma mcp__plugin_figma_figma__generate_figma_design
---

# ADHD Push Component

Pushes a React component to Figma as a structured Component Set. Uses the Figma remote MCP's `generate_figma_design` for capture and `use_figma` for cleanup. Runs the same lint engine /adhd:lint uses as a preflight check before finalizing.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-push-component.md`

## Phase 1: Validate config and arguments

Read `adhd.config.ts`. Extract `figma.url` (required). If missing, abort with: "Run /adhd:config first to set up ADHD."

Parse `$ARGUMENTS`:
- First positional: component file path (required, relative or absolute)
- `--max-variants <n>` (optional): cap the Cartesian product
- `--variants <prop1,prop2,...>` (optional): explicitly opt non-union props into the variant matrix

If the component path doesn't exist on disk, abort with the specific path.

## Phase 2: Parse component

Use `Bash`:
```bash
mkdir -p /tmp/adhd-push-component
node plugins/adhd/lib/push-component/cli.js parse <component-path> \
  --output /tmp/adhd-push-component/manifest.json \
  ${MAX_VARIANTS:+--max-variants $MAX_VARIANTS}
```

If parse fails (no exported function, props interface not found), surface the error to the user and abort.

Read `/tmp/adhd-push-component/manifest.json`. Inspect:
- Total Cartesian combinations
- Resolved variant axes

If `manifest.totalCombinations > 30` and the user didn't pass `--max-variants`, print a warning: "This will produce 40+ variants. Pass --max-variants 16 to cap." Continue anyway (user decides).

## Phase 3: Generate temp preview page

Use `Bash`:
```bash
node plugins/adhd/lib/push-component/cli.js generate-preview \
  --manifest /tmp/adhd-push-component/manifest.json \
  --output /tmp/adhd-push-component/preview.tsx
```

Then determine where to write the preview file in the user's project. Default: `example/app/__adhd-preview/page.tsx`. If `example/` doesn't exist in the cwd, use `app/__adhd-preview/page.tsx` (project root).

If the destination already exists AND its first comment is not "Auto-generated by /adhd:push-component", abort to avoid clobbering user work.

Use the `Write` tool to write `/tmp/adhd-push-component/preview.tsx`'s content to the destination.

## Phase 4: Verify dev server

Determine the dev server URL: default `http://localhost:3000`; override with `devServerUrl` in `adhd.config.ts` if set.

Use `Bash`:
```bash
curl -sf -o /dev/null --max-time 3 "$DEV_URL/"
```

If exit code is non-zero, abort with: "Dev server not running. Run `cd example && npm run dev` (or your equivalent) in a separate terminal, then re-invoke /adhd:push-component."

## Phase 5: Capture via generate_figma_design

Call `mcp__plugin_figma_figma__generate_figma_design` with the preview URL: `$DEV_URL/__adhd-preview`.

The response should include a page ID for the newly created Figma page. Save it as `CAPTURED_PAGE_ID`.

## Phase 6: Delete temp preview file

Use `Bash`:
```bash
rm <destination-path>
```

We don't leave the temp file in the user's project after capture.

## Phase 7: Build reverse index (current Figma state)

We need to know which variables exist in the Figma file so we can rebind captured raw values.

Use `mcp__plugin_figma_figma__use_figma` to run the same EXTRACT_SCRIPT that lib/design-system uses (or a slimmer variant — color + spacing + radius + typography + effects). Save the response to `/tmp/adhd-push-component/figma-state.json`.

Build the reverse index:
```bash
node -e "
const { buildReverseIndex } = require('./plugins/adhd/lib/push-component/reverse-index');
const extract = JSON.parse(require('fs').readFileSync('/tmp/adhd-push-component/figma-state.json', 'utf8'));
const ri = buildReverseIndex(extract);
// Map can't be serialized — convert to plain arrays
const plain = Object.fromEntries(Object.entries(ri).map(([k, m]) => [k, [...m.entries()]]));
require('fs').writeFileSync('/tmp/adhd-push-component/reverse-index.json', JSON.stringify(plain));
"
```

## Phase 8: Build consolidation script

Use `Bash`:
```bash
node plugins/adhd/lib/push-component/cli.js consolidation-script \
  --manifest /tmp/adhd-push-component/manifest.json \
  --captured-page-id "$CAPTURED_PAGE_ID" \
  --reverse-index /tmp/adhd-push-component/reverse-index.json \
  --output /tmp/adhd-push-component/consolidation.js
```

## Phase 9: Run consolidation via use_figma

Use the `Read` tool on `/tmp/adhd-push-component/consolidation.js` to get its content.

Call `mcp__plugin_figma_figma__use_figma` with that content as the `code` parameter. Save the response `componentSetId` and `pageId`.

## Phase 10: Run preflight lint

Extract the new Component Set's structural data using `mcp__plugin_figma_figma__use_figma` (similar to /adhd:lint's Phase 3 extraction).

Save to `/tmp/adhd-push-component/ctx.json` (the design context) and `/tmp/adhd-push-component/vars.json` (referenced variables).

Run:
```bash
node plugins/adhd/lib/push-component/cli.js preflight \
  --design-context /tmp/adhd-push-component/ctx.json \
  --variable-defs /tmp/adhd-push-component/vars.json \
  --globals-css example/app/globals.css \
  --config adhd.config.ts \
  --output /tmp/adhd-push-component/preflight-report.md
```

Read the report. Parse out error count and warning count.

## Phase 11: Decide and finalize OR roll back

If preflight has zero errors: print "✓ Preflight clean" plus warning summary, then proceed to Phase 12.

If preflight has errors: print the report. Use `AskUserQuestion`:
- "Keep the pushed page (you can fix in Figma manually)"
- "Roll back — delete the captured page and exit"

If user picks roll back:
```js
// run via use_figma
const page = await figma.getNodeByIdAsync(PAGE_ID);
page.remove();
return { rolledBack: true };
```

Then print "Rolled back. No changes to Figma. Fix the issues in your component and re-run." Exit with code 1.

If user picks keep, proceed to Phase 12.

## Phase 12: Final report

Print:
```
✓ Pushed <ComponentName> to Figma
  Page: <pageId>
  Variants: <count> (after dedup)
  Variant properties: <listed axes>
  Variables bound: <count>
  Preflight: <error count> errors, <warning count> warnings
  Page URL: https://figma.com/design/<fileKey>?node-id=<pageId>
```

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `Component file not found` | Verify the path. |
| `No exported function component` | The component must export a function named in PascalCase. |
| `Could not locate props` | Add an `<ComponentName>Props` interface or type. |
| `Dev server not running` | Run `npm run dev` in a separate terminal. |
| `Capture produced no variant frames` | The dev server may have rendered an error instead of the preview. Visit `$DEV_URL/__adhd-preview` in a browser to verify. |
| `Preflight errors` | Run `/adhd:lint` to see the same violations; fix the source component. |
```

- [ ] **Step 2: Validate frontmatter**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: 5/5 skills valid (config, push-design-system, pull-design-system, lint, push-component).

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/push-component/SKILL.md
git commit -m "Add /adhd:push-component skill"
```

---

## Task 11: Hygiene — README, gitignore, marketplace, CI

**Files:**
- Modify: `example/.gitignore`
- Modify: `README.md`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add __adhd-preview/ to example/.gitignore**

Edit `example/.gitignore`, append:

```
# ADHD push-component temp preview routes (auto-generated, auto-deleted)
__adhd-preview/
```

- [ ] **Step 2: Update README command table**

In `README.md`, find the command table and add the new row:

```markdown
| `/adhd:push-component` | code → Figma | Pushes a React component to Figma as a structured Component Set with variant properties + variable bindings, plus a preflight lint check |
```

- [ ] **Step 3: Update marketplace.json description**

Edit `.claude-plugin/marketplace.json`. Update the description to mention push-component:

```json
{
  "name": "adhd",
  "source": "./plugins/adhd",
  "description": "Push, pull, and lint design tokens between Tailwind v4 and Figma; push React components with preflight validation."
}
```

- [ ] **Step 4: Add push-component test step to CI**

Edit `.github/workflows/ci.yml`. In the `lib unit tests` job, add a step:

```yaml
      - name: Run push-component tests
        run: node --test plugins/adhd/lib/push-component/__tests__/
```

- [ ] **Step 5: Run all tests + validator**

```bash
node --test plugins/adhd/lib/design-system/__tests__/ plugins/adhd/lib/lint-engine/__tests__/ plugins/adhd/lib/push-component/__tests__/
node scripts/validate-skill-frontmatter.js
```

Expected: all tests pass (existing 164 + ~50 new); 5/5 skills valid.

- [ ] **Step 6: Commit**

```bash
git add README.md example/.gitignore .claude-plugin/marketplace.json .github/workflows/ci.yml
git commit -m "Hygiene: gitignore, README, marketplace, CI for /adhd:push-component"
```

---

## Self-review checklist

**1. Spec coverage:**

- Spec §"Final command surface" → Task 10 (skill)
- Spec §"Parse step details" → Task 2 (parse-component)
- Spec §"Required prop defaults" → Task 3 (prop-defaults)
- Spec §"Variant axes vs default props" → Task 4 (variant-matrix) + Task 8 (cli buildManifest)
- Spec §"Cap algorithm" → Task 4 (capWithCoverage)
- Spec §"Temp preview page" → Task 5 (preview-generator) + Task 10 Phase 3
- Spec §"Consolidation pass" → Task 9 (consolidation-script)
- Spec §"Deduplicate by visual signature" → Task 7 (visual-signature). **Gap:** Task 9's consolidation script doesn't yet *use* visual-signature for dedup. **Fix:** add a dedup step in Task 9's consolidation script that groups by signature and prunes duplicates before combineAsVariants.
- Spec §"Rebind raw values" → Task 6 (reverse-index) + Task 9 (consolidation script applies bindings). **Gap:** Task 9's consolidation script doesn't yet rebind. **Fix:** add a binding step.
- Spec §"Preflight lint" → Task 9 (cli preflight subcommand) + Task 10 Phase 10
- Spec §"Edge cases & errors" → covered across Tasks 2, 5, 10
- Spec §16 acceptance criteria — verify with Task 12 manual smoke test (added below)

**Gaps to fix inline:**

The first pass of Task 9's consolidation script handles only the basic Component Set wrap. The spec's dedup + variable rebinding need to be included in the script. Adding to Task 9 below.

**2. Placeholder scan:** no TBD / TODO / "implement later" in steps.

**3. Type consistency:** the manifest shape used by Task 8 (buildManifest output) matches what Task 5 (generatePreviewTsx) and Task 9 (buildConsolidationScript) consume.

---

## Task 12 (added during self-review): Complete consolidation script — dedup + rebinding

The Task 9 consolidation script only handles wrap-into-set. Add the missing spec-required steps.

**Files:**
- Modify: `plugins/adhd/lib/push-component/cli.js` (the `buildConsolidationScript` function)

- [ ] **Step 1: Extend the consolidation script template**

In `cli.js`'s `buildConsolidationScript`, between step 3 (parse variant key) and step 4 (combine into Component Set), insert deduplication. Between step 5 (declare variant properties) and step 6 (position), insert variable rebinding.

Replace the existing `buildConsolidationScript` with the expanded version:

```js
function buildConsolidationScript(manifest, reverseIndex, pageId) {
  const MANIFEST_JSON = JSON.stringify(manifest);
  const RI_JSON = JSON.stringify(reverseIndex);
  return `
const PAGE_ID = ${JSON.stringify(pageId)};
const MANIFEST = ${MANIFEST_JSON};
const REVERSE_INDEX = ${RI_JSON};

// 1. Load the captured page
const page = await figma.getNodeByIdAsync(PAGE_ID);
if (!page || page.type !== 'PAGE') throw new Error('Captured page not found: ' + PAGE_ID);
await figma.setCurrentPageAsync(page);

// 2. Find variant frames by data-adhd-variant in layer name
function findVariants(root) {
  const out = [];
  function walk(n) {
    if (n.name && n.name.includes('data-adhd-variant=')) { out.push(n); return; }
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  }
  walk(root);
  return out;
}
let variantFrames = findVariants(page);
if (variantFrames.length === 0) {
  throw new Error('Capture produced no recognizable variant frames');
}

// 3. Extract variant key
function variantKeyFromName(name) {
  const m = /data-adhd-variant="?([^"]+)"?/.exec(name); return m ? m[1] : null;
}
function keyToProps(key) {
  const out = {};
  for (const pair of key.split(';')) { const [k, v] = pair.split('='); out[k] = v; }
  return out;
}

// 4. Visual-signature dedup (inline implementation matching visual-signature.js)
function structuralHash(node) {
  const RELEVANT = ['type','width','height','layoutMode','paddingTop','paddingBottom','paddingLeft','paddingRight','itemSpacing','cornerRadius','fills','strokes','effects','characters','fontSize'];
  function pick(n) {
    if (!n || typeof n !== 'object') return n;
    if (Array.isArray(n)) return n.map(pick);
    const out = {};
    for (const k of RELEVANT) if (k in n) out[k] = pick(n[k]);
    if (Array.isArray(n.children)) out.children = n.children.map(pick);
    return out;
  }
  // Inline hash (no crypto in Figma sandbox; use a deterministic JSON-stringify)
  return JSON.stringify(pick(node));
}
const bySig = new Map();
for (const f of variantFrames) {
  const sig = structuralHash(f);
  if (!bySig.has(sig)) bySig.set(sig, []);
  bySig.get(sig).push(f);
}
const survivors = [];
const collapsed = [];
for (const [sig, frames] of bySig) {
  const sorted = frames.sort((a,b) => (variantKeyFromName(a.name)||'').localeCompare(variantKeyFromName(b.name)||''));
  survivors.push(sorted[0]);
  for (let i = 1; i < sorted.length; i++) { collapsed.push(sorted[i].name); sorted[i].remove(); }
}

// 5. Compute effective variant properties (drop axes that don't distinguish any survivors)
const survivorProps = survivors.map(s => keyToProps(variantKeyFromName(s.name) || ''));
const axisNames = new Set();
for (const p of survivorProps) for (const k of Object.keys(p)) axisNames.add(k);
const effectiveAxes = new Set();
for (const axis of axisNames) {
  const values = new Set(survivorProps.map(p => p[axis]));
  if (values.size > 1) effectiveAxes.add(axis);
}

// 6. Combine into Component Set
const sorted = survivors.sort((a,b) => (variantKeyFromName(a.name)||'').localeCompare(variantKeyFromName(b.name)||''));
const componentSet = figma.combineAsVariants(sorted, page);
componentSet.name = MANIFEST.componentName;

// 7. Set variantProperties only for effective axes; drop 'undefined' values
for (const child of componentSet.children) {
  const key = variantKeyFromName(child.name);
  const props = key ? keyToProps(key) : {};
  const effective = {};
  for (const k of Object.keys(props)) {
    if (effectiveAxes.has(k) && props[k] !== 'undefined') effective[k] = props[k];
  }
  child.variantProperties = effective;
}

// 8. Rebind raw fills / paddings / radii to existing Figma variables
function rgbKey(c) { const to3 = (n) => Math.round(n * 1000)/1000; return [to3(c.r), to3(c.g), to3(c.b), to3('a' in c ? c.a : 1)].join(','); }
const colorIndex = new Map(REVERSE_INDEX.color || []);
const spacingIndex = new Map(REVERSE_INDEX.spacing || []);
const radiusIndex = new Map(REVERSE_INDEX.radius || []);

async function bindNode(n) {
  // Fills
  if (Array.isArray(n.fills)) {
    const newFills = [];
    let changed = false;
    for (const fill of n.fills) {
      if (fill.type === 'SOLID' && fill.color) {
        const hit = colorIndex.get(rgbKey(fill.color));
        if (hit && !fill.boundVariables?.color) {
          const v = await figma.variables.getVariableByIdAsync(hit.id);
          if (v) { newFills.push(figma.variables.setBoundVariableForPaint(fill, 'color', v)); changed = true; continue; }
        }
      }
      newFills.push(fill);
    }
    if (changed) n.fills = newFills;
  }
  // Padding / itemSpacing
  for (const field of ['paddingTop','paddingBottom','paddingLeft','paddingRight','itemSpacing']) {
    if (typeof n[field] === 'number' && n[field] !== 0) {
      const hit = spacingIndex.get(n[field]);
      if (hit && !n.boundVariables?.[field]) {
        const v = await figma.variables.getVariableByIdAsync(hit.id);
        if (v) n.setBoundVariable(field, v);
      }
    }
  }
  // Corner radii
  for (const field of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) {
    if (typeof n[field] === 'number' && n[field] !== 0) {
      const hit = radiusIndex.get(n[field]);
      if (hit && !n.boundVariables?.[field]) {
        const v = await figma.variables.getVariableByIdAsync(hit.id);
        if (v) n.setBoundVariable(field, v);
      }
    }
  }
  // Recurse
  if (Array.isArray(n.children)) for (const c of n.children) await bindNode(c);
}

let boundCount = 0;
for (const child of componentSet.children) {
  await bindNode(child);
}

// 9. Position and finalize
componentSet.x = 40; componentSet.y = 40;
page.name = MANIFEST.componentName;

return {
  componentSetId: componentSet.id,
  variantCount: componentSet.children.length,
  collapsedCount: collapsed.length,
  effectiveAxes: [...effectiveAxes],
  pageId: page.id,
};
`;
}
```

- [ ] **Step 2: Run tests**

```bash
node --test plugins/adhd/lib/push-component/__tests__/
```

Existing tests should still pass; the consolidation script test only checks that the script contains the page ID and component name, so the expanded script is compatible.

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/lib/push-component/cli.js
git commit -m "Complete consolidation script: dedup + effective axes + variable rebinding"
```

---

## Task 13: End-to-end manual smoke test

After the engine + skill are built, run the command against the example app's Avatar.

- [ ] **Step 1: Start the example dev server**

In a separate terminal:
```bash
cd example && npm run dev
```

Verify `http://localhost:3000/` renders.

- [ ] **Step 2: Invoke /adhd:push-component**

In a Claude Code session in this repo:
```
/adhd:push-component example/app/components/avatar/index.tsx --max-variants 16
```

- [ ] **Step 3: Verify in Figma**

Open the configured Figma file. Expected:
- A new page named "Avatar"
- One Component Set on that page named "Avatar"
- 16 variant Components inside
- Each variant has `variantProperties` (size at minimum; shape/status if those axes survived dedup)
- Many fills/paddings bound to existing variables
- Preflight report printed to terminal

- [ ] **Step 4: Verify the symmetric pipeline**

In Claude Code:
```
/adhd:lint https://figma.com/design/<fileKey>?node-id=<componentSetId>
```

The lint output should match the preflight report (acceptance criterion #15).

- [ ] **Step 5: No commit** — this is verification only.
