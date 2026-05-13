# ADHD DTCG Format Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `plugins/adhd/lib/to-dtcg/cli.js`'s output into compliance with Terrazzo's canonical DTCG conventions (color objects, dimension objects, fontFamily arrays, shadow object/array, `$extensions.mode` + top-level `$value`). Replace the synthetic Figma test fixture with a real captured response from `https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd`.

**Architecture:** Two-phase work inside `plugins/adhd/lib/to-dtcg/`. Phase A (Tasks 1–7) is fully automated: add new value-format helpers as pure additions, then a single cutover task that switches main paths and updates fixtures atomically. Phase B (Tasks 8–10) requires one manual handoff where the user imports cli.js's DTCG output into their Figma file via a community plugin; the controller then captures the populated state via MCP and saves it as the canonical real fixture. No skill changes — the format shift is invisible at the `adhd:to-dtcg` skill interface.

**Tech Stack:** Plain JavaScript (Node 20+ stdlib), `node:test` for tests, GitHub Actions CI (already wired), Figma desktop + Variables JSON Import community plugin (Phase B handoff only).

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-dtcg-format-compliance-design.md`.

---

## File map

**Modify:**
- `plugins/adhd/lib/to-dtcg/cli.js` — bulk of the work. Add 5 new helpers (Tasks 1–4 + Task 6); refactor 3 existing functions (Task 7).
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css` — add `--shadow-md` (Task 7).
- `plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css` — add a default shadow (Task 7).
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json` — full rewrite to new format (Task 7).
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json` — updated to new shape (Task 7, still synthetic), then replaced with real capture (Task 9).
- `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js` — adapt to ColorValue object output (Task 5).
- `plugins/adhd/lib/to-dtcg/__tests__/css.test.js` — minor: still byte-equal vs new fixture (Task 7).
- `plugins/adhd/lib/to-dtcg/__tests__/figma.test.js` — same (Task 7).
- `plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js` — same (Task 7).
- `plugins/adhd/lib/to-dtcg/README.md` — update format-reference + fixture-refresh workflow (Task 10).
- `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` — Section 5's mode-extension example updated to new shape (Task 7).

**Create:**
- `plugins/adhd/lib/to-dtcg/__tests__/dimension.test.js` — Task 1 unit tests for `parseCssDimension`.
- `plugins/adhd/lib/to-dtcg/__tests__/font-family.test.js` — Task 2 unit tests for `parseFontFamily`.
- `plugins/adhd/lib/to-dtcg/__tests__/color.test.js` — Task 3 unit tests for `parseCssColor`.
- `plugins/adhd/lib/to-dtcg/__tests__/shadow.test.js` — Task 4 unit tests for `parseCssShadow`.
- `plugins/adhd/lib/to-dtcg/__tests__/color-value.test.js` — Task 6 unit tests for `rgbObjectToColorValue`.

**Not modified:**
- `plugins/adhd/skills/to-dtcg/SKILL.md` — orchestrator; insulated from format change.
- `plugins/adhd/skills/config/SKILL.md`, `plugins/adhd/skills/sync/SKILL.md` — irrelevant.
- `scripts/validate-skill-frontmatter.js` — irrelevant.
- `.github/workflows/ci.yml` — already runs `node --test plugins/adhd/lib/to-dtcg/__tests__/`; new test files picked up automatically.

## Validation strategy

Same as Plan 1: `node --test plugins/adhd/lib/to-dtcg/__tests__/` is the test gate. Tasks 1–6 are pure additions and never break existing tests. Task 7 is a single big cutover that goes from green-to-green: existing `oklch.test.js` and `css.test.js` and `figma.test.js` and `round-trip.test.js` all break temporarily as the implementer works through the steps, then all pass at the end of the task. Task 7 commits only when all tests are green.

Phase B (Tasks 8–10) involves a manual handoff. Tests pass continuously through Phase B (the swap from synthetic to real fixture is byte-equal-preserving by design).

## Important conventions (carried from Plan 1)

- **All keys in DTCG output sorted alphabetically at every object level.** This makes byte-equal fixture tests possible.
- **2-space indent, LF line endings, trailing newline.** Standard `JSON.stringify(obj, null, 2) + '\n'` after sortKeysDeep.
- **Round float components to 4 decimal places** — `Math.round(n * 10000) / 10000`. Keeps output stable across runs.
- **Zero npm dependencies.** Only `node:fs`, `node:path`, `node:test`, `node:assert`, `node:child_process`.

---

## Task 1: Add `parseCssDimension` helper

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js` (add helper function)
- Create: `plugins/adhd/lib/to-dtcg/__tests__/dimension.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/to-dtcg/__tests__/dimension.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseCssDimension } = require('../cli.js');

test('parseCssDimension: rem', () => {
  assert.deepEqual(parseCssDimension('0.25rem'), { value: 0.25, unit: 'rem' });
  assert.deepEqual(parseCssDimension('1rem'), { value: 1, unit: 'rem' });
});

test('parseCssDimension: px', () => {
  assert.deepEqual(parseCssDimension('4px'), { value: 4, unit: 'px' });
  assert.deepEqual(parseCssDimension('16px'), { value: 16, unit: 'px' });
});

test('parseCssDimension: em', () => {
  assert.deepEqual(parseCssDimension('1.5em'), { value: 1.5, unit: 'em' });
});

test('parseCssDimension: negative values', () => {
  assert.deepEqual(parseCssDimension('-1.5em'), { value: -1.5, unit: 'em' });
  assert.deepEqual(parseCssDimension('-1px'), { value: -1, unit: 'px' });
});

test('parseCssDimension: unitless 0', () => {
  // CSS conventionally allows bare 0 (with no unit). Treat as px.
  assert.deepEqual(parseCssDimension('0'), { value: 0, unit: 'px' });
});

test('parseCssDimension: whitespace-tolerant', () => {
  assert.deepEqual(parseCssDimension('  1rem  '), { value: 1, unit: 'rem' });
});

test('parseCssDimension: unsupported unit returns null', () => {
  assert.equal(parseCssDimension('1pt'), null);
  assert.equal(parseCssDimension('1vh'), null);
});

