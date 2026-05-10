# /adhd:check and /adhd:sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/adhd:check` (read-only) and refactor `/adhd:sync` (write) to operate on a Figma frame, component, component set, or page — validating tokens + structure and emitting a paste-ready markdown report.

**Architecture:** A new pure JS library `plugins/adhd/lib/check-engine/` does all the work (parse, normalize, categorize, structure-check, format report). It exposes a CLI that takes pre-fetched MCP responses + globals.css path and emits structured violations. The two skills (`check`, `sync`) orchestrate: call MCP via tool calls, write the response to a temp JSON file, run the CLI, present results, and (for `sync`) apply writes via the existing `to-dtcg` writer.

**Tech Stack:** Node 20+ (zero deps, matches `lib/to-dtcg/` convention), `node:test` for unit tests, Claude Code skills for user-facing commands. No external libraries.

**Spec:** `docs/superpowers/specs/2026-05-10-adhd-check-and-sync-design.md`

**Precondition (separate PR before this plan starts):** `/adhd:export-for-figma` is renamed to `/adhd:seed`. This plan assumes the new name throughout. The rename PR touches: `plugins/adhd/skills/export-for-figma/` → `plugins/adhd/skills/seed/`, references in `README.md`, `AGENTS.md`, `example/AGENTS.md`, the `to-dtcg` README, and the existing config/sync skills' cross-references.

---

## File structure

### New files

```
plugins/adhd/lib/check-engine/
├── README.md                          # usage + dev workflow (mirror of lib/to-dtcg/README.md style)
├── cli.js                             # entry point — orchestrates the engine
├── name-normalizer.js                 # Figma path → CSS var name
├── value-normalizer.js                # domain-aware value comparison
├── theme-parser.js                    # globals.css → comparable map
├── variable-categorizer.js            # missing/same/conflict (Light + Dark)
├── structure-checker.js               # STRUCT001–STRUCT010 evaluation
├── report-formatter.js                # markdown report
├── __fixtures__/
│   ├── sample-mcp-variable-defs.json   # captured MCP get_variable_defs response
│   ├── sample-mcp-design-context.json  # captured MCP get_design_context response
│   └── sample-globals.css              # parsed-from-example fixture
└── __tests__/
    ├── name-normalizer.test.js
    ├── value-normalizer.test.js
    ├── theme-parser.test.js
    ├── variable-categorizer.test.js
    ├── structure-checker.test.js
    ├── report-formatter.test.js
    └── cli.test.js

plugins/adhd/skills/check/SKILL.md      # new user-invocable skill
```

### Modified files

```
plugins/adhd/skills/sync/SKILL.md        # refactor to use check-engine + frame-scoped input
plugins/adhd/skills/config/SKILL.md      # add naming convention question + schema entry
scripts/validate-skill-frontmatter.js    # no logic change; just exercises the new skill
README.md                                 # update command table to reflect /adhd:check
example/.gitignore                        # add adhd-check-report.md
```

### Why this decomposition

Each module has one clear responsibility and one input/output contract. Names map 1:1 to spec sections (Section 3 → variable-categorizer, Section 4 → structure-checker, Section 6 → report-formatter). The CLI is a thin orchestrator — easy to test, easy to call from skills.

---

## Task 0: Capture real MCP fixtures (preflight)

This task is a **fact-finding gate**. The spec assumes shapes for `get_variable_defs` and `get_design_context` responses that we haven't fully verified (especially `variantProperties` exposure on `COMPONENT` nodes inside a Component Set). If MCP doesn't return what we need, structure rules need adjustment before the rest of the plan runs.

**Files:**
- Create: `plugins/adhd/lib/check-engine/__fixtures__/sample-mcp-variable-defs.json`
- Create: `plugins/adhd/lib/check-engine/__fixtures__/sample-mcp-design-context.json`
- Create: `plugins/adhd/lib/check-engine/__fixtures__/sample-globals.css`

- [ ] **Step 1: Pick a Figma frame for fixture capture**

In the Figma file configured for the example app (see `example/adhd.config.ts`), pick a frame that contains:
- At least one component that uses color variables, spacing variables, typography variables
- At least one Component Set with two variants and at least one variant property
- At least one nested layer that's an instance of a component
- (If possible) one intentional anti-pattern: a frame without auto-layout, OR a raw hex fill

Note its node-id from the URL.

- [ ] **Step 2: Capture MCP responses**

In a fresh Claude session in the example/ directory, invoke each MCP call and save the raw JSON to a fixture file:

```
mcp__figma__get_variable_defs(nodeId: "<picked-id>")  → __fixtures__/sample-mcp-variable-defs.json
mcp__figma__get_design_context(nodeId: "<picked-id>") → __fixtures__/sample-mcp-design-context.json
```

- [ ] **Step 3: Capture local globals.css**

Copy `example/app/globals.css` to `plugins/adhd/lib/check-engine/__fixtures__/sample-globals.css`.

- [ ] **Step 4: Verify the design-context shape supports our rules**

Open `sample-mcp-design-context.json` and confirm each of these is detectable:

| Rule | Field needed |
|---|---|
| STRUCT001 (auto-layout) | `layoutMode` per frame node |
| STRUCT002 (spacing vars) | `paddingTop/Right/Bottom/Left`, `itemSpacing`, with reference indicator (e.g., `boundVariables.paddingTop`) |
| STRUCT003 (color vars) | `fills[].boundVariables` or similar reference indicator |
| STRUCT004 (typography vars) | `style.boundVariables` on TEXT nodes (or a `textStyleId` field) |
| STRUCT005 (effect vars) | `effects[].boundVariables` (or `effectStyleId`) |
| STRUCT006 (detached instances) | A flag on instance nodes — likely absent for genuinely detached. Verify by checking instance vs detached layers in fixture. |
| STRUCT007 (variants in set) | Type `COMPONENT_SET` with children type `COMPONENT` (and bare `COMPONENT` outside any set for the negative case) |
| STRUCT008 (meaningful names) | Each node has `name`; we'll match against auto-name regex |
| STRUCT009 (naming convention) | `name` per node, plus `variantProperties` keys/values for component-set children |
| STRUCT010 (variant properties declared) | `componentPropertyDefinitions` on COMPONENT_SET, or `variantProperties` on each COMPONENT child |

If any field is absent or named differently, **stop and update the spec** before proceeding. Note the actual field names in `__fixtures__/README.md` (create it if missing).

- [ ] **Step 5: Commit fixtures**

```bash
git add plugins/adhd/lib/check-engine/__fixtures__/
git commit -m "Capture MCP fixtures for check-engine development"
```

---

## Task 1: Scaffold lib/check-engine + smoke test

**Files:**
- Create: `plugins/adhd/lib/check-engine/cli.js`
- Create: `plugins/adhd/lib/check-engine/__tests__/cli.test.js`
- Create: `plugins/adhd/lib/check-engine/README.md`

- [ ] **Step 1: Create empty CLI scaffolding**

Write `plugins/adhd/lib/check-engine/cli.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * ADHD check-engine CLI.
 * Inputs (all required, passed as flags):
 *   --variable-defs <path>     JSON file with MCP get_variable_defs response
 *   --design-context <path>    JSON file with MCP get_design_context response
 *   --globals-css <path>       Path to globals.css to compare against
 *   --config <path>            Path to adhd.config.ts (for naming convention etc.)
 *   --target <label>           Human-readable target description (e.g. "Page 1 / Card")
 *   --target-url <url>         Figma deep-link to the target node
 *   --output <path>            Where to write the markdown report
 * Output:
 *   - Markdown report at --output
 *   - JSON violations on stdout (for skills to consume)
 *   - Exit 0 if no errors, 1 if any errors
 */

function main() {
  console.error('check-engine: not implemented yet');
  process.exit(2);
}

main();
```

- [ ] **Step 2: Write the smoke test**

Write `plugins/adhd/lib/check-engine/__tests__/cli.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli prints a not-implemented message and exits 2 when invoked with no args', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not implemented/);
});
```

- [ ] **Step 3: Run the test to confirm it passes**

```bash
node --test plugins/adhd/lib/check-engine/__tests__/cli.test.js
```

Expected: 1 test passing.

- [ ] **Step 4: Add a README**