test('parseCssDimension: malformed returns null', () => {
  assert.equal(parseCssDimension(''), null);
  assert.equal(parseCssDimension('abc'), null);
  assert.equal(parseCssDimension('rem'), null);
  assert.equal(parseCssDimension('1.5'), null);  // no unit, not 0
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/dimension.test.js
```

Expected: tests fail with `parseCssDimension is not a function`.

- [ ] **Step 3: Implement `parseCssDimension`**

In `plugins/adhd/lib/to-dtcg/cli.js`, find the `// CSS parsing` section header (approximately line 75 — after the OKLCH section, before `ADHD_PRIMITIVE_PREFIXES`). Insert this function block AFTER `// CSS parsing` and the constants (`ADHD_PRIMITIVE_PREFIXES`, `NAMESPACE_TO_DTCG_TYPE`, `NAMESPACE_TO_DTCG_PATH`):

```js
// ============================================================
// Value-format helpers (DTCG-canonical shapes)
// ============================================================

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function parseCssDimension(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '0') return { value: 0, unit: 'px' };
  const match = /^(-?\d+\.?\d*)(rem|em|px)$/.exec(trimmed);
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2] };
}
```

Update `module.exports` at the bottom of cli.js to include the new helpers:

```js
module.exports = {
  parseArgs,
  oklchToHex,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToHex,
  // NEW: Plan 1.5 helpers
  parseCssDimension,
  round4,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/dimension.test.js
```

Expected: all 8 tests pass.

- [ ] **Step 5: Run all existing tests; confirm no regressions**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 23 tests pass (15 existing + 8 new dimension tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/dimension.test.js
git commit -m "to-dtcg: add parseCssDimension helper"
```

---

## Task 2: Add `parseFontFamily` helper

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/font-family.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/to-dtcg/__tests__/font-family.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseFontFamily } = require('../cli.js');

test('parseFontFamily: single family', () => {
  assert.deepEqual(parseFontFamily('sans-serif'), ['sans-serif']);
});

test('parseFontFamily: comma-separated stack', () => {
  assert.deepEqual(parseFontFamily('Inter, sans-serif'), ['Inter', 'sans-serif']);
});

test('parseFontFamily: quoted family names (double quotes)', () => {
  assert.deepEqual(parseFontFamily('"Geist Sans", system-ui'), ['Geist Sans', 'system-ui']);
});

test('parseFontFamily: quoted family names (single quotes)', () => {
  assert.deepEqual(parseFontFamily("'Helvetica Neue', serif"), ['Helvetica Neue', 'serif']);
});

test('parseFontFamily: extra whitespace tolerated', () => {
  assert.deepEqual(parseFontFamily('  Inter  ,   sans-serif  '), ['Inter', 'sans-serif']);
});

test('parseFontFamily: long Tailwind v4 default stack', () => {
  const raw = "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";
  assert.deepEqual(parseFontFamily(raw), [
    'ui-sans-serif',
    'system-ui',
    'sans-serif',
    'Apple Color Emoji',
    'Segoe UI Emoji',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/font-family.test.js
```

Expected: tests fail with `parseFontFamily is not a function`.

- [ ] **Step 3: Implement `parseFontFamily`**

In `plugins/adhd/lib/to-dtcg/cli.js`, AFTER the `parseCssDimension` function from Task 1, add:

```js
function parseFontFamily(raw) {
  return raw.split(',').map(part => {
    let s = part.trim();
    // Strip surrounding quotes (single or double)
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      s = s.slice(1, -1);
    }
    return s;
  });
}
```

Update `module.exports` to add `parseFontFamily`:

```js
module.exports = {
  parseArgs,
  oklchToHex,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToHex,
  parseCssDimension,
  round4,
  parseFontFamily,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/font-family.test.js
```

Expected: all 6 tests pass.

- [ ] **Step 5: Run all tests; confirm no regressions**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 29 tests pass (23 from before + 6 new).

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/font-family.test.js
git commit -m "to-dtcg: add parseFontFamily helper"
```

---

## Task 3: Add `parseCssColor` helper

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/color.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/to-dtcg/__tests__/color.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseCssColor } = require('../cli.js');

test('parseCssColor: 6-char hex', () => {
  assert.deepEqual(parseCssColor('#faf0c5'), {
    colorSpace: 'srgb',
    components: [0.9804, 0.9412, 0.7725],
    alpha: 1,
  });
});

test('parseCssColor: 3-char hex (expanded)', () => {
  assert.deepEqual(parseCssColor('#abc'), {
    colorSpace: 'srgb',
    components: [0.6667, 0.7333, 0.8],
    alpha: 1,
  });
});

test('parseCssColor: 8-char hex (with alpha)', () => {
  // #ff0000ff = red, fully opaque
  assert.deepEqual(parseCssColor('#ff0000ff'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 1,
  });
  // #ff000080 = red, 50% alpha
  assert.deepEqual(parseCssColor('#ff000080'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 0.502,
  });
});

test('parseCssColor: rgb() legacy syntax', () => {
  assert.deepEqual(parseCssColor('rgb(255, 0, 0)'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: rgba() legacy syntax', () => {
  assert.deepEqual(parseCssColor('rgba(0, 0, 0, 0.1)'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 0.1,
  });
});

test('parseCssColor: rgb() modern syntax (space-separated)', () => {
  assert.deepEqual(parseCssColor('rgb(255 0 0)'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: rgb() modern syntax with alpha', () => {
  assert.deepEqual(parseCssColor('rgb(0 0 0 / 0.1)'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 0.1,
  });
});

test('parseCssColor: named transparent', () => {
  assert.deepEqual(parseCssColor('transparent'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 0,
  });
});

test('parseCssColor: named black', () => {
  assert.deepEqual(parseCssColor('black'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: named white', () => {
  assert.deepEqual(parseCssColor('white'), {
    colorSpace: 'srgb',
    components: [1, 1, 1],
    alpha: 1,
  });
});

test('parseCssColor: case-insensitive named colors', () => {
  assert.deepEqual(parseCssColor('BLACK'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: throws on unparseable input', () => {
  assert.throws(() => parseCssColor('not-a-color'), /Unparseable CSS color/);
  assert.throws(() => parseCssColor('hsl(0, 100%, 50%)'), /Unparseable CSS color/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/color.test.js
```

Expected: tests fail with `parseCssColor is not a function`.

- [ ] **Step 3: Implement `parseCssColor`**

In `plugins/adhd/lib/to-dtcg/cli.js`, AFTER the `parseFontFamily` function from Task 2, add:

```js
function parseCssColor(raw) {
  if (typeof raw !== 'string') {
    throw new Error(`Unparseable CSS color: ${raw}`);
  }
  const s = raw.trim().toLowerCase();

  // Named colors (only the few we need to support).
  if (s === 'transparent') return { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0 };
  if (s === 'black') return { colorSpace: 'srgb', components: [0, 0, 0], alpha: 1 };
  if (s === 'white') return { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1 };

  // Hex: #rgb / #rrggbb / #rrggbbaa
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return {
      colorSpace: 'srgb',
      components: [round4(r), round4(g), round4(b)],
      alpha: round4(a),
    };
  }

  // rgb() / rgba() legacy: comma-separated 0–255 ints, optional 0–1 alpha.
  const rgbLegacy = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(s);
  if (rgbLegacy) {
    return {
      colorSpace: 'srgb',
      components: [
        round4(parseInt(rgbLegacy[1], 10) / 255),
        round4(parseInt(rgbLegacy[2], 10) / 255),
        round4(parseInt(rgbLegacy[3], 10) / 255),
      ],
      alpha: rgbLegacy[4] !== undefined ? round4(parseFloat(rgbLegacy[4])) : 1,
    };
  }

  // rgb() / rgba() modern: space-separated, optional / alpha.
  const rgbModern = /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(s);
  if (rgbModern) {
    return {
      colorSpace: 'srgb',
      components: [
        round4(parseInt(rgbModern[1], 10) / 255),
        round4(parseInt(rgbModern[2], 10) / 255),
        round4(parseInt(rgbModern[3], 10) / 255),
      ],
      alpha: rgbModern[4] !== undefined ? round4(parseFloat(rgbModern[4])) : 1,
    };
  }

  throw new Error(`Unparseable CSS color: ${raw}`);
}
```

Update `module.exports`:

```js
module.exports = {
  parseArgs,
  oklchToHex,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToHex,
  parseCssDimension,
  round4,
  parseFontFamily,
  parseCssColor,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/color.test.js
```

Expected: all 12 tests pass.

- [ ] **Step 5: Run all tests; confirm no regressions**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 41 tests pass (29 from before + 12 new).

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/color.test.js
git commit -m "to-dtcg: add parseCssColor helper (hex/rgb/rgba/named)"
```

---

## Task 4: Add `parseCssShadow` helper

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/shadow.test.js`

This is the largest helper (~80 lines plus a tokenizer). Tests use shadow strings borrowed from sd-tailwindv4's fixtures and Tailwind v4's actual default tokens.

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/to-dtcg/__tests__/shadow.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseCssShadow } = require('../cli.js');

test('parseCssShadow: single shadow with rgba', () => {
  const result = parseCssShadow('0 4px 6px -1px rgba(0, 0, 0, 0.1)');
  assert.deepEqual(result, [{
    color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1 },
    offsetX: { value: 0, unit: 'px' },
    offsetY: { value: 4, unit: 'px' },
    blur:    { value: 6, unit: 'px' },
    spread:  { value: -1, unit: 'px' },
    inset:   false,
  }]);
});

test('parseCssShadow: single shadow with rgb modern syntax', () => {
  const result = parseCssShadow('0 1px 3px 0 rgb(0 0 0 / 0.1)');
  assert.deepEqual(result, [{
    color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1 },
    offsetX: { value: 0, unit: 'px' },
    offsetY: { value: 1, unit: 'px' },
    blur:    { value: 3, unit: 'px' },
    spread:  { value: 0, unit: 'px' },
    inset:   false,
  }]);
});

test('parseCssShadow: multi-shadow stack (Tailwind v4 shadow-md)', () => {
  const result = parseCssShadow('0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].offsetY, { value: 4, unit: 'px' });
  assert.deepEqual(result[1].offsetY, { value: 2, unit: 'px' });
  assert.equal(result[0].inset, false);
  assert.equal(result[1].inset, false);
});

test('parseCssShadow: inset keyword', () => {
  const result = parseCssShadow('inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)');
  assert.equal(result.length, 1);
  assert.equal(result[0].inset, true);
  assert.deepEqual(result[0].offsetY, { value: 2, unit: 'px' });
});

test('parseCssShadow: 3 dimensions (no spread)', () => {
  const result = parseCssShadow('0 4px 6px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].spread, { value: 0, unit: 'px' });
  assert.deepEqual(result[0].blur, { value: 6, unit: 'px' });
});

test('parseCssShadow: 2 dimensions (no blur, no spread)', () => {
  const result = parseCssShadow('0 4px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].blur, { value: 0, unit: 'px' });
  assert.deepEqual(result[0].spread, { value: 0, unit: 'px' });
  assert.deepEqual(result[0].offsetY, { value: 4, unit: 'px' });
});

test('parseCssShadow: hex color', () => {
  const result = parseCssShadow('0 1px 2px #000000');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].color, {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('parseCssShadow: comma in rgba does not split shadows', () => {
  // The commas inside rgba() must not be treated as shadow separators.
  const result = parseCssShadow('0 1px 2px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 1, 'should be 1 shadow, not 4');
});

test('parseCssShadow: throws on insufficient tokens', () => {
  assert.throws(() => parseCssShadow('rgba(0, 0, 0, 0.1)'), /at least offsetX, offsetY, color/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/shadow.test.js
```

Expected: tests fail with `parseCssShadow is not a function`.

- [ ] **Step 3: Implement `parseCssShadow` plus its internal helpers**

In `plugins/adhd/lib/to-dtcg/cli.js`, AFTER the `parseCssColor` function from Task 3, add:

```js
function splitTopLevel(str, separator) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === separator && depth === 0) {
      out.push(str.slice(start, i));
      start = i + 1;
    }
  }
  out.push(str.slice(start));
  return out;
}

function tokenizeShadow(s) {
  // Split on whitespace, but keep rgb(...)/rgba(...) intact.
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s.slice(i, i + 4) === 'rgb(' || s.slice(i, i + 5) === 'rgba(') {
      const start = i;
      let depth = 0;
      while (i < s.length) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') {
          depth--;
          if (depth === 0) { i++; break; }
        }
        i++;
      }
      tokens.push(s.slice(start, i));
    } else {
      const start = i;
      while (i < s.length && !/\s/.test(s[i])) i++;
      tokens.push(s.slice(start, i));
    }
  }
  return tokens;
}

function parseSingleShadow(str) {
  let s = str.trim();
  let inset = false;
  if (/^inset\b/.test(s)) {
    inset = true;
    s = s.slice(5).trim();
  }
  const tokens = tokenizeShadow(s);
  if (tokens.length < 3) {
    throw new Error(`Shadow needs at least offsetX, offsetY, color: ${str}`);
  }
  const colorToken = tokens[tokens.length - 1];
  const dimensionTokens = tokens.slice(0, -1);
  if (dimensionTokens.length < 2 || dimensionTokens.length > 4) {
    throw new Error(`Shadow needs 2-4 dimension values: ${str}`);
  }
  const [offsetX, offsetY, blur, spread] = dimensionTokens;
  const parseDim = (raw, name) => {
    const dim = parseCssDimension(raw);
    if (!dim) throw new Error(`Bad shadow ${name}: ${raw}`);
    return dim;
  };
  return {
    color: parseCssColor(colorToken),
    offsetX: parseDim(offsetX, 'offsetX'),
    offsetY: parseDim(offsetY, 'offsetY'),
    blur:    blur !== undefined ? parseDim(blur, 'blur') : { value: 0, unit: 'px' },
    spread:  spread !== undefined ? parseDim(spread, 'spread') : { value: 0, unit: 'px' },
    inset:   inset,
  };
}

function parseCssShadow(raw) {
  const shadowStrings = splitTopLevel(raw, ',');
  return shadowStrings.map(s => parseSingleShadow(s.trim()));
}
```

Update `module.exports`:

```js
module.exports = {
  parseArgs,
  oklchToHex,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToHex,
  parseCssDimension,
  round4,
  parseFontFamily,
  parseCssColor,
  parseCssShadow,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/shadow.test.js
```

Expected: all 9 tests pass.

- [ ] **Step 5: Run all tests; confirm no regressions**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 50 tests pass (41 + 9 new).

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/shadow.test.js
git commit -m "to-dtcg: add parseCssShadow helper (single/multi/inset)"
```

---

## Task 5: Add `oklchToColorValue` (alongside existing `oklchToHex`)

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Modify: `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js` — extend with new tests for the ColorValue variant

We add `oklchToColorValue` as a new function. The existing `oklchToHex` stays (will be deleted in Task 7 after the cutover).

- [ ] **Step 1: Add new tests for `oklchToColorValue` (alongside existing hex tests)**

Append to `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js`:

```js
const { oklchToColorValue } = require('../cli.js');

// Tailwind v4's red-500 reference: oklch(63.7% 0.237 25.331). Components are
// gamma-encoded sRGB floats in [0, 1]. The hex equivalent of these components,
// rounded to 8-bit channels, is #fb2c36.
test('oklchToColorValue: red-500 returns ColorValue object', () => {
  const cv = oklchToColorValue(0.637, 0.237, 25.331);
  assert.equal(cv.colorSpace, 'srgb');
  assert.equal(cv.alpha, 1);
  assert.equal(cv.components.length, 3);
  // Components ≈ #fb2c36 = (251/255, 44/255, 54/255) ≈ (0.984, 0.172, 0.212).
  assert.ok(Math.abs(cv.components[0] - 0.984) <= 0.005, `R: ${cv.components[0]}`);
  assert.ok(Math.abs(cv.components[1] - 0.172) <= 0.005, `G: ${cv.components[1]}`);
  assert.ok(Math.abs(cv.components[2] - 0.212) <= 0.005, `B: ${cv.components[2]}`);
});

test('oklchToColorValue: black is exactly [0, 0, 0]', () => {
  const cv = oklchToColorValue(0, 0, 0);
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('oklchToColorValue: white is exactly [1, 1, 1]', () => {
  const cv = oklchToColorValue(1, 0, 0);
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [1, 1, 1],
    alpha: 1,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/oklch.test.js
```

Expected: 3 new tests fail with `oklchToColorValue is not a function`.

- [ ] **Step 3: Implement `oklchToColorValue`**

In `plugins/adhd/lib/to-dtcg/cli.js`, find the existing `oklchToHex` function (in the OKLCH section). Add the new function RIGHT AFTER it:

```js
function oklchToColorValue(L, C, h) {
  const lab = oklchToOklab(L, C, h);
  const lin = oklabToLinearSrgb(lab);
  const r = clamp01(linearToCompandedSrgb(lin.r));
  const g = clamp01(linearToCompandedSrgb(lin.g));
  const b = clamp01(linearToCompandedSrgb(lin.b));
  return {
    colorSpace: 'srgb',
    components: [round4(r), round4(g), round4(b)],
    alpha: 1,
  };
}
```

(Note: `oklchToColorValue` shares all the same math as `oklchToHex` but stops short of the 8-bit quantization step. Both functions co-exist for now; Task 7 deletes `oklchToHex`.)

Update `module.exports` to add `oklchToColorValue`:

```js
module.exports = {
  parseArgs,
  oklchToHex,
  oklchToColorValue,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToHex,
  parseCssDimension,
  round4,
  parseFontFamily,
  parseCssColor,
  parseCssShadow,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/oklch.test.js
```

Expected: all OKLCH tests pass (4 existing + 3 new = 7).

- [ ] **Step 5: Run all tests; confirm no regressions**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 53 tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js
git commit -m "to-dtcg: add oklchToColorValue (alongside oklchToHex)"
```

---

## Task 6: Add `rgbObjectToColorValue` (alongside existing `rgbObjectToHex`)

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/color-value.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/to-dtcg/__tests__/color-value.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { rgbObjectToColorValue } = require('../cli.js');

test('rgbObjectToColorValue: full alpha', () => {
  const cv = rgbObjectToColorValue({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0.5, 0.5, 0.5],
    alpha: 1,
  });
});

test('rgbObjectToColorValue: partial alpha', () => {
  const cv = rgbObjectToColorValue({ r: 1, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 0.5,
  });
});

test('rgbObjectToColorValue: alpha undefined defaults to 1', () => {
  const cv = rgbObjectToColorValue({ r: 0, g: 0, b: 0 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('rgbObjectToColorValue: gold-100 round-trip from RGB', () => {
  // Figma stores #faf0c5 = (250, 240, 197) ≈ (0.9804, 0.9412, 0.7725).
  const cv = rgbObjectToColorValue({ r: 0.9804, g: 0.9412, b: 0.7725, a: 1 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0.9804, 0.9412, 0.7725],
    alpha: 1,
  });
});

test('rgbObjectToColorValue: rounds to 4 decimals', () => {
  const cv = rgbObjectToColorValue({ r: 0.123456789, g: 0.987654321, b: 0.5, a: 0.9876543 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0.1235, 0.9877, 0.5],
    alpha: 0.9877,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/color-value.test.js
```

Expected: tests fail with `rgbObjectToColorValue is not a function`.

- [ ] **Step 3: Implement `rgbObjectToColorValue`**

In `plugins/adhd/lib/to-dtcg/cli.js`, find the existing `rgbObjectToHex` function (in the Figma section). Add the new function RIGHT AFTER it:

```js
function rgbObjectToColorValue({ r, g, b, a }) {
  return {
    colorSpace: 'srgb',
    components: [round4(r), round4(g), round4(b)],
    alpha: a !== undefined ? round4(a) : 1,
  };
}
```

Update `module.exports`:

```js
module.exports = {
  parseArgs,
  oklchToHex,
  oklchToColorValue,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToHex,
  rgbObjectToColorValue,
  parseCssDimension,
  round4,
  parseFontFamily,
  parseCssColor,
  parseCssShadow,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/color-value.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run all tests; confirm no regressions**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 58 tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/color-value.test.js
git commit -m "to-dtcg: add rgbObjectToColorValue (alongside rgbObjectToHex)"
```

---

## Task 7: Format cutover

The big one. This single task atomically:
- Refactors `normalizeCssValue` to dispatch on `dtcgType` and call the new helpers
- Threads `dtcgType` through `parseCssTokens` and `parseTailwindTheme`
- Refactors `buildDtcgFromCssTokens`'s semantic-leaf shape
- Refactors `parseFigmaResponse` value resolution
- Adds `--shadow-md` to `sample-globals.css` and `--shadow-2xs` to `tailwind-v4-theme.css`
- Rewrites `sample.dtcg.json` with the new format
- Updates `sample-figma-response.json` (still synthetic, new shape)
- Deletes `oklchToHex` and `rgbObjectToHex` (no longer needed)
- Verifies all tests pass byte-equal

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js` (multiple edits across functions)
- Modify: `plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css`
- Modify: `plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css`
- Modify: `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json`
- Modify: `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json`
- Modify: `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` (Section 5 example)

> **Note for the implementer:** this task has many steps. Each step is small (an edit + run tests). The test gate is at Step 12 — final commit only after all 50+ tests pass byte-equal against the new fixtures.

- [ ] **Step 1: Add `--shadow-md` to `sample-globals.css`**

Edit `plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css`. Find the existing `@theme` block. Add `--shadow-md` as the last line inside the block:

Replace this:
```css
@theme {
  --color-gold-100: #faf0c5;
  --color-gold-900: #3f2909;
  --spacing-4: 1rem;
}
```

With this:
```css
@theme {
  --color-gold-100: #faf0c5;
  --color-gold-900: #3f2909;
  --spacing-4: 1rem;
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
}
```

- [ ] **Step 2: Add `--shadow-2xs` to `tailwind-v4-theme.css`**

Edit `plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css`:

Replace this:
```css
@theme default {
  --color-red-500: oklch(63.7% 0.237 25.331);
}
```

With this:
```css
@theme default {
  --color-red-500: oklch(63.7% 0.237 25.331);
  --shadow-2xs: 0 1px rgb(0 0 0 / 0.05);
}
```

- [ ] **Step 3: Refactor `normalizeCssValue` to dispatch on `dtcgType`**

In `plugins/adhd/lib/to-dtcg/cli.js`, find the existing `normalizeCssValue` function. Replace its body entirely:

```js
function normalizeCssValue(raw, namespace, dtcgType) {
  raw = String(raw).trim();

  // Aliases come through as DTCG references regardless of namespace.
  const aliasMatch = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(raw);
  if (aliasMatch) {
    const target = variableNameToDtcg(aliasMatch[1]);
    if (target) return `{${target.dtcgPath}}`;
    return raw;
  }

  // OKLCH -> ColorValue object.
  const oklchMatch = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(raw);
  if (oklchMatch) {
    const L = parseFloat(oklchMatch[1]) / 100;
    const C = parseFloat(oklchMatch[2]);
    const H = parseFloat(oklchMatch[3]);
    const cv = oklchToColorValue(L, C, H);
    if (oklchMatch[4] !== undefined) cv.alpha = round4(parseFloat(oklchMatch[4]));
    return cv;
  }

  // Type-specific dispatch.
  if (dtcgType === 'color') {
    return parseCssColor(raw);
  }
  if (dtcgType === 'dimension') {
    const dim = parseCssDimension(raw);
    if (!dim) throw new Error(`Unparseable dimension '${raw}' (expected rem/em/px)`);
    return dim;
  }
  if (dtcgType === 'fontFamily') {
    return parseFontFamily(raw);
  }
  if (dtcgType === 'fontWeight' || dtcgType === 'number') {
    return parseFloat(raw);
  }
  if (dtcgType === 'shadow') {
    return parseCssShadow(raw);
  }

  // Pass-through for non-ADHD-managed names.
  return raw;
}
```

- [ ] **Step 4: Thread `dtcgType` through `parseCssTokens` and `parseTailwindTheme`**

In `plugins/adhd/lib/to-dtcg/cli.js`, find `parseCssTokens`. Update its inner loops to pass `dtcgType` to `normalizeCssValue`. The function already computes `dtcgType` for primitives but discards it; just pass it as the third arg.

Find this block inside `parseCssTokens` (the primitives loop):
```js
for (const decl of parseDeclarations(themeBlock.body)) {
  const mapped = variableNameToDtcg(decl.name);
  if (!mapped) continue;
  const dtcgType = NAMESPACE_TO_DTCG_TYPE[mapped.namespace];
  const value = normalizeCssValue(decl.value, mapped.namespace);
  result.primitives.push({ ...mapped, value, dtcgType });
}
```

Replace with (just adds `dtcgType` as the 3rd arg):
```js
for (const decl of parseDeclarations(themeBlock.body)) {
  const mapped = variableNameToDtcg(decl.name);
  if (!mapped) continue;
  const dtcgType = NAMESPACE_TO_DTCG_TYPE[mapped.namespace];
  const value = normalizeCssValue(decl.value, mapped.namespace, dtcgType);
  result.primitives.push({ ...mapped, value, dtcgType });
}
```

Do the same for the two semantic loops (find `result.semanticLight.push` and `result.semanticDark.push`):

```js
// rootBlock loop:
for (const decl of parseDeclarations(rootBlock.body)) {
  if (variableNameToDtcg(decl.name)) continue;
  const stripped = decl.name.replace(/^--/, '');
  const dtcgPath = `color.${stripped.replace(/-/g, '.')}`;
  const value = normalizeCssValue(decl.value, 'color', 'color');
  result.semanticLight.push({ namespace: 'color', dtcgPath, value, dtcgType: 'color' });
}

// darkBlock loop:
for (const decl of parseDeclarations(darkBlock.body)) {
  if (variableNameToDtcg(decl.name)) continue;
  const stripped = decl.name.replace(/^--/, '');
  const dtcgPath = `color.${stripped.replace(/-/g, '.')}`;
  const value = normalizeCssValue(decl.value, 'color', 'color');
  result.semanticDark.push({ namespace: 'color', dtcgPath, value, dtcgType: 'color' });
}
```

Then find `parseTailwindTheme`. Update similarly:
```js
function parseTailwindTheme(themeText) {
  const block = findAtThemeBlock(themeText, 'theme default');
  if (!block) return [];
  const out = [];
  for (const decl of parseDeclarations(block.body)) {
    const mapped = variableNameToDtcg(decl.name);
    if (!mapped) continue;
    const dtcgType = NAMESPACE_TO_DTCG_TYPE[mapped.namespace];
    const value = normalizeCssValue(decl.value, mapped.namespace, dtcgType);
    out.push({ ...mapped, value, dtcgType });
  }
  return out;
}
```

- [ ] **Step 5: Refactor `buildDtcgFromCssTokens` semantic-leaf shape**

In `plugins/adhd/lib/to-dtcg/cli.js`, find `buildDtcgFromCssTokens`. Replace the semantic-token loop body:

OLD body of the semantic loop:
```js
for (const [dotPath, sem] of semByPath) {
  const leaf = {
    $type: sem.type,
    $extensions: {
      'com.figma': {
        modes: {},
      },
    },
  };
  if (sem.light !== undefined) leaf.$extensions['com.figma'].modes.Light = { $value: sem.light };
  if (sem.dark !== undefined) leaf.$extensions['com.figma'].modes.Dark = { $value: sem.dark };
  setNested(root, dotPath, leaf);
}
```

NEW body:
```js
for (const [dotPath, sem] of semByPath) {
  // Top-level $value defaults to the Light mode value (the canonical default).
  // $extensions.mode carries per-mode overrides as bare values (no $value wrapping).
  // Lowercase mode keys per Terrazzo conventions.
  const defaultValue = sem.light !== undefined ? sem.light : sem.dark;
  const leaf = {
    $type: sem.type,
    $value: defaultValue,
    $extensions: { mode: {} },
  };
  if (sem.light !== undefined) leaf.$extensions.mode.light = sem.light;
  if (sem.dark !== undefined) leaf.$extensions.mode.dark = sem.dark;
  setNested(root, dotPath, leaf);
}
```

- [ ] **Step 6: Refactor `parseFigmaResponse` value resolution**

In `plugins/adhd/lib/to-dtcg/cli.js`, find `parseFigmaResponse`. Inside it, find the inner `resolveValue` function. Replace its body entirely:

```js
function resolveValue(value, namespace) {
  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    const target = varInfo[value.id];
    if (!target) throw new Error(`Unresolved alias: ${value.id}`);
    return `{${target.dtcgPath}}`;
  }
  if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
    return rgbObjectToColorValue(value);
  }
  // Spacing or other dimension-typed values come back as strings; parse them.
  if (typeof value === 'string') {
    if (namespace === 'spacing' || namespace === 'radius' || namespace === 'text') {
      const dim = parseCssDimension(value);
      if (!dim) throw new Error(`Unparseable Figma dimension: ${value}`);
      return dim;
    }
    if (namespace === 'font') {
      return parseFontFamily(value);
    }
    if (namespace === 'leading' || namespace === 'font-weight') {
      return parseFloat(value);
    }
    return value;
  }
  if (typeof value === 'number') return value;
  throw new Error(`Unsupported value: ${JSON.stringify(value)}`);
}
```

Then find the Semantic loop near the bottom of `parseFigmaResponse` (the one that pushes to `out.semanticLight` and `out.semanticDark`). The shape stays the same — `semanticLight` and `semanticDark` are arrays of `{ namespace, dtcgPath, value, dtcgType }`. Confirm it still looks like:

```js
} else if (collection.name === 'Semantic') {
  for (const m of collection.modes) {
    const value = resolveValue(v.valuesByMode[m.modeId], info.namespace);
    if (m.name === 'Light') out.semanticLight.push({ ...info, value, dtcgType });
    else if (m.name === 'Dark') out.semanticDark.push({ ...info, value, dtcgType });
    else throw new Error(`Unexpected Semantic mode: ${m.name}`);
  }
}
```

(No change here — the `buildDtcgFromCssTokens` consumer handles the new mode shape per Step 5.)

- [ ] **Step 7: Rewrite `sample.dtcg.json` with new format**

Replace the entire content of `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json` with:

```json
{
  "color": {
    "brand": {
      "surface": {
        "$extensions": {
          "mode": {
            "dark": "{color.gold.900}",
            "light": "{color.gold.100}"
          }
        },
        "$type": "color",
        "$value": "{color.gold.100}"
      }
    },
    "gold": {
      "100": {
        "$type": "color",
        "$value": {
          "alpha": 1,
          "colorSpace": "srgb",
          "components": [
            0.9804,
            0.9412,
            0.7725
          ]
        }
      },
      "900": {
        "$type": "color",
        "$value": {
          "alpha": 1,
          "colorSpace": "srgb",
          "components": [
            0.2471,
            0.1608,
            0.0353
          ]
        }
      }
    },
    "red": {
      "500": {
        "$type": "color",
        "$value": {
          "alpha": 1,
          "colorSpace": "srgb",
          "components": [
            0.984,
            0.172,
            0.212
          ]
        }
      }
    }
  },
  "shadow": {
    "2xs": {
      "$type": "shadow",
      "$value": [
        {
          "blur": {
            "unit": "px",
            "value": 0
          },
          "color": {
            "alpha": 0.05,
            "colorSpace": "srgb",
            "components": [
              0,
              0,
              0
            ]
          },
          "inset": false,
          "offsetX": {
            "unit": "px",
            "value": 0
          },
          "offsetY": {
            "unit": "px",
            "value": 1
          },
          "spread": {
            "unit": "px",
            "value": 0
          }
        }
      ]
    },
    "md": {
      "$type": "shadow",
      "$value": [
        {
          "blur": {
            "unit": "px",
            "value": 6
          },
          "color": {
            "alpha": 0.1,
            "colorSpace": "srgb",
            "components": [
              0,
              0,
              0
            ]
          },
          "inset": false,
          "offsetX": {
            "unit": "px",
            "value": 0
          },
          "offsetY": {
            "unit": "px",
            "value": 4
          },
          "spread": {
            "unit": "px",
            "value": -1
          }
        },
        {
          "blur": {
            "unit": "px",
            "value": 4
          },
          "color": {
            "alpha": 0.1,
            "colorSpace": "srgb",
            "components": [
              0,
              0,
              0
            ]
          },
          "inset": false,
          "offsetX": {
            "unit": "px",
            "value": 0
          },
          "offsetY": {
            "unit": "px",
            "value": 2
          },
          "spread": {
            "unit": "px",
            "value": -2
          }
        }
      ]
    }
  },
  "spacing": {
    "4": {
      "$type": "dimension",
      "$value": {
        "unit": "rem",
        "value": 1
      }
    }
  }
}
```

End the file with a single trailing newline.

> **Note on the red-500 component values:** the values `[0.984, 0.172, 0.212]` come from `oklchToColorValue(0.637, 0.237, 25.331)`. If your OKLCH math produces slightly different values (within ±0.005 per channel), update this fixture to match the actual cli.js output rather than chasing precision tweaks. Run `node -e 'console.log(JSON.stringify(require("./cli.js").oklchToColorValue(0.637, 0.237, 25.331)))'` from the to-dtcg directory to compute the exact values.

- [ ] **Step 8: Update `sample-figma-response.json` (still synthetic)**

Replace the entire content of `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json` with:

```json
{
  "meta": {
    "variableCollections": {
      "primitivesId": {
        "id": "primitivesId",
        "name": "Primitives",
        "modes": [
          { "modeId": "primDefault", "name": "Default" }
        ]
      },
      "semanticId": {
        "id": "semanticId",
        "name": "Semantic",
        "modes": [
          { "modeId": "semLight", "name": "Light" },
          { "modeId": "semDark", "name": "Dark" }
        ]
      }
    },
    "variables": {
      "varGold100": {
        "id": "varGold100",
        "name": "colors/gold/100",
        "variableCollectionId": "primitivesId",
        "resolvedType": "COLOR",
        "valuesByMode": {
          "primDefault": { "r": 0.9804, "g": 0.9412, "b": 0.7725, "a": 1 }
        }
      },
      "varGold900": {
        "id": "varGold900",
        "name": "colors/gold/900",
        "variableCollectionId": "primitivesId",
        "resolvedType": "COLOR",
        "valuesByMode": {
          "primDefault": { "r": 0.2471, "g": 0.1608, "b": 0.0353, "a": 1 }
        }
      },
      "varRed500": {
        "id": "varRed500",
        "name": "colors/red/500",
        "variableCollectionId": "primitivesId",
        "resolvedType": "COLOR",
        "valuesByMode": {
          "primDefault": { "r": 0.984, "g": 0.172, "b": 0.212, "a": 1 }
        }
      },
      "varSpacing4": {
        "id": "varSpacing4",
        "name": "spacing/4",
        "variableCollectionId": "primitivesId",
        "resolvedType": "FLOAT",
        "valuesByMode": {
          "primDefault": "1rem"
        }
      },
      "varBrandSurface": {
        "id": "varBrandSurface",
        "name": "colors/brand/surface",
        "variableCollectionId": "semanticId",
        "resolvedType": "COLOR",
        "valuesByMode": {
          "semLight": { "type": "VARIABLE_ALIAS", "id": "varGold100" },
          "semDark":  { "type": "VARIABLE_ALIAS", "id": "varGold900" }
        }
      }
    }
  }
}
```

> **Note:** this fixture deliberately does NOT include shadow variables — Figma represents shadows as `effects` on layers, not as variables. Real Figma files don't typically have shadow variables (the Variables API doesn't natively support shadow tokens). Our `figma.test.js` will round-trip color/dimension/semantic but will skip shadow comparison; that's fine because shadow is exercised by `css.test.js`. The `round-trip.test.js` remains valid because both CSS and Figma sources output the same shape for the tokens both can represent.

- [ ] **Step 9: Adjust round-trip test to skip shadow-only tokens**

The round-trip test currently asserts byte-equal between the css and figma outputs. Since `sample-figma-response.json` doesn't include shadow variables (Figma doesn't support them as variables natively), the figma output won't have a `shadow` key. The CSS output WILL have a `shadow` key (from `--shadow-md` and `--shadow-2xs`). So byte-equal can't hold for the full output.

Update `plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js`:

Replace the test body:
```js
test('css output and figma output are byte-equal', () => {
  const fromCss = execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' });

  const fromFigma = execFileSync('node', [
    cliPath,
    '--source', 'figma',
    '--input', path.join(fixturesDir, 'sample-figma-response.json'),
  ], { encoding: 'utf8' });

  assert.equal(fromCss, fromFigma);
});
```

With:
```js
test('css output and figma output are equal for tokens both sources can represent', () => {
  const fromCss = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' }));

  const fromFigma = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'figma',
    '--input', path.join(fixturesDir, 'sample-figma-response.json'),
  ], { encoding: 'utf8' }));

  // Figma's variable system doesn't natively represent shadow tokens (they're
  // attached to layers as effects, not as variables). So the figma output
  // legitimately lacks a `shadow` key while the css output has one. Compare
  // only domains that both sources can produce.
  assert.deepEqual(fromCss.color, fromFigma.color);
  assert.deepEqual(fromCss.spacing, fromFigma.spacing);
});
```

- [ ] **Step 10: Delete `oklchToHex` and `rgbObjectToHex`**

In `plugins/adhd/lib/to-dtcg/cli.js`, delete the entire `oklchToHex` function (the OLD version that returns a hex string). Also delete `rgbObjectToHex`.

Also remove `oklchToHex` and `rgbObjectToHex` from `module.exports`. The final exports should be:

```js
module.exports = {
  parseArgs,
  oklchToColorValue,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToColorValue,
  parseCssDimension,
  round4,
  parseFontFamily,
  parseCssColor,
  parseCssShadow,
};
```

Update `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js`: at the top, change the import:

```js
const { oklchToColorValue } = require('../cli.js');
```

And REMOVE the four old `oklchToHex` tests at the top of the file (the ones with `assertHexCloseTo`). Keep ONLY the three `oklchToColorValue` tests added in Task 5. Also delete the now-unused helpers at the bottom (`assertHexCloseTo`, `parseHex`).

The new file should have just the three tests added in Task 5, plus the imports. Final shape:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { oklchToColorValue } = require('../cli.js');

test('oklchToColorValue: red-500 returns ColorValue object', () => {
  const cv = oklchToColorValue(0.637, 0.237, 25.331);
  assert.equal(cv.colorSpace, 'srgb');
  assert.equal(cv.alpha, 1);
  assert.equal(cv.components.length, 3);
  assert.ok(Math.abs(cv.components[0] - 0.984) <= 0.005, `R: ${cv.components[0]}`);
  assert.ok(Math.abs(cv.components[1] - 0.172) <= 0.005, `G: ${cv.components[1]}`);
  assert.ok(Math.abs(cv.components[2] - 0.212) <= 0.005, `B: ${cv.components[2]}`);
});

test('oklchToColorValue: black is exactly [0, 0, 0]', () => {
  const cv = oklchToColorValue(0, 0, 0);
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('oklchToColorValue: white is exactly [1, 1, 1]', () => {
  const cv = oklchToColorValue(1, 0, 0);
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [1, 1, 1],
    alpha: 1,
  });
});
```