Write `plugins/adhd/lib/check-engine/README.md`:

```markdown
# check-engine

Pure-JS engine that powers `/adhd:check` and `/adhd:sync`. Takes pre-fetched
Figma MCP responses + a local `globals.css` and produces a violation report.

## Usage

```bash
node plugins/adhd/lib/check-engine/cli.js \
  --variable-defs /tmp/vars.json \
  --design-context /tmp/ctx.json \
  --globals-css example/app/globals.css \
  --config example/adhd.config.ts \
  --target "Page 1 / Card" \
  --target-url "https://figma.com/design/<file>?node-id=123-456" \
  --output adhd-check-report.md
```

Emits the full markdown report to `--output` and a JSON summary to stdout.
Exit 0 = no errors (warnings allowed); exit 1 = at least one error.

## Tests

```bash
node --test plugins/adhd/lib/check-engine/__tests__/
```

## Architecture

- `name-normalizer.js` — Figma path ↔ CSS var name
- `value-normalizer.js` — domain-aware comparable values
- `theme-parser.js` — globals.css → comparable map
- `variable-categorizer.js` — missing / same / conflict
- `structure-checker.js` — STRUCT001–STRUCT010
- `report-formatter.js` — markdown output
- `cli.js` — orchestrator
```

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/
git commit -m "Scaffold lib/check-engine with smoke-test CLI"
```

---

## Task 2: name-normalizer.js

Translates Figma's collection-prefixed paths to CSS variable names. `Primitives/color/brand/600` ↔ `--color-brand-600`.

**Files:**
- Create: `plugins/adhd/lib/check-engine/name-normalizer.js`
- Test: `plugins/adhd/lib/check-engine/__tests__/name-normalizer.test.js`

- [ ] **Step 1: Write the failing tests**

Write `plugins/adhd/lib/check-engine/__tests__/name-normalizer.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { figmaToCssVar, cssVarToFigma } = require('../name-normalizer');

test('drops collection prefix, slashes become hyphens, lowercases', () => {
  assert.equal(figmaToCssVar('Primitives/color/brand/600'), '--color-brand-600');
  assert.equal(figmaToCssVar('Semantic/color/surface/elevated'), '--color-surface-elevated');
  assert.equal(figmaToCssVar('Primitives/space/2xl'), '--space-2xl');
});

test('handles single-segment names with collection prefix', () => {
  assert.equal(figmaToCssVar('Primitives/radius/pill'), '--radius-pill');
});

test('handles missing collection prefix (defensive — accepts both forms)', () => {
  assert.equal(figmaToCssVar('color/brand/600'), '--color-brand-600');
});

test('cssVarToFigma is best-effort reverse: assumes a known collection set', () => {
  assert.equal(
    cssVarToFigma('--color-brand-600', { primitives: ['color'], semantic: [] }),
    'Primitives/color/brand/600',
  );
  assert.equal(
    cssVarToFigma('--color-surface-elevated', { primitives: ['color'], semantic: ['color/surface'] }),
    'Semantic/color/surface/elevated',
  );
});

test('throws on inputs that are clearly not Figma paths', () => {
  assert.throws(() => figmaToCssVar(''), /empty/);
  assert.throws(() => figmaToCssVar(null), /string/);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
node --test plugins/adhd/lib/check-engine/__tests__/name-normalizer.test.js
```

Expected: all tests fail with "Cannot find module".

- [ ] **Step 3: Implement name-normalizer.js**

Write `plugins/adhd/lib/check-engine/name-normalizer.js`:

```js
'use strict';

const KNOWN_COLLECTIONS = new Set(['primitives', 'semantic']);

function figmaToCssVar(figmaPath) {
  if (typeof figmaPath !== 'string') {
    throw new TypeError('figmaToCssVar: expected string, got ' + typeof figmaPath);
  }
  if (figmaPath === '') {
    throw new Error('figmaToCssVar: empty path');
  }
  const segments = figmaPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('figmaToCssVar: no segments in "' + figmaPath + '"');
  }

  // Drop leading collection prefix if present
  if (KNOWN_COLLECTIONS.has(segments[0].toLowerCase())) {
    segments.shift();
  }

  return '--' + segments.join('-').toLowerCase();
}

function cssVarToFigma(cssVarName, collections) {
  if (typeof cssVarName !== 'string' || !cssVarName.startsWith('--')) {
    throw new TypeError('cssVarToFigma: expected --css-var-name, got ' + cssVarName);
  }
  const path = cssVarName.slice(2).split('-').join('/');

  // Decide which collection: semantic if path has a known semantic prefix, else primitives
  const semanticPrefixes = collections?.semantic ?? [];
  for (const prefix of semanticPrefixes) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return 'Semantic/' + path;
    }
  }
  return 'Primitives/' + path;
}

module.exports = { figmaToCssVar, cssVarToFigma };
```

- [ ] **Step 4: Run the tests**

```bash
node --test plugins/adhd/lib/check-engine/__tests__/name-normalizer.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/name-normalizer.js plugins/adhd/lib/check-engine/__tests__/name-normalizer.test.js
git commit -m "Add name-normalizer for Figma path ↔ CSS var conversion"
```

---

## Task 3: value-normalizer.js

Compares values across Figma and CSS forms (hex case differences, px/rem unit normalization, shadow object equality).

**Files:**
- Create: `plugins/adhd/lib/check-engine/value-normalizer.js`
- Test: `plugins/adhd/lib/check-engine/__tests__/value-normalizer.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeColor, normalizeDimension, valuesMatch } = require('../value-normalizer');

test('normalizeColor lowercases hex and pads to 6 digits', () => {
  assert.equal(normalizeColor('#5E3AEE'), '#5e3aee');
  assert.equal(normalizeColor('#fff'), '#ffffff');
  assert.equal(normalizeColor('#FFF'), '#ffffff');
});

test('normalizeColor preserves alpha when present', () => {
  assert.equal(normalizeColor('#5E3AEEFF'), '#5e3aeeff');
  assert.equal(normalizeColor('#5e3aee80'), '#5e3aee80');
});

test('normalizeColor accepts rgb()/rgba() and converts to hex', () => {
  assert.equal(normalizeColor('rgb(94, 58, 238)'), '#5e3aee');
  assert.equal(normalizeColor('rgba(94, 58, 238, 0.5)'), '#5e3aee80');
});

test('normalizeDimension converts rem to px (assuming 16px root)', () => {
  assert.equal(normalizeDimension('1rem'), '16px');
  assert.equal(normalizeDimension('2rem'), '32px');
  assert.equal(normalizeDimension('0.5rem'), '8px');
});

test('normalizeDimension passes through px values', () => {
  assert.equal(normalizeDimension('32px'), '32px');
});

test('normalizeDimension preserves unitless values (e.g., line-height)', () => {
  assert.equal(normalizeDimension('1.5'), '1.5');
});

test('valuesMatch dispatches on domain', () => {
  assert.equal(valuesMatch('#5E3AEE', '#5e3aee', 'color'), true);
  assert.equal(valuesMatch('#5E3AEE', '#000000', 'color'), false);
  assert.equal(valuesMatch('1rem', '16px', 'spacing'), true);
  assert.equal(valuesMatch('1.5', '1.5', 'typography'), true);
});