- [ ] **Step 11: Update spec Section 5 to reflect new mode-extension shape**

Edit `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md`. Find Section 5 (the `adhd:to-dtcg` skill) and the example `Modes` JSON block. Find this:

```jsonc
{
  "color": {
    "brand": {
      "surface": {
        "$type": "color",
        "$extensions": {
          "com.figma": {
            "modes": {
              "Light": { "$value": "{color.gold.100}" },
              "Dark":  { "$value": "{color.gold.900}" }
            }
          }
        }
      }
    }
  }
}
```

Replace with the new canonical form:

```jsonc
{
  "color": {
    "brand": {
      "surface": {
        "$type": "color",
        "$value": "{color.gold.100}",
        "$extensions": {
          "mode": {
            "light": "{color.gold.100}",
            "dark":  "{color.gold.900}"
          }
        }
      }
    }
  }
}
```

- [ ] **Step 12: Run all tests; verify byte-equal pass**

```bash
cd /Users/hhff/Documents/Code/adhd/plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 56 tests pass (originally 50 from Tasks 1-6, minus 4 deleted oklchToHex tests, plus the round-trip test was modified — net 53–56 depending on count). The two big tests to confirm:
- `css source with tailwind merge: produces expected DTCG byte-for-byte` — passes
- `figma source: produces expected DTCG byte-for-byte` — fails! Because the Figma fixture lacks shadow but `sample.dtcg.json` has shadow.

If `figma.test.js` fails, that's expected — fix it next.

- [ ] **Step 13: Adjust `figma.test.js` for the partial-domain fixture**

The figma fixture doesn't have shadow variables. So the figma source output lacks the `shadow` domain. Update `figma.test.js`:

Replace the test body with a deepEqual check that excludes shadow:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('figma source: produces expected DTCG for color and spacing domains', () => {
  const out = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'figma',
    '--input', path.join(fixturesDir, 'sample-figma-response.json'),
  ], { encoding: 'utf8' }));

  const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'sample.dtcg.json'), 'utf8'));

  // Figma's variable API doesn't represent shadow tokens. Compare only the
  // domains both sources support.
  assert.deepEqual(out.color, expected.color);
  assert.deepEqual(out.spacing, expected.spacing);
  assert.equal(out.shadow, undefined, 'figma output should not include shadow domain');
});
```

- [ ] **Step 14: Run all tests; confirm full green**

```bash
cd /Users/hhff/Documents/Code/adhd/plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: ALL tests pass. Concretely:
- `args.test.js` — 7 pass (unchanged)
- `oklch.test.js` — 3 pass (rewritten in Task 5; old hex tests deleted in Step 10)
- `css.test.js` — 2 pass (existing fixture comparison, now against new sample.dtcg.json)
- `figma.test.js` — 1 pass (modified in Step 13)
- `round-trip.test.js` — 1 pass (modified in Step 9)
- `dimension.test.js` — 8 pass (Task 1)
- `font-family.test.js` — 6 pass (Task 2)
- `color.test.js` — 12 pass (Task 3)
- `shadow.test.js` — 9 pass (Task 4)
- `color-value.test.js` — 5 pass (Task 6)

Total: 54 tests pass.

If any test fails, debug with diff output:
```bash
node cli.js --source css --input __fixtures__/sample-globals.css --tailwind-theme __fixtures__/tailwind-v4-theme.css > /tmp/actual.json
diff -u __fixtures__/sample.dtcg.json /tmp/actual.json
```

If the diff shows component values off by 1 LSB (e.g., `0.9804` vs `0.9803`), update the fixture to match the actual cli.js output. The OKLCH and RGB → ColorValue paths are deterministic per their inputs; if a fixture value is off, the fixture is wrong, not the math.

- [ ] **Step 15: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js \
        plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css \
        plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css \
        plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json \
        plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json \
        plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js \
        plugins/adhd/lib/to-dtcg/__tests__/figma.test.js \
        plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js \
        docs/superpowers/specs/2026-05-09-adhd-restructure-design.md
git commit -m "to-dtcg: format cutover — Terrazzo-canonical DTCG (color/dimension/fontFamily/shadow objects + \$extensions.mode)"
```