test('valuesMatch deep-equals shadow objects', () => {
  const a = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#000000' };
  const b = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#000000' };
  const c = { ...a, blur: '12px' };
  assert.equal(valuesMatch(a, b, 'shadow'), true);
  assert.equal(valuesMatch(a, c, 'shadow'), false);
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
node --test plugins/adhd/lib/check-engine/__tests__/value-normalizer.test.js
```

- [ ] **Step 3: Implement value-normalizer.js**

```js
'use strict';

const HEX_3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_6 = /^#([0-9a-f]{6})$/i;
const HEX_8 = /^#([0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

function normalizeColor(input) {
  if (typeof input !== 'string') {
    throw new TypeError('normalizeColor: expected string, got ' + typeof input);
  }
  const trimmed = input.trim();

  const m3 = HEX_3.exec(trimmed);
  if (m3) {
    return ('#' + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3]).toLowerCase();
  }
  if (HEX_6.test(trimmed) || HEX_8.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const rgb = RGB_RE.exec(trimmed);
  if (rgb) {
    const r = Number(rgb[1]).toString(16).padStart(2, '0');
    const g = Number(rgb[2]).toString(16).padStart(2, '0');
    const b = Number(rgb[3]).toString(16).padStart(2, '0');
    if (rgb[4] !== undefined) {
      const a = Math.round(Number(rgb[4]) * 255).toString(16).padStart(2, '0');
      return ('#' + r + g + b + a).toLowerCase();
    }
    return ('#' + r + g + b).toLowerCase();
  }
  throw new Error('normalizeColor: unrecognized format "' + input + '"');
}

function normalizeDimension(input) {
  if (typeof input !== 'string') {
    throw new TypeError('normalizeDimension: expected string, got ' + typeof input);
  }
  const trimmed = input.trim();
  const remMatch = /^(-?[\d.]+)rem$/i.exec(trimmed);
  if (remMatch) {
    return Number(remMatch[1]) * 16 + 'px';
  }
  const pxMatch = /^(-?[\d.]+)px$/i.exec(trimmed);
  if (pxMatch) {
    return trimmed.toLowerCase();
  }
  // Unitless (e.g., line-height ratios)
  if (/^-?[\d.]+$/.test(trimmed)) {
    return trimmed;
  }
  // Fallback: pass through
  return trimmed;
}

function shadowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = ['offsetX', 'offsetY', 'blur', 'spread', 'color'];
  for (const k of keys) {
    if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  }
  return true;
}

function valuesMatch(figmaValue, localValue, domain) {
  switch (domain) {
    case 'color':
      try {
        return normalizeColor(figmaValue) === normalizeColor(localValue);
      } catch {
        return false;
      }
    case 'spacing':
    case 'radius':
      return normalizeDimension(figmaValue) === normalizeDimension(localValue);
    case 'typography':
      return normalizeDimension(figmaValue) === normalizeDimension(localValue);
    case 'shadow':
      return shadowEqual(figmaValue, localValue);
    default:
      return figmaValue === localValue;
  }
}

module.exports = { normalizeColor, normalizeDimension, valuesMatch };
```

- [ ] **Step 4: Run tests**

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/value-normalizer.js plugins/adhd/lib/check-engine/__tests__/value-normalizer.test.js
git commit -m "Add value-normalizer with color/dimension/shadow comparison"
```

---

## Task 4: theme-parser.js

Parses `globals.css` and extracts a comparable map. Reuses regex patterns from `lib/to-dtcg/`.

**Files:**
- Create: `plugins/adhd/lib/check-engine/theme-parser.js`
- Test: `plugins/adhd/lib/check-engine/__tests__/theme-parser.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTheme } = require('../theme-parser');

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, '..', '__fixtures__', 'sample-globals.css'),
  'utf8',
);

test('parseTheme returns sections for primitives, exposure, light, dark', () => {
  const theme = parseTheme(FIXTURE);
  assert.ok(theme.primitives, 'has primitives');
  assert.ok(theme.exposure,   'has exposure');
  assert.ok(theme.light,      'has light');
  assert.ok(theme.dark,       'has dark');
});

test('parseTheme captures @theme {} entries as primitives', () => {
  const theme = parseTheme(`
    @theme {
      --color-brand-600: #5e3aee;
      --space-2xl: 2rem;
    }
  `);
  assert.equal(theme.primitives['--color-brand-600'], '#5e3aee');
  assert.equal(theme.primitives['--space-2xl'], '2rem');
});

test('parseTheme captures :root and :root[data-theme="dark"] separately', () => {
  const theme = parseTheme(`
    :root {
      --color-surface-elevated: #ffffff;
    }
    :root[data-theme="dark"] {
      --color-surface-elevated: #1a1a1a;
    }
  `);
  assert.equal(theme.light['--color-surface-elevated'], '#ffffff');
  assert.equal(theme.dark['--color-surface-elevated'],  '#1a1a1a');
});

test('parseTheme captures @theme inline {} entries as exposure', () => {
  const theme = parseTheme(`
    @theme inline {
      --color-button-bg: var(--color-surface-elevated);
    }
  `);
  assert.equal(theme.exposure['--color-button-bg'], 'var(--color-surface-elevated)');
});

test('parseTheme tolerates whitespace, comments, and ordering variations', () => {
  const theme = parseTheme(`
    /* primitives */
    @theme {
      --color-x: red;
    }
    /* exposure */
    @theme inline {  --y: 1px;  }
  `);
  assert.equal(theme.primitives['--color-x'], 'red');
  assert.equal(theme.exposure['--y'], '1px');
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
node --test plugins/adhd/lib/check-engine/__tests__/theme-parser.test.js
```

- [ ] **Step 3: Implement theme-parser.js**

```js
'use strict';

const SECTION_RE = /(@theme\s+inline\s*\{|@theme\s*\{|:root\[data-theme="dark"\]\s*\{|:root\s*\{)/g;
const VAR_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

function parseSection(body) {
  const out = {};
  let match;
  VAR_RE.lastIndex = 0;
  while ((match = VAR_RE.exec(body)) !== null) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

function findSection(css, openRe) {
  const re = new RegExp(openRe.source, 'g');
  const m = re.exec(css);
  if (!m) return '';
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  return css.slice(start, i);
}

function parseTheme(css) {
  return {
    primitives: parseSection(findSection(css, /@theme\s*\{/)),
    exposure:   parseSection(findSection(css, /@theme\s+inline\s*\{/)),
    light:      parseSection(findSection(css, /:root\s*\{/)),
    dark:       parseSection(findSection(css, /:root\[data-theme="dark"\]\s*\{/)),
  };
}

module.exports = { parseTheme };
```

- [ ] **Step 4: Run tests**

Expected: all 5 tests pass. If the fixture-based first test fails because `sample-globals.css` doesn't have all four sections, the implementer should adjust the fixture (it's an example app's real CSS, so all four sections should be present — but if the example evolves, the test may need updating).

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/theme-parser.js plugins/adhd/lib/check-engine/__tests__/theme-parser.test.js
git commit -m "Add theme-parser for globals.css → comparable map"
```

---

## Task 5: variable-categorizer.js

Categorizes Figma variables as missing/same/conflict against the local theme, handling Light/Dark separately.

**Files:**
- Create: `plugins/adhd/lib/check-engine/variable-categorizer.js`
- Test: `plugins/adhd/lib/check-engine/__tests__/variable-categorizer.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { categorizeVariables } = require('../variable-categorizer');

const figmaVars = {
  'Primitives/color/brand/600': '#5e3aee',
  'Primitives/space/2xl': '32px',
  'Semantic/color/surface/elevated': { Light: '#ffffff', Dark: '#1a1a1a' },
};

const localTheme = {
  primitives: {
    '--color-brand-600': '#5e3aee',
    // --space-2xl missing
  },
  exposure: {},
  light: {
    '--color-surface-elevated': '#f5f5f5',  // conflict
  },
  dark: {
    '--color-surface-elevated': '#1a1a1a',  // same
  },
};

test('flags missing variables', () => {
  const violations = categorizeVariables(figmaVars, localTheme);
  const missing = violations.filter(v => v.status === 'missing');
  assert.deepEqual(
    missing.map(v => v.token).sort(),
    ['space/2xl'],
  );
});

test('flags conflicts with both light and dark values', () => {
  const violations = categorizeVariables(figmaVars, localTheme);
  const conflicts = violations.filter(v => v.status === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].token, 'color/surface/elevated');
  assert.equal(conflicts[0].mode, 'light');
  assert.equal(conflicts[0].figma, '#ffffff');
  assert.equal(conflicts[0].local, '#f5f5f5');
});

test('does not emit violations for variables that match', () => {
  const violations = categorizeVariables(figmaVars, localTheme);
  const matches = violations.filter(v => v.token === 'color/brand/600');
  assert.equal(matches.length, 0);
});

test('treats hex case as semantically identical', () => {
  const violations = categorizeVariables(
    { 'Primitives/color/x': '#5E3AEE' },
    { primitives: { '--color-x': '#5e3aee' }, exposure: {}, light: {}, dark: {} },
  );
  assert.equal(violations.length, 0);
});