---

## Task 8: Generate import payload and hand off to user

**Files:**
- (Generated in `/tmp` only; not committed)

This task generates the DTCG payload from cli.js and hands it to the user for manual import into Figma desktop.

- [ ] **Step 1: Generate the import payload**

```bash
cd /Users/hhff/Documents/Code/adhd
node plugins/adhd/lib/to-dtcg/cli.js \
  --source css \
  --input plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css \
  --tailwind-theme plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css \
  > /tmp/adhd-import-payload.json
```

Verify the file was created and has expected size:

```bash
ls -la /tmp/adhd-import-payload.json
head -20 /tmp/adhd-import-payload.json
```

Expected: file exists, ~150-200 lines, starts with `{` and `"color":`.

- [ ] **Step 2: Print the user's manual handoff instructions**

Print to the user (as the implementer's report at the end of this task):

```
=== MANUAL HANDOFF: Figma import ===

Plan 1.5 needs you to manually import the DTCG payload into your Figma file.
This populates the Figma file at PBCAkpPnvGXWrz6H7qfH3V/adhd with the canonical
test variables, so the next task can capture a real MCP fixture.

Steps:

1. Open https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd in Figma desktop.

2. Install the "Variables JSON Import" community plugin if you haven't:
   https://www.figma.com/community/plugin/1504783439805484760/variables-json-import

3. Run the plugin (Plugins menu → Variables JSON Import).

4. Open the file /tmp/adhd-import-payload.json on your machine. Copy its contents.

5. Paste into the plugin's import box. Click "Import".

6. Verify the import succeeded:
   - Open the Variables panel in Figma (top-right of the layers panel)
   - Confirm two collections appear: "Primitives" and "Semantic"
   - Primitives should have: gold-100, gold-900, red-500, spacing-4 (and shadow-* if the plugin supports them; if not, that's fine — note it for later)
   - Semantic should have brand-surface with Light + Dark modes aliased to gold-100 / gold-900

7. Reply "imported" once verified. Plan 1.5 will continue.

If the import fails or the variables look wrong, paste the plugin's error output and we'll diagnose.
```

- [ ] **Step 3: This task does not commit; it ends with the handoff**

This task has no commit step. It produces a temp file and a printed instruction. Plan 1.5's next task picks up after the user replies.

> **Implementer note:** if you're a subagent, this is where you exit with status DONE_WITH_CONCERNS noting "manual handoff required for Task 9 to proceed; user must import /tmp/adhd-import-payload.json into Figma at PBCAkpPnvGXWrz6H7qfH3V/adhd via Variables JSON Import community plugin, then signal continue."

---

## Task 9: Capture real MCP response and replace synthetic fixture

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json` (replace synthetic with real)

This task runs ONLY after the user has confirmed they imported the payload into Figma. The controller (running in the user's session, not a subagent — only the controller has MCP access) calls `mcp__figma__get_variable_defs` to capture the populated state.

- [ ] **Step 1: Verify user has confirmed import**

The user should have replied "imported" or similar. If not, this task waits.

- [ ] **Step 2: Capture variable definitions via MCP**

The controller calls `mcp__figma__get_variable_defs` with no nodeId (uses currently-selected node in Figma desktop, which should be the file populated in Task 8). Save the result to a JSON file.

```js
// Pseudo-instructions for the controller:
//   Call mcp__figma__get_variable_defs.
//   Take the response (JSON object).
//   Write it as JSON.stringify(response, null, 2) to the fixture file:
//     plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json
//   This REPLACES the synthetic fixture from Task 7 Step 8.
```

If the response is empty `{}` or missing variables, the import didn't take. Ask the user to re-run the plugin and confirm; do not commit a broken fixture.

- [ ] **Step 3: Run figma.test.js and round-trip.test.js**

```bash
cd /Users/hhff/Documents/Code/adhd/plugins/adhd/lib/to-dtcg
node --test __tests__/figma.test.js __tests__/round-trip.test.js
```

Expected behavior:
- **If the tests pass:** great, the real fixture matches our synthetic shape closely enough that no parser changes are needed. Skip to Step 5.
- **If the tests fail:** the diff between expected `sample.dtcg.json` and the actual cli.js output (against the real fixture) reveals where our synthetic fixture differed from real Figma data. Common causes:
  - Real Figma uses different mode IDs, or different field names like `description`, `hiddenFromPublishing`, etc., that our parser doesn't handle but exists alongside.
  - Real Figma represents some types (e.g., FLOAT for spacing) differently than we synthesized.
  - The plugin we used for import named modes differently (e.g., "Light"/"Dark" vs "light"/"dark"). We need them to be exactly "Light" and "Dark" for our parser. If they differ, fix in the imported file or in our parser.

- [ ] **Step 4: Fix the parser if tests fail**

If the diff reveals parser bugs, edit `parseFigmaResponse` in `plugins/adhd/lib/to-dtcg/cli.js` to handle the real-world MCP shape. Commit fixes incrementally as you go. Re-run tests until green.

If the issue is a Figma-side data problem (e.g., modes named differently than expected), surface this as user guidance: "the plugin imported modes as 'Light Mode'/'Dark Mode' instead of 'Light'/'Dark'. Please rename them in Figma's Variables panel and re-export."

- [ ] **Step 5: Commit the real captured fixture**

Once tests pass:

```bash
git add plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json
# Plus any cli.js fixes from Step 4:
git add plugins/adhd/lib/to-dtcg/cli.js  # only if modified
git commit -m "to-dtcg: replace synthetic Figma fixture with real MCP capture from PBCAkpPnvGXWrz6H7qfH3V/adhd"
```

---

## Task 10: Update README and final commit

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/README.md`

- [ ] **Step 1: Update the README's "Refresh workflow" section**

Find the existing `## Refresh workflow` section in `plugins/adhd/lib/to-dtcg/README.md`. Replace the "Figma changes the MCP `get_variable_defs` response shape" subsection with the canonical pipeline:

Find:
```markdown
### Figma changes the MCP `get_variable_defs` response shape

If Figma's MCP response shape evolves and breaks the parser, capture a fresh fixture from a real Claude Code session:

1. Open the Figma file in Figma desktop.
2. In a Claude Code session, call `mcp__figma__get_variable_defs` (in code: `await tool('mcp__figma__get_variable_defs', { ... })` or via a quick skill invocation).
3. Write the raw response to `__fixtures__/sample-figma-response.json`.
4. Re-run `node --test __tests__/` and adjust `sample.dtcg.json` if necessary.
```

Replace with:
```markdown
### Figma changes the MCP `get_variable_defs` response shape

The fixture `__fixtures__/sample-figma-response.json` is a **real captured response** from the canonical demo file at `https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd`. It is NOT synthetic.

To refresh after a Figma MCP shape change, re-run the canonical export-import-capture pipeline:

1. **Generate the import payload from the canonical CSS fixtures:**
   ```bash
   node cli.js \
     --source css \
     --input __fixtures__/sample-globals.css \
     --tailwind-theme __fixtures__/tailwind-v4-theme.css \
     > /tmp/adhd-import-payload.json
   ```

2. **Open the canonical Figma file** at `https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd` in Figma desktop.

3. **Clear existing variables** if any (Variables panel → delete the `Primitives` and `Semantic` collections so we start clean).

4. **Install/run the Variables JSON Import community plugin.** Paste the payload from step 1. Confirm `Primitives` and `Semantic` collections appear with the expected variables.

5. **Capture from MCP** in a Claude Code session:
   - Call `mcp__figma__get_variable_defs` (from a skill or directly).
   - Save the response (JSON-formatted, 2-space indent) to `__fixtures__/sample-figma-response.json`, replacing the existing file.

6. **Re-run tests:** `node --test __tests__/`. The figma fixture-comparison test should pass byte-equal against `sample.dtcg.json`. If it doesn't, the diff reveals where Figma's MCP shape changed; update `parseFigmaResponse` in `cli.js` to handle the new shape, then commit fixture + parser together.
```

Also update the heading section near the top of README.md to mention Plan 1.5's format:

Find:
```markdown
Output: DTCG JSON on stdout, keys sorted alphabetically, 2-space indent, trailing newline.
```

Replace with:
```markdown
Output: DTCG JSON on stdout, keys sorted alphabetically, 2-space indent, trailing newline.

The output follows [Terrazzo](https://github.com/terrazzoapp/terrazzo)'s canonical DTCG conventions:
- **Color** values are objects: `{ colorSpace: "srgb", components: [r, g, b], alpha }` (gamma-encoded sRGB floats 0–1).
- **Dimension** values are objects: `{ value, unit }` where unit is one of `rem`, `em`, `px`.
- **fontFamily** values are arrays.
- **Shadow** values are arrays of objects with structured sub-fields (offsetX/offsetY/blur/spread as dimension objects, color as a color object, optional inset boolean).
- **Modes** (Light/Dark for Semantic tokens) live in `$extensions.mode` (lowercase keys, bare values) alongside a top-level `$value` set to the Light value.

Aliases use DTCG reference syntax: `{color.gold.100}`. No `.value` suffix.
```

- [ ] **Step 2: Run all tests one final time to confirm green**

```bash
cd /Users/hhff/Documents/Code/adhd/plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all 54 tests pass.

- [ ] **Step 3: Run skill frontmatter validator (sanity check, no related changes)**

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
```

Expected: all 3 skills pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/README.md
git commit -m "to-dtcg: update README with Terrazzo format reference and canonical fixture-refresh pipeline"
```

- [ ] **Step 5: Final report**

Print:

```
Plan 1.5 (DTCG format compliance) complete.

Files changed:
  plugins/adhd/lib/to-dtcg/cli.js                         (refactored ~200 lines, deleted 30)
  plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css (added --shadow-md)
  plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css (added --shadow-2xs)
  plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json   (rewrote in new format)
  plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json (real captured from PBCAkpPnvGXWrz6H7qfH3V/adhd)
  plugins/adhd/lib/to-dtcg/__tests__/dimension.test.js     (new — 8 tests)
  plugins/adhd/lib/to-dtcg/__tests__/font-family.test.js   (new — 6 tests)
  plugins/adhd/lib/to-dtcg/__tests__/color.test.js         (new — 12 tests)
  plugins/adhd/lib/to-dtcg/__tests__/shadow.test.js        (new — 9 tests)
  plugins/adhd/lib/to-dtcg/__tests__/color-value.test.js   (new — 5 tests)
  plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js         (rewrote — 3 tests, removed 4)
  plugins/adhd/lib/to-dtcg/__tests__/css.test.js           (passes against new fixture)
  plugins/adhd/lib/to-dtcg/__tests__/figma.test.js         (modified — partial-domain check)
  plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js    (modified — partial-domain check)
  plugins/adhd/lib/to-dtcg/README.md                       (Terrazzo reference + new refresh workflow)
  docs/superpowers/specs/2026-05-09-adhd-restructure-design.md (Section 5 mode example updated)

Test count: 54 tests, 100% pass

Acceptance criteria covered (from spec):
  AC 1: oklchToColorValue returns ColorValue object — VERIFIED via tests
  AC 2: rgbObjectToColorValue packages floats directly — VERIFIED via tests
  AC 3: parseCssDimension parses standard units — VERIFIED via tests
  AC 4: parseFontFamily splits and trims — VERIFIED via tests
  AC 5-7: parseCssShadow single/multi/inset — VERIFIED via tests
  AC 8: Semantic token shape — VERIFIED via css.test.js byte-equal
  AC 9: cli.js css mode produces sample.dtcg.json byte-equal — VERIFIED
  AC 10: cli.js figma mode produces sample.dtcg.json (color+spacing) — VERIFIED with real captured fixture
  AC 11: Round-trip css and figma agree (color+spacing) — VERIFIED
  AC 12: Phase B import succeeded — VERIFIED via user's manual import in Task 8
  AC 13: Phase B capture round-tripped — VERIFIED via Task 9 fixture replacement + tests
  AC 14: README updated — VERIFIED in Task 10
  AC 15: CI continues to pass — pending first push to GitHub (existing CI workflow picks up new tests automatically)

Next steps:
  - Push to GitHub; verify CI runs green.
  - Proceed to Plan 2 (writing-plans for /adhd:export-for-figma + /adhd:config simplification).
```

---

## Self-review

**Spec coverage:** every section of the spec maps to a task:
- §"Format mismatches to fix" #1 (mode encoding) → Task 7 Step 5
- §"Format mismatches to fix" #2 (color values) → Tasks 5, 6 + Task 7 Steps 3, 6
- §"Format mismatches to fix" #3 (dimension values) → Task 1 + Task 7 Step 3
- §"Format mismatches to fix" #4 (fontFamily) → Task 2 + Task 7 Step 3
- §"Format mismatches to fix" #5 (shadow) → Task 4 + Task 7 Step 3
- §"Component additions to cli.js" → Tasks 1-6 + Task 7
- §"Phase A" — Tasks 1-7
- §"Phase B" — Tasks 8-10
- All ACs (1-15) referenced in the final report (Task 10 Step 5)

**Placeholder scan:** every step shows actual code or commands. The Phase B pseudo-instruction in Task 9 Step 2 is necessary (the controller doesn't have direct file-write API for MCP responses; it has Write-tool access). Acceptable.

**Type / signature consistency:**
- `parseCssDimension(raw) → { value, unit } | null` — used in Tasks 1, 4 (parseCssShadow), 7 (normalizeCssValue, parseFigmaResponse).
- `parseCssColor(raw) → ColorValue` — used in Tasks 3, 4 (parseCssShadow), 7 (normalizeCssValue).
- `parseCssShadow(raw) → ShadowValue[]` — always returns array; used in Task 7 (normalizeCssValue).
- `oklchToColorValue(L, C, h) → ColorValue` — used in Task 7 normalizeCssValue (replacing oklchToHex usage).
- `rgbObjectToColorValue({r, g, b, a}) → ColorValue` — used in Task 7 parseFigmaResponse resolveValue.
- `round4(n) → number` — shared utility, used in `parseCssColor`, `oklchToColorValue`, `rgbObjectToColorValue`.

**Determinism check:** `sortKeysDeep` already sorts keys (carried from Plan 1; no change needed in Plan 1.5). `round4` ensures float stability across runs. The fixture in Step 7 of Task 7 has all keys alphabetized.

**Phase B handoff clarity:** Task 8 ends explicitly without a commit and prints user-facing instructions. Task 9 begins explicitly waiting on user confirmation. The boundary is clear — no risk of a subagent accidentally trying to do Step 9 without the user's import being complete.