test('treats rem and px as semantically identical', () => {
  const violations = categorizeVariables(
    { 'Primitives/space/sm': '1rem' },
    { primitives: { '--space-sm': '16px' }, exposure: {}, light: {}, dark: {} },
  );
  assert.equal(violations.length, 0);
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement variable-categorizer.js**

```js
'use strict';

const { figmaToCssVar } = require('./name-normalizer');
const { valuesMatch } = require('./value-normalizer');

function inferDomain(token) {
  if (token.startsWith('color/') || token.includes('/color/')) return 'color';
  if (token.startsWith('space/') || token.includes('/space/')) return 'spacing';
  if (token.startsWith('radius/') || token.includes('/radius/')) return 'radius';
  if (token.startsWith('shadow/') || token.includes('/shadow/')) return 'shadow';
  if (token.startsWith('font/') || token.includes('/font/') ||
      token.includes('text-') || token.includes('line-height')) return 'typography';
  return 'unknown';
}

function strippedToken(figmaPath) {
  // Drop collection prefix; keep the rest as-is for human display.
  const segs = figmaPath.split('/');
  if (segs.length > 1) return segs.slice(1).join('/');
  return figmaPath;
}

function lookupLocal(theme, cssVar, mode) {
  // For semantic tokens with modes, look in light/dark; else look in primitives or exposure.
  if (mode === 'light') return theme.light?.[cssVar];
  if (mode === 'dark')  return theme.dark?.[cssVar];
  return theme.primitives?.[cssVar] ?? theme.exposure?.[cssVar];
}

function compareOne(figmaPath, figmaValue, theme, mode) {
  const cssVar = figmaToCssVar(figmaPath);
  const token = strippedToken(figmaPath);
  const domain = inferDomain(token);
  const localValue = lookupLocal(theme, cssVar, mode);

  if (localValue === undefined || localValue === null) {
    return { token, status: 'missing', figma: figmaValue, local: null, mode, domain };
  }
  if (valuesMatch(figmaValue, localValue, domain)) {
    return null; // same, no violation
  }
  return { token, status: 'conflict', figma: figmaValue, local: localValue, mode, domain };
}

function categorizeVariables(figmaVars, theme) {
  const out = [];
  for (const [figmaPath, value] of Object.entries(figmaVars)) {
    if (value && typeof value === 'object' && ('Light' in value || 'Dark' in value)) {
      // Semantic with modes
      if ('Light' in value) {
        const v = compareOne(figmaPath, value.Light, theme, 'light');
        if (v) out.push(v);
      }
      if ('Dark' in value) {
        const v = compareOne(figmaPath, value.Dark, theme, 'dark');
        if (v) out.push(v);
      }
    } else {
      // Primitive (no modes)
      const v = compareOne(figmaPath, value, theme, undefined);
      if (v) out.push(v);
    }
  }
  return out;
}

module.exports = { categorizeVariables };
```

- [ ] **Step 4: Run tests**

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/variable-categorizer.js plugins/adhd/lib/check-engine/__tests__/variable-categorizer.test.js
git commit -m "Add variable-categorizer with Light/Dark mode support"
```

---

## Task 6: structure-checker.js

Implements STRUCT001–STRUCT010 against the MCP `get_design_context` response.

**Note for implementer:** This task depends on the fixture captured in Task 0. The exact field names used below (`layoutMode`, `boundVariables`, `componentPropertyDefinitions`, etc.) are best-guess based on the Figma plugin/REST API; verify against your captured fixture and adjust if needed. If a field name differs, update the rule's detection logic but keep the same rule ID and severity.

**Files:**
- Create: `plugins/adhd/lib/check-engine/structure-checker.js`
- Test: `plugins/adhd/lib/check-engine/__tests__/structure-checker.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkStructure } = require('../structure-checker');

const FIGMA_FILE_KEY = 'abc123';

function makeFrame(overrides = {}) {
  return {
    id: '1:1',
    name: 'Card',
    type: 'FRAME',
    layoutMode: 'VERTICAL',
    children: [],
    fills: [],
    ...overrides,
  };
}

test('STRUCT001: flags a frame with children but no auto-layout', () => {
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [{ id: '1:2', name: 'Child', type: 'FRAME' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT001'));
});

test('STRUCT001: does not flag a frame with no children even if layoutMode is NONE', () => {
  const node = makeFrame({ layoutMode: 'NONE', children: [] });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT001').length, 0);
});

test('STRUCT003: flags a fill with raw hex (no boundVariables)', () => {
  const node = makeFrame({
    fills: [{ type: 'SOLID', color: { r: 0.37, g: 0.23, b: 0.93 } }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT003'));
});

test('STRUCT003: does not flag a fill that has boundVariables.color', () => {
  const node = makeFrame({
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:1' } } }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT003').length, 0);
});

test('STRUCT008: flags auto-named layers like "Frame 47"', () => {
  const node = makeFrame({
    children: [{ id: '1:2', name: 'Frame 47', type: 'FRAME' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT008'));
});

test('STRUCT010: flags a Component Set with children that have empty variantProperties', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {},
    children: [
      { id: '1:2', name: 'Variant 1', type: 'COMPONENT', variantProperties: {} },
      { id: '1:3', name: 'Variant 2', type: 'COMPONENT', variantProperties: {} },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT010'));
});

test('STRUCT010: does not flag a Component Set with declared variant properties', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      variant: { type: 'VARIANT', defaultValue: 'primary', variantOptions: ['primary', 'secondary'] },
    },
    children: [
      { id: '1:2', name: 'Button/primary', type: 'COMPONENT', variantProperties: { variant: 'primary' } },
      { id: '1:3', name: 'Button/secondary', type: 'COMPONENT', variantProperties: { variant: 'secondary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT010').length, 0);
});

test('STRUCT009: flags PascalCase variant property values when convention is kebab-case', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      variant: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary', 'Secondary'] },
    },
    children: [
      { id: '1:2', name: 'Button/Primary', type: 'COMPONENT', variantProperties: { variant: 'Primary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT009'));
});

test('STRUCT009: passes when convention is set to false (disabled)', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      variant: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary'] },
    },
    children: [
      { id: '1:2', name: 'Button/Primary', type: 'COMPONENT', variantProperties: { variant: 'Primary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: false });
  assert.equal(violations.filter(v => v.rule === 'STRUCT009').length, 0);
});

test('every violation has rule, severity, nodeId, nodePath, message, deepLink', () => {
  const node = makeFrame({ layoutMode: 'NONE', children: [{ id: '1:2', name: 'Frame 47', type: 'FRAME' }] });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  for (const v of violations) {
    assert.ok(v.rule, 'rule');
    assert.ok(v.severity === 'error' || v.severity === 'warning', 'severity');
    assert.ok(v.nodeId, 'nodeId');
    assert.ok(v.nodePath, 'nodePath');
    assert.ok(v.message, 'message');
    assert.match(v.deepLink, /figma\.com\/design\/abc123\?node-id=/);
  }
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement structure-checker.js**

```js
'use strict';

const AUTO_NAME_RE = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Star|Polygon)\s+\d+$/;

function deepLink(fileKey, nodeId) {
  return 'https://figma.com/design/' + fileKey + '?node-id=' + nodeId.replace(':', '-');
}

function caseMatches(name, convention) {
  if (convention === false) return true;
  if (convention === 'kebab-case')   return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || /^[a-z0-9-/.]+$/.test(name);
  if (convention === 'PascalCase')   return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  if (convention === 'camelCase')    return /^[a-z][a-zA-Z0-9]*$/.test(name);
  return true;
}

function visit(node, ctx, parentPath) {
  const nodePath = parentPath ? parentPath + ' > ' + node.name : node.name;
  ctx.violations = ctx.violations || [];
  const push = (rule, severity, message) => {
    ctx.violations.push({
      rule,
      severity,
      nodeId: node.id,
      nodePath,
      message,
      deepLink: deepLink(ctx.fileKey, node.id),
    });
  };

  // STRUCT001: auto-layout required
  if ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
      Array.isArray(node.children) && node.children.length > 0 &&
      node.layoutMode === 'NONE') {
    push('STRUCT001', 'error', 'Frame has children but auto-layout is not enabled.');
  }

  // STRUCT002: spacing uses variables
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'];
    for (const field of spacingFields) {
      const v = node[field];
      const bound = node.boundVariables && node.boundVariables[field];
      if (typeof v === 'number' && v > 0 && !bound) {
        push('STRUCT002', 'error', `${field} is a raw value (${v}px); use a spacing variable.`);
      }
    }
  }

  // STRUCT003: colors use variables
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'SOLID' && !fill.boundVariables?.color) {
        push('STRUCT003', 'error', 'Fill is a raw color; use a color variable.');
        break;
      }
    }
  }
  if (Array.isArray(node.strokes)) {
    for (const stroke of node.strokes) {
      if (stroke.type === 'SOLID' && !stroke.boundVariables?.color) {
        push('STRUCT003', 'error', 'Stroke is a raw color; use a color variable.');
        break;
      }
    }
  }

  // STRUCT004: typography uses variables/styles
  if (node.type === 'TEXT' && node.style) {
    const hasStyleId = node.textStyleId || node.styles?.text;
    const hasBound = node.boundVariables && (
      node.boundVariables.fontSize || node.boundVariables.lineHeight || node.boundVariables.fontWeight
    );
    if (!hasStyleId && !hasBound) {
      push('STRUCT004', 'error', 'Text uses raw typography; bind a text style or typography variable.');
    }
  }

  // STRUCT005: effects use variables/styles
  if (Array.isArray(node.effects) && node.effects.length > 0) {
    const allBound = node.effects.every(e => e.boundVariables || node.effectStyleId);
    if (!allBound) {
      push('STRUCT005', 'error', 'Effects include raw values; bind effect styles or shadow variables.');
    }
  }

  // STRUCT006: no detached instances
  if (node.type === 'FRAME' && node.wasInstance === true) {
    push('STRUCT006', 'warning', 'Layer was previously an instance; was detached from its master.');
  }

  // STRUCT008: meaningful layer names
  if (AUTO_NAME_RE.test(node.name)) {
    push('STRUCT008', 'warning', `Layer is auto-named ("${node.name}"); rename for clarity.`);
  }

  // STRUCT009: naming convention (component, variant prop names, variant prop values)
  if (node.type === 'COMPONENT_SET' && node.componentPropertyDefinitions) {
    for (const propName of Object.keys(node.componentPropertyDefinitions)) {
      if (!caseMatches(propName, ctx.namingConvention)) {
        push('STRUCT009', 'warning',
          `Variant property "${propName}" doesn't match ${ctx.namingConvention} convention.`);
      }
      const def = node.componentPropertyDefinitions[propName];
      if (def.variantOptions) {
        for (const val of def.variantOptions) {
          if (!caseMatches(val, ctx.namingConvention)) {
            push('STRUCT009', 'warning',
              `Variant value "${val}" of property "${propName}" doesn't match ${ctx.namingConvention} convention.`);
          }
        }
      }
    }
  }
  // Component name itself (just the base, before "/")
  if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !parentPath?.includes(' > '))) {
    const base = node.name.split('/')[0];
    if (!caseMatches(base, ctx.namingConvention)) {
      push('STRUCT009', 'warning',
        `Component name "${base}" doesn't match ${ctx.namingConvention} convention.`);
    }
  }

  // STRUCT010: variant properties declared
  if (node.type === 'COMPONENT_SET' && Array.isArray(node.children) && node.children.length > 0) {
    const hasDefs = node.componentPropertyDefinitions &&
      Object.keys(node.componentPropertyDefinitions).length > 0;
    const allChildrenEmpty = node.children.every(
      c => c.type === 'COMPONENT' && (!c.variantProperties || Object.keys(c.variantProperties).length === 0),
    );
    if (!hasDefs && allChildrenEmpty) {
      push('STRUCT010', 'error',
        'Component Set has no variant properties declared. Define variant axes (size, state, etc.).');
    }
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visit(child, ctx, nodePath);
    }
  }
}

function checkStructure(rootNode, opts) {
  const ctx = {
    fileKey: opts.fileKey,
    namingConvention: opts.namingConvention ?? 'kebab-case',
    violations: [],
  };
  visit(rootNode, ctx, '');
  return ctx.violations;
}

module.exports = { checkStructure };
```

- [ ] **Step 4: Run tests**

Expected: all 9 tests pass. If a test fails because the fixture's actual MCP shape differs from what the test assumes, **adjust the test to match real shape and re-run** rather than weakening the rule.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/structure-checker.js plugins/adhd/lib/check-engine/__tests__/structure-checker.test.js
git commit -m "Add structure-checker for STRUCT001-010 rule evaluation"
```

---

## Task 7: report-formatter.js

Produces the markdown report (paste-ready into Figma comments / Slack / GitHub).

**Files:**
- Create: `plugins/adhd/lib/check-engine/report-formatter.js`
- Test: `plugins/adhd/lib/check-engine/__tests__/report-formatter.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReport } = require('../report-formatter');

const VIOLATIONS = {
  variable: [
    { token: 'color/brand/600', status: 'missing', figma: '#5e3aee', local: null,
      deepLink: 'https://figma.com/design/abc?node-id=1-1' },
    { token: 'color/surface/elevated', status: 'conflict', figma: '#ffffff', local: '#f5f5f5',
      mode: 'light',
      deepLink: 'https://figma.com/design/abc?node-id=1-2' },
  ],
  structure: [
    { rule: 'STRUCT001', severity: 'error', nodeId: '1:3', nodePath: 'Card > Container',
      message: 'Frame has children but auto-layout is not enabled.',
      deepLink: 'https://figma.com/design/abc?node-id=1-3' },
    { rule: 'STRUCT008', severity: 'warning', nodeId: '1:4', nodePath: 'Card > Frame 47',
      message: 'Layer is auto-named.',
      deepLink: 'https://figma.com/design/abc?node-id=1-4' },
  ],
};

const META = {
  target: 'Page 1 / Card',
  targetUrl: 'https://figma.com/design/abc?node-id=1-1',
  runAt: new Date('2026-05-10T14:23:00Z'),
};

test('report includes target, run time, and total counts', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /\*\*Target:\*\* Page 1 \/ Card/);
  assert.match(md, /\*\*Run at:\*\* 2026-05-10/);
  assert.match(md, /\*\*Result:\*\* 1 errors, 1 warnings/);
});

test('report groups variable issues into Missing and Conflicts subsections', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /## Variable issues \(2\)/);
  assert.match(md, /### Missing locally \(1\)/);
  assert.match(md, /### Conflicts \(1\)/);
});

test('report shows conflict mode label and both values', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /color\/surface\/elevated.*\(light\)/i);
  assert.match(md, /local: `#f5f5f5`/);
  assert.match(md, /figma: `#ffffff`/);
});

test('report groups structure issues into Errors and Warnings subsections', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /## Structure issues \(2\)/);
  assert.match(md, /### Errors \(1\)/);
  assert.match(md, /### Warnings \(1\)/);
});

test('report includes deep links for every violation', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /\[open\]\(https:\/\/figma\.com\/design\/abc\?node-id=1-1\)/);
  assert.match(md, /\[open\]\(https:\/\/figma\.com\/design\/abc\?node-id=1-3\)/);
});

test('report handles zero violations gracefully', () => {
  const md = formatReport({ variable: [], structure: [] }, META);
  assert.match(md, /No violations found/);
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement report-formatter.js**

```js
'use strict';

function fmtTime(d) {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatReport({ variable = [], structure = [] }, meta) {
  const errors = structure.filter(v => v.severity === 'error').length + variable.length;
  const warnings = structure.filter(v => v.severity === 'warning').length;
  const lines = [];

  lines.push('# ADHD check report');
  lines.push(`**Target:** ${meta.target}  ([open in Figma](${meta.targetUrl}))`);
  lines.push(`**Run at:** ${fmtTime(meta.runAt)}`);
  lines.push(`**Result:** ${errors} errors, ${warnings} warnings`);
  lines.push('');

  if (variable.length === 0 && structure.length === 0) {
    lines.push('No violations found.');
    return lines.join('\n');
  }

  if (variable.length > 0) {
    lines.push(`## Variable issues (${variable.length})`);
    lines.push('');
    const missing = variable.filter(v => v.status === 'missing');
    const conflicts = variable.filter(v => v.status === 'conflict');
    if (missing.length > 0) {
      lines.push(`### Missing locally (${missing.length})`);
      for (const m of missing) {
        const v = typeof m.figma === 'object' ? JSON.stringify(m.figma) : m.figma;
        lines.push(`- \`${m.token}\` → \`${v}\` ([open](${m.deepLink}))`);
      }
      lines.push('');
    }
    if (conflicts.length > 0) {
      lines.push(`### Conflicts (${conflicts.length})`);
      for (const c of conflicts) {
        const modeLabel = c.mode ? ` (${c.mode})` : '';
        const localStr = typeof c.local === 'object' ? JSON.stringify(c.local) : c.local;
        const figmaStr = typeof c.figma === 'object' ? JSON.stringify(c.figma) : c.figma;
        lines.push(`- \`${c.token}\`${modeLabel}`);
        lines.push(`  - local: \`${localStr}\``);
        lines.push(`  - figma: \`${figmaStr}\``);
        lines.push(`  - [open in Figma](${c.deepLink})`);
      }
      lines.push('');
    }
  }

  if (structure.length > 0) {
    lines.push(`## Structure issues (${structure.length})`);
    lines.push('');
    const errs = structure.filter(v => v.severity === 'error');
    const warns = structure.filter(v => v.severity === 'warning');
    if (errs.length > 0) {
      lines.push(`### Errors (${errs.length})`);
      for (const e of errs) {
        lines.push(`- **${e.rule}** — ${e.message}`);
        lines.push(`  ${e.nodePath} — [open](${e.deepLink})`);
      }
      lines.push('');
    }
    if (warns.length > 0) {
      lines.push(`### Warnings (${warns.length})`);
      for (const w of warns) {
        lines.push(`- **${w.rule}** — ${w.message}`);
        lines.push(`  ${w.nodePath} — [open](${w.deepLink})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = { formatReport };
```

- [ ] **Step 4: Run tests**

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/report-formatter.js plugins/adhd/lib/check-engine/__tests__/report-formatter.test.js
git commit -m "Add report-formatter for paste-ready markdown output"
```

---

## Task 8: cli.js — orchestrator

Wires up all the pieces into the runnable CLI.

**Files:**
- Modify: `plugins/adhd/lib/check-engine/cli.js`
- Test: `plugins/adhd/lib/check-engine/__tests__/cli.test.js`

- [ ] **Step 1: Extend the CLI test**

Replace the contents of `plugins/adhd/lib/check-engine/__tests__/cli.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');
const FIXTURES = path.resolve(__dirname, '..', '__fixtures__');

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

test('cli runs end-to-end on synthetic inputs and writes a report', () => {
  const varDefs = tmp('vars.json', { 'Primitives/color/brand/600': '#5e3aee' });
  const ctx = tmp('ctx.json', {
    id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL',
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'X' } } }],
  });
  const cssPath = tmp('globals.css', `
    @theme { --color-brand-600: #5e3aee; }
    :root { }
    :root[data-theme="dark"] { }
  `);
  const configPath = tmp('adhd.config.ts', `
    export default { figma: { url: 'https://figma.com/design/abc/Test' }, naming: 'kebab-case' };
  `);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, 'exit 0 (no errors): stderr=' + result.stderr);
  const report = fs.readFileSync(reportPath, 'utf8');
  assert.match(report, /No violations found/);

  // stdout should be JSON summary
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.errors, 0);
  assert.equal(summary.warnings, 0);
});

test('cli exits 1 when variable conflicts exist', () => {
  const varDefs = tmp('vars.json', { 'Primitives/color/brand/600': '#5e3aee' });
  const ctx = tmp('ctx.json', { id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme { --color-brand-600: #000000; } :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1);
});
```

- [ ] **Step 2: Run the test, confirm failure**

```bash
node --test plugins/adhd/lib/check-engine/__tests__/cli.test.js
```

- [ ] **Step 3: Implement cli.js**

Overwrite `plugins/adhd/lib/check-engine/cli.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseTheme } = require('./theme-parser');
const { categorizeVariables } = require('./variable-categorizer');
const { checkStructure } = require('./structure-checker');
const { formatReport } = require('./report-formatter');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js --variable-defs <path> --design-context <path> --globals-css <path> \\
         --config <path> --target <label> --target-url <url> --output <path>

Reads pre-fetched MCP responses + globals.css and writes a markdown
violation report. Stdout is a JSON summary. Exit 0 = no errors, 1 = errors.`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function extractFileKey(url) {
  const m = /design\/([^/?]+)/.exec(url);
  return m ? m[1] : 'unknown';
}

function readNamingConvention(configPath) {
  // Minimal parse: look for `naming: <value>` in the file. False / kebab-case / PascalCase / camelCase.
  const src = fs.readFileSync(configPath, 'utf8');
  const m = /naming\s*:\s*(false|"[^"]+"|'[^']+')/.exec(src);
  if (!m) return 'kebab-case';
  if (m[1] === 'false') return false;
  return m[1].slice(1, -1);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }

  const required = ['variable-defs', 'design-context', 'globals-css', 'config', 'target', 'target-url', 'output'];
  for (const r of required) {
    if (!args[r]) { console.error(`Missing --${r}`); process.exit(2); }
  }

  const varDefs = readJson(args['variable-defs']);
  const designCtx = readJson(args['design-context']);
  const cssText = fs.readFileSync(args['globals-css'], 'utf8');
  const namingConvention = readNamingConvention(args['config']);
  const fileKey = extractFileKey(args['target-url']);

  const theme = parseTheme(cssText);
  const variableViolations = categorizeVariables(varDefs, theme);
  const structureViolations = checkStructure(designCtx, { fileKey, namingConvention });

  const meta = {
    target: args.target,
    targetUrl: args['target-url'],
    runAt: new Date(),
  };
  const report = formatReport(
    { variable: variableViolations, structure: structureViolations },
    meta,
  );
  fs.writeFileSync(args.output, report);

  const errors = structureViolations.filter(v => v.severity === 'error').length + variableViolations.length;
  const warnings = structureViolations.filter(v => v.severity === 'warning').length;
  process.stdout.write(JSON.stringify({
    errors,
    warnings,
    variable: variableViolations,
    structure: structureViolations,
    reportPath: args.output,
  }));

  process.exit(errors > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 4: Run all check-engine tests**

```bash
node --test plugins/adhd/lib/check-engine/__tests__/
```

Expected: every test passes (cli + 6 module tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/check-engine/cli.js plugins/adhd/lib/check-engine/__tests__/cli.test.js
git commit -m "Wire up check-engine CLI orchestrator"
```

---

## Task 9: /adhd:check skill

User-invocable skill that orchestrates MCP fetches and runs the CLI.

**Files:**
- Create: `plugins/adhd/skills/check/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
description: "Validate a Figma frame, component, component set, or page against the local Tailwind theme + frame-structure best practices. Reads adhd.config.ts at the repo root. Read-only — no writes. Optional argument: a Figma URL with node-id. If no argument, uses the current Figma selection."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>]"
allowed-tools: Read Bash mcp__figma__get_metadata mcp__figma__get_variable_defs mcp__figma__get_design_context
---

# ADHD Check

Validate that a Figma frame/page is ready for code translation. Reports two classes of issue:

- **Variable issues** — Figma variables used by the frame that are missing locally or have conflicting values.
- **Structure issues** — STRUCT001–STRUCT010 best-practice violations (auto-layout, naming, variant properties, etc.).

Output: a markdown report saved to `adhd-check-report.md` (gitignored), plus a terminal echo. The report is paste-ready for sharing with designers via Figma comments, Slack, or GitHub issues.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-check-and-sync-design.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root. If it doesn't exist, abort with: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `naming` (optional, defaults to `kebab-case`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 2: Resolve target node

Parse `$ARGUMENTS`:

- If a Figma URL is provided:
  - Extract the file key (segment after `/design/`).
  - If it doesn't match the file key from `adhd.config.ts`, abort with: "URL points at file <X>, but adhd.config.ts is configured for file <Y>. Pass a URL from the configured file or run /adhd:config to update."
  - Extract the node ID from `?node-id=<id>` (note: URLs use `-` separator; MCP wants `:` — convert by replacing the first `-` with `:`).
- If no URL is provided: use MCP's current selection (call MCP tools without a `nodeId` argument).

Call `mcp__figma__get_metadata` with the node ID (or no arg for selection). Confirm:
- Node type is `FRAME`, `COMPONENT`, `COMPONENT_SET`, or `CANVAS` (page). Otherwise abort with: "Select a frame, component, or page (got: <type>)."
- Capture the node's name and ID for the report.

If `get_metadata` errors with "Node not found", abort with: "Node not found in <fileKey>. Verify the URL or selection."
If it errors with "MCP unreachable" / similar, abort with: "Figma MCP not configured. Run /adhd:config to verify setup."

## Phase 3: Fetch from MCP

Call `mcp__figma__get_variable_defs` with the resolved node ID.
Call `mcp__figma__get_design_context` with the resolved node ID.

If either response is empty or has a `truncated: true` flag (or equivalent), surface a warning: "MCP returned a partial response — consider running on a smaller scope (a frame within the page)." Continue with what you have.

Use the `Bash` tool to write each response to a temp file:

```bash
mkdir -p /tmp/adhd
echo '<get_variable_defs response JSON>' > /tmp/adhd/vars.json
echo '<get_design_context response JSON>' > /tmp/adhd/ctx.json
```

## Phase 4: Run the engine

Use the `Bash` tool:

```bash
node plugins/adhd/lib/check-engine/cli.js \
  --variable-defs /tmp/adhd/vars.json \
  --design-context /tmp/adhd/ctx.json \
  --globals-css <path-from-config-or-auto-detect> \
  --config adhd.config.ts \
  --target "<node-name-from-Phase-2>" \
  --target-url "https://figma.com/design/<fileKey>?node-id=<nodeId-with-hyphen>" \
  --output adhd-check-report.md
```

Globals path resolution: if `adhd.config.ts` has `cssEntry`, use it. Otherwise auto-detect `app/globals.css` then `src/app/globals.css` (matching `/adhd:config`'s logic).

## Phase 5: Present results

Read `adhd-check-report.md` with the `Read` tool and echo it to the user verbatim. Then summarize:

- If exit code 0 and zero violations: "✓ No issues found."
- If exit code 0 with warnings only: "⚠ N warnings (see report). Frame is ready for code translation."
- If exit code 1: "✗ N errors, M warnings. Frame has issues that should be resolved before code translation."

Mention the report file path: "Full report: `adhd-check-report.md` (paste-ready for Figma comments / Slack)."

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `URL points at wrong file` | Open the configured Figma file (printed in error) and copy a node URL from there. |
| `Select a frame, component, or page` | Click on a frame in Figma desktop, or pass a node-id URL. |
| `MCP unreachable` | Make sure Figma desktop is running with Dev Mode enabled. Re-run `/adhd:config`. |
```

- [ ] **Step 2: Validate frontmatter**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: 5/5 skills valid (config, seed, sync, check, to-dtcg).

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/check/SKILL.md
git commit -m "Add /adhd:check skill"
```

---

## Task 10: refactor /adhd:sync skill

Refactor the existing `/adhd:sync` to:
1. Use the same frame-scoped input (selection or URL).
2. Run the check engine first.
3. Apply variable writes via the existing `lib/to-dtcg/` writer (or a small helper that wraps it).
4. Per-conflict prompt with `[a]ll-figma` / `[k]eep-all` shortcuts.
5. Per-domain commit pattern (preserved from existing).

**Files:**
- Modify: `plugins/adhd/skills/sync/SKILL.md` (full rewrite — most of the existing content is obsolete given the new architecture)

- [ ] **Step 1: Rewrite SKILL.md**

```markdown
---
description: "Sync design tokens from a Figma frame, component, component set, or page into this repo's globals.css. Runs the same checks as /adhd:check, then writes Figma's variable values into globals.css with per-conflict prompts. Optional argument: a Figma URL with node-id. If no argument, uses the current Figma selection."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>]"
allowed-tools: Read Edit Write Bash AskUserQuestion mcp__figma__get_metadata mcp__figma__get_variable_defs mcp__figma__get_design_context
---

# ADHD Sync

Frame-scoped variable sync from Figma → code. Pulls the values of variables referenced by the target Figma frame and writes them into `globals.css`. Auto-applies missing variables; prompts per-conflict when local has a different value.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-check-and-sync-design.md`

## Phase 1: Validate config (same as /adhd:check)

Read `adhd.config.ts`. If missing, abort: "Run /adhd:config first."
Extract `figma.url`, `naming` (default `kebab-case`), and `cssEntry` (or auto-detect).

## Phase 2: Resolve target node (same as /adhd:check)

Parse `$ARGUMENTS` for a Figma URL or use current selection. Validate file-key match. Call `mcp__figma__get_metadata` to confirm node exists and is the right type (FRAME / COMPONENT / COMPONENT_SET / CANVAS). Same error messages as /adhd:check.

## Phase 3: Fetch from MCP (same as /adhd:check)

Call `get_variable_defs` and `get_design_context` for the node. Write to `/tmp/adhd/vars.json` and `/tmp/adhd/ctx.json`.

## Phase 4: Run the engine

Same CLI invocation as /adhd:check, writing the report to `adhd-check-report.md`. Capture stdout (JSON summary).

## Phase 5: Handle structure issues

Parse the JSON summary's `structure` array.

If any structure violations have `severity: "error"`:
1. Echo the structure section of the report to the user.
2. Use `AskUserQuestion`:
   - Question: "N structure errors found. Proceed with variable sync anyway?"
   - Options: "Proceed — sync variables despite structure errors" / "Abort — fix structure issues in Figma first"
3. If user picks Abort: print "Sync aborted. See adhd-check-report.md for details." and exit.

If only structure warnings (no errors): print them as a heads-up but continue without prompting.

## Phase 6: Apply missing variables

Parse the JSON summary's `variable` array.

For variables with `status: "missing"`: print one consolidated message:
```
+ Adding 3 missing variables: color/brand/600, space/2xl, radius/pill
```

Apply each by editing `globals.css`:
- Primitives (no `mode` field) → add to the `@theme {}` block.
- Light-mode missing → add to `:root {}` block.
- Dark-mode missing → add to `:root[data-theme="dark"] {}` block.

Use the `Edit` tool to insert the new declarations. Maintain alphabetical ordering within each block when possible.

## Phase 7: Apply conflicts (per-conflict prompt)

For variables with `status: "conflict"`, iterate. Use `AskUserQuestion` once per conflict:

- Question: `<token> (<mode>): local=<localValue>, figma=<figmaValue> — what should happen?`
- Options:
  - "Keep local"
  - "Overwrite with Figma"
  - "Take Figma for ALL remaining conflicts"
  - "Keep local for ALL remaining conflicts"

If user picks one of the "ALL remaining" options, stop prompting and apply the choice to every remaining conflict in this batch.

For each "Overwrite with Figma" choice (single or batched), use the `Edit` tool to replace the variable's value in the appropriate block (`@theme {}` / `:root {}` / `:root[data-theme="dark"] {}`).

## Phase 8: Commit per domain

After all writes, group changes by domain (color, spacing, radius, typography, shadow). For each domain that received writes, create a commit:

```bash
git add <path-to-globals.css>
git commit -m "ADHD sync: <domain> (<count> changes)"
```

If multiple domains were touched, this produces multiple commits. If none were touched (user kept everything local), no commit.

## Phase 9: Final report

Update `adhd-check-report.md` with a "Sync result" section listing:
- Variables added (with token + value)
- Variables overwritten (with old + new value)
- Variables kept (with local + figma values, "no change")
- Structure issues (unchanged from Phase 4 report — purely informational)

Echo the sync-result section to the user. Print: "Sync complete. <N> changes across <M> domains. Full report: adhd-check-report.md."

## Common errors

(Same table as /adhd:check, plus:)

| Error | Fix-up guidance |
|---|---|
| `Edit failed: variable not found in target block` | The variable was expected in `@theme {}` (etc.) but the block doesn't have it. Re-run `/adhd:check` to confirm classification, then file an issue if the engine is wrong. |
| `git commit failed: nothing to commit` | All conflicts were resolved as "keep local"; no writes were made. Not an error. |
```

- [ ] **Step 2: Validate frontmatter**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: still 5/5 valid.

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/sync/SKILL.md
git commit -m "Refactor /adhd:sync to frame-scoped engine + per-conflict prompts"
```

---

## Task 11: /adhd:config wizard adds naming question

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md`

- [ ] **Step 1: Add the new question to the wizard**

The existing wizard has phases (0–5). The naming question fits between the domain question and the file URL question (or wherever feels right in the existing flow). Read the current SKILL.md to find the right insertion point. The new question:

```markdown
### Phase X: Naming convention

Ask via `AskUserQuestion`:

- Question: "What naming convention does your Figma file use for components, variant properties, and variant values?"
- Options:
  - "kebab-case (default — recommended for design systems)"
  - "PascalCase"
  - "camelCase"
  - "Disable check (false)"

Save the answer to a local variable for the write phase. Map the user's choice to the config value:

| User choice | Value to write |
|---|---|
| kebab-case | `"kebab-case"` |
| PascalCase | `"PascalCase"` |
| camelCase | `"camelCase"` |
| Disable check | `false` |
```

- [ ] **Step 2: Update the write phase template**

In the phase that writes `adhd.config.ts`, add the `naming` field after `figma`. Update the example block in the SKILL to match this output:

```ts
const config = {
  figma: {
    url: "<from earlier phase>",
  },
  naming: "kebab-case",  // or whatever the user chose
  // optional: domains
  // optional: cssEntry
};

export default config;
```

If the user chose "Disable check", write `naming: false` instead.

- [ ] **Step 3: Update the schema reference section in the SKILL**

If the SKILL has a "Schema" section listing valid fields, add `naming` to it with the type `"kebab-case" | "PascalCase" | "camelCase" | false` (default: `"kebab-case"`).

- [ ] **Step 4: Validate frontmatter**

```bash
node scripts/validate-skill-frontmatter.js
```

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add naming convention question to /adhd:config wizard"
```

---

## Task 12: Hygiene — README, gitignore, marketplace metadata

**Files:**
- Modify: `README.md`
- Modify: `example/.gitignore`
- Modify: `.claude-plugin/marketplace.json` (only if needed; marketplace doesn't list individual skills)

- [ ] **Step 1: Update README.md command table**

Find the command table near the top of `README.md`. Replace it with:

```markdown
| Command | Direction | What it does |
|---|---|---|
| `/adhd:config` | — | Interactive wizard that produces `adhd.config.ts` |
| `/adhd:check` | read-only | Validates a Figma frame/page against local theme + structure best-practices |
| `/adhd:sync` | Figma → code | Pulls Figma values for the variables a frame uses into `globals.css` |
| `/adhd:seed` | code → Figma | Generates a DTCG JSON file you import into Figma via TokensBrücke |
| `/adhd:to-dtcg` | utility | Model-invocable converter wrapped by the user-facing skills |
```

(Note: this assumes the precondition rename of `export-for-figma` → `seed` has already landed. If not, this row should still say `/adhd:export-for-figma`.)

- [ ] **Step 2: Add the report file to example/.gitignore**

Edit `example/.gitignore`. Find the line `adhd-export-for-figma.json` (or `adhd-seed.json` post-rename) and add a sibling line:

```
adhd-check-report.md
```

- [ ] **Step 3: Verify marketplace.json**

Read `.claude-plugin/marketplace.json`. The plugin entry doesn't enumerate individual skills (Claude Code auto-discovers them from `plugins/adhd/skills/`). No change needed unless the description should be updated. If you want to update the description to mention the new commands:

```json
{
  "name": "adhd",
  "source": "./plugins/adhd",
  "description": "Validate, sync, and seed design tokens between Tailwind v4 and Figma."
}
```

- [ ] **Step 4: Run all tests + validation**

```bash
node --test plugins/adhd/lib/to-dtcg/__tests__/ plugins/adhd/lib/check-engine/__tests__/
node scripts/validate-skill-frontmatter.js
```

Expected: all to-dtcg tests pass (62), all check-engine tests pass (count varies by tasks completed), 5/5 skills valid.

- [ ] **Step 5: Commit**

```bash
git add README.md example/.gitignore .claude-plugin/marketplace.json
git commit -m "Update README, gitignore, marketplace metadata for /adhd:check + /adhd:sync"
```

---

## Task 13: End-to-end manual smoke test

The unit tests cover the engine. This task verifies the skills actually work end-to-end against a real Figma file.

- [ ] **Step 1: Run /adhd:check against a known-good frame**

In a Claude session in `example/`:

```
/adhd:check https://figma.com/design/<configured-file>?node-id=<known-good-frame>
```

Expected:
- Skill resolves the node, fetches MCP data, runs CLI, produces `adhd-check-report.md`.
- Report has 0 errors (the example app is set up to be clean).
- Exit code 0.

- [ ] **Step 2: Run /adhd:check against a known-bad frame**

Either modify a frame in Figma to violate a rule (e.g., remove auto-layout, paste a raw hex fill), or use a known-bad fixture frame.

```
/adhd:check https://figma.com/design/<configured-file>?node-id=<known-bad-frame>
```

Expected:
- Report lists each violation with rule ID, message, deep-link.
- Exit code 1 if any errors.

- [ ] **Step 3: Run /adhd:sync — clean case**

Pick a frame whose variables are already all in `globals.css` with matching values.

```
/adhd:sync https://figma.com/design/<configured-file>?node-id=<id>
```

Expected:
- Report says 0 changes.
- No git commit.

- [ ] **Step 4: Run /adhd:sync — missing variables**

Pick a frame that references a variable not in `globals.css`. Run sync.

Expected:
- Skill prints "+ Adding 1 missing variable: <token>".
- `globals.css` is edited.
- One commit lands: "ADHD sync: <domain> (1 change)".

- [ ] **Step 5: Run /adhd:sync — conflict prompts**

Edit `globals.css` to give a variable a different value than Figma. Run sync.

Expected:
- Skill prompts per conflict with the four options (Keep / Overwrite / All-figma / Keep-all).
- User's choice is applied.

- [ ] **Step 6: Confirm CI passes on the branch**

Push the branch, open a PR, watch CI:

```bash
gh pr create --title "..." --body "..."
gh pr checks <num> --watch
```

Expected: `to-dtcg unit tests`, `project hygiene` (which now also runs check-engine tests via the same `npm test` or equivalent), and skill frontmatter validator all pass.

> If `package.json`'s test script doesn't run check-engine tests, update it (see Task 12 follow-up — may need a `package.json` change to add `node --test plugins/adhd/lib/check-engine/__tests__/` to the test script, OR update the CI workflow to run both directories explicitly).

- [ ] **Step 7: No commit needed** — this task is verification only.

---

## Self-review checklist (run before declaring done)

- [ ] Spec coverage: every section of the spec maps to a task. Notable mappings:
  - Spec §Architecture → Task 1 (scaffolding) + Tasks 2–8 (engine modules)
  - Spec §Input handling → Tasks 9–10 (Phase 2 in both skills)
  - Spec §Variable check algorithm → Tasks 4 (parser), 5 (categorizer)
  - Spec §Structure check rules → Task 6 (all 10 rules implemented)
  - Spec §Sync write path → Task 10 (Phases 5–8)
  - Spec §Report output → Task 7 + Task 8 (CLI integration)
  - Spec §Config additions → Task 11 (naming question + schema)
  - Spec §Edge cases → covered across error handling in Tasks 9–10 + structure-checker
  - Spec §Acceptance criteria — verify with Task 13 manual run

- [ ] No placeholders: every task has concrete code, file paths, exit-code expectations.

- [ ] Type consistency:
  - `figmaToCssVar` / `cssVarToFigma` (Task 2) referenced by `categorizeVariables` (Task 5) ✓
  - `parseTheme(css)` (Task 4) referenced by `cli.js` (Task 8) ✓
  - `checkStructure(rootNode, opts)` (Task 6) referenced by `cli.js` (Task 8) — opts is `{ fileKey, namingConvention }` ✓
  - `formatReport({ variable, structure }, meta)` (Task 7) referenced by `cli.js` (Task 8) — meta is `{ target, targetUrl, runAt }` ✓
  - Violation shape consistent across categorizer, structure-checker, and report-formatter ✓
