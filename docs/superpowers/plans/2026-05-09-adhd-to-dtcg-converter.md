# ADHD to-dtcg Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `plugins/adhd/lib/to-dtcg/cli.js` deterministic converter, the `adhd:to-dtcg` model-invocable skill that wraps it, and the GitHub Actions CI workflow that exercises it via fixture-based unit tests. This is unit 1 of four for the ADHD restructure (per spec `2026-05-09-adhd-restructure-design.md`).

**Architecture:** A single zero-dependency Node.js script (`cli.js`) does all CSS↔DTCG and Figma-MCP-response↔DTCG conversion deterministically (sorted keys, stable formatting). It accepts `--source css|figma --input <path>` and writes DTCG JSON to stdout. Tests run via `node --test` against checked-in fixtures, no API calls or network. The companion `adhd:to-dtcg` skill is a thin orchestrator: it shells out to `cli.js` for css mode, and for figma mode it captures the MCP response to a temp file and shells out. CI runs the unit tests on every push and PR.

**Tech Stack:** Plain JavaScript (no TypeScript, no build step), Node.js 20+ stdlib only (`node:fs`, `node:path`, `node:test`, `node:assert`, `node:child_process`), GitHub Actions.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` (Components 1, 2, 7).

---

## File map

**Create:**
- `plugins/adhd/lib/to-dtcg/cli.js` — the converter; dispatches by `--source`; ~300 lines including inline OKLCH math.
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css` — minimal user globals.css (gold scale + brand-surface semantic).
- `plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css` — pruned snapshot of node_modules/tailwindcss/theme.css containing red-500 only (smoke test for OKLCH and merge).
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json` — synthetic Figma MCP response covering the same tokens as the CSS fixture.
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json` — expected DTCG output (round-trip target). Both CSS and Figma fixtures must produce this byte-for-byte.
- `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js` — unit tests for OKLCH→hex math.
- `plugins/adhd/lib/to-dtcg/__tests__/css.test.js` — end-to-end CSS source test.
- `plugins/adhd/lib/to-dtcg/__tests__/figma.test.js` — end-to-end Figma source test.
- `plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js` — assert CSS and Figma fixtures both produce identical sample.dtcg.json.
- `plugins/adhd/lib/to-dtcg/README.md` — fixture refresh workflow.
- `plugins/adhd/skills/to-dtcg/SKILL.md` — model-invocable skill that wraps cli.js.
- `scripts/validate-skill-frontmatter.js` — CI hygiene check (~50 lines).
- `.github/workflows/ci.yml` — two-job workflow.

**Not modified by this plan** (later units handle these): the existing `/adhd:config` and `/adhd:sync` skills.

## Validation strategy

This plan ships actual code, so it's TDD-friendly. Every cli.js capability lands with a failing test first, then passes. Plan finishes when `node --test plugins/adhd/lib/to-dtcg/__tests__/` returns a clean pass and the GitHub Actions CI runs green on the first push to main.

## Important conventions

- **All keys in DTCG output are sorted alphabetically at every object level.** This makes byte-equal fixture tests possible.
- **All values use 2-space indentation, LF line endings, trailing newline.** Standard `JSON.stringify(obj, null, 2) + '\n'` after key-sorting.
- **OKLCH math is hand-rolled inline** (vendored from colorjs.io's MIT-licensed conversion code). No `culori`, no npm dependencies.
- **CSS parsing is regex-based**, not a real CSS parser. The blocks we recognize have a known shape because ADHD owns them.
- **Figma MCP response shape:** based on Figma's REST API documentation. The synthetic fixture uses that shape. If the actual MCP differs in production, we update the fixture (documented in the README).

---

## Task 1: Scaffold directory + cli.js skeleton

**Files:**
- Create: `plugins/adhd/lib/to-dtcg/cli.js`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p plugins/adhd/lib/to-dtcg/__fixtures__
mkdir -p plugins/adhd/lib/to-dtcg/__tests__
```

- [ ] **Step 2: Write the minimal cli.js**

Create `plugins/adhd/lib/to-dtcg/cli.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * ADHD to-dtcg converter.
 *
 * Usage:
 *   node cli.js --source css --input <path> [--tailwind-theme <path|none>]
 *   node cli.js --source figma --input <path>
 *
 * Output: DTCG-formatted JSON to stdout (keys sorted, 2-space indent, trailing newline).
 * Exit codes: 0 = success, 1 = parse error, 2 = bad arguments.
 *
 * Spec: docs/superpowers/specs/2026-05-09-adhd-restructure-design.md
 */

function main(argv) {
  // TODO: implemented in Task 2
  process.stderr.write('cli.js: not yet implemented\n');
  process.exit(2);
}

main(process.argv.slice(2));
```

- [ ] **Step 3: Verify it runs**

Run: `node plugins/adhd/lib/to-dtcg/cli.js`
Expected: exit code 2, stderr says "cli.js: not yet implemented".

```bash
node plugins/adhd/lib/to-dtcg/cli.js
echo "exit=$?"
```

Expected output: `cli.js: not yet implemented` and `exit=2`.

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js
git commit -m "Scaffold to-dtcg converter skeleton"
```

---

## Task 2: CLI argument parsing

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/args.test.js`

- [ ] **Step 1: Write the failing test**

Create `plugins/adhd/lib/to-dtcg/__tests__/args.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseArgs } = require('../cli.js');

test('parseArgs: --source css --input foo.css', () => {
  const args = parseArgs(['--source', 'css', '--input', 'foo.css']);
  assert.equal(args.source, 'css');
  assert.equal(args.input, 'foo.css');
  assert.equal(args.tailwindTheme, undefined);
});

test('parseArgs: --source figma --input bar.json', () => {
  const args = parseArgs(['--source', 'figma', '--input', 'bar.json']);
  assert.equal(args.source, 'figma');
  assert.equal(args.input, 'bar.json');
});

test('parseArgs: --tailwind-theme none', () => {
  const args = parseArgs(['--source', 'css', '--input', 'a.css', '--tailwind-theme', 'none']);
  assert.equal(args.tailwindTheme, 'none');
});

test('parseArgs: --tailwind-theme path', () => {
  const args = parseArgs(['--source', 'css', '--input', 'a.css', '--tailwind-theme', '/x/theme.css']);
  assert.equal(args.tailwindTheme, '/x/theme.css');
});

test('parseArgs: missing --source throws', () => {
  assert.throws(() => parseArgs(['--input', 'a.css']), /--source is required/);
});

test('parseArgs: invalid --source value throws', () => {
  assert.throws(() => parseArgs(['--source', 'xml', '--input', 'a.css']), /--source must be "css" or "figma"/);
});

test('parseArgs: missing --input throws', () => {
  assert.throws(() => parseArgs(['--source', 'css']), /--input is required/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/args.test.js
```

Expected: all tests fail with `parseArgs is not a function` or similar (because cli.js doesn't export it yet).

- [ ] **Step 3: Implement parseArgs and export**

Replace the contents of `plugins/adhd/lib/to-dtcg/cli.js` with:

```js
#!/usr/bin/env node
'use strict';

/**
 * ADHD to-dtcg converter.
 *
 * Usage:
 *   node cli.js --source css --input <path> [--tailwind-theme <path|none>]
 *   node cli.js --source figma --input <path>
 *
 * Output: DTCG-formatted JSON to stdout (keys sorted, 2-space indent, trailing newline).
 * Exit codes: 0 = success, 1 = parse error, 2 = bad arguments.
 *
 * Spec: docs/superpowers/specs/2026-05-09-adhd-restructure-design.md
 */

function parseArgs(argv) {
  const out = { source: undefined, input: undefined, tailwindTheme: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--source') { out.source = value; i++; }
    else if (flag === '--input') { out.input = value; i++; }
    else if (flag === '--tailwind-theme') { out.tailwindTheme = value; i++; }
    else { throw new Error(`Unknown argument: ${flag}`); }
  }
  if (!out.source) throw new Error('--source is required (must be "css" or "figma")');
  if (out.source !== 'css' && out.source !== 'figma') {
    throw new Error('--source must be "css" or "figma"');
  }
  if (!out.input) throw new Error('--input is required');
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`cli.js: ${err.message}\n`);
    process.exit(2);
  }
  // TODO: dispatch by args.source — implemented in later tasks.
  process.stderr.write('cli.js: source dispatch not yet implemented\n');
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { parseArgs };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/args.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/args.test.js
git commit -m "to-dtcg: implement CLI argument parsing"
```

---

## Task 3: OKLCH → hex conversion

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js`

- [ ] **Step 1: Write the failing tests**

Create `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { oklchToHex } = require('../cli.js');

// Tailwind v4's red-500 is oklch(63.7% 0.237 25.331). The hex equivalent
// computed via the OKLCH → OKLab → sRGB pipeline (Ottosson) is ~#fb2c36.
// This differs from Tailwind v3's literal #ef4444; v4 redefined the palette
// in OKLCH and the sRGB equivalents shifted slightly.
test('oklch red-500 → ~#fb2c36 (Tailwind v4)', () => {
  const hex = oklchToHex(0.637, 0.237, 25.331);
  // Allow ±1 LSB per channel for OKLCH→sRGB precision drift.
  assertHexCloseTo(hex, '#fb2c36', 1);
});

// Tailwind v4's gold-100-ish: oklch(95% 0.05 96)
test('oklch low-chroma yellow stays in gamut', () => {
  const hex = oklchToHex(0.95, 0.05, 96);
  // Should be a light yellow; alpha implicit
  assert.match(hex, /^#[0-9a-f]{6}$/);
});

// Pure black
test('oklch L=0 → #000000', () => {
  const hex = oklchToHex(0, 0, 0);
  assert.equal(hex, '#000000');
});

// Pure white
test('oklch L=1 C=0 → #ffffff', () => {
  const hex = oklchToHex(1, 0, 0);
  assert.equal(hex, '#ffffff');
});

function assertHexCloseTo(actual, expected, tolerance) {
  const a = parseHex(actual);
  const e = parseHex(expected);
  for (const ch of ['r', 'g', 'b']) {
    assert.ok(
      Math.abs(a[ch] - e[ch]) <= tolerance,
      `channel ${ch}: actual=${a[ch]}, expected=${e[ch]}, tol=${tolerance}`
    );
  }
}

function parseHex(h) {
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/oklch.test.js
```

Expected: tests fail with `oklchToHex is not a function`.

- [ ] **Step 3: Implement oklchToHex (vendored math from colorjs.io)**

In `plugins/adhd/lib/to-dtcg/cli.js`, add the conversion functions BEFORE `parseArgs`. Append to the `module.exports` at the bottom.

Insert this block after the leading docstring comment:

```js
// ============================================================
// OKLCH → hex conversion (vendored from colorjs.io, MIT)
// ============================================================
//
// Pipeline: OKLCH → OKLab → linear sRGB → companded sRGB → 8-bit hex.

function oklchToOklab(L, C, h) {
  const hRad = (h * Math.PI) / 180;
  return {
    L,
    a: C * Math.cos(hRad),
    b: C * Math.sin(hRad),
  };
}

function oklabToLinearSrgb({ L, a, b }) {
  // Inverse of OKLab forward matrix from Björn Ottosson's paper.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function linearToCompandedSrgb(c) {
  // sRGB transfer function (gamma encoding).
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp01(c) {
  return Math.max(0, Math.min(1, c));
}

function channelToHex(c) {
  const v = Math.round(clamp01(c) * 255);
  return v.toString(16).padStart(2, '0');
}

function oklchToHex(L, C, h) {
  const lab = oklchToOklab(L, C, h);
  const lin = oklabToLinearSrgb(lab);
  const r = linearToCompandedSrgb(lin.r);
  const g = linearToCompandedSrgb(lin.g);
  const b = linearToCompandedSrgb(lin.b);
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}
```

Update the `module.exports` line at the bottom of the file:

```js
module.exports = { parseArgs, oklchToHex };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/oklch.test.js
```

Expected: all 4 tests pass. If red-500 fails, the math is wrong — re-check the formula against colorjs.io.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js
git commit -m "to-dtcg: implement OKLCH→hex conversion"
```

---

## Task 4: CSS fixture (primitives only, no Tailwind merge)

**Files:**
- Create: `plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css`
- Create: `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json`

These fixtures pin down the expected behavior of the CSS path. Their exact content matters because byte-equal tests compare against them.

- [ ] **Step 1: Create the input fixture**

Write `plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-gold-100: #faf0c5;
  --color-gold-900: #3f2909;
  --spacing-4: 1rem;
}

:root {
  --brand-surface: var(--color-gold-100);
}

@media (prefers-color-scheme: dark) {
  :root {
    --brand-surface: var(--color-gold-900);
  }
}

@theme inline {
  --color-brand-surface: var(--brand-surface);
}
```

- [ ] **Step 2: Create the expected output fixture**

Write `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json`:

```json
{
  "color": {
    "brand": {
      "surface": {
        "$extensions": {
          "com.figma": {
            "modes": {
              "Dark": {
                "$value": "{color.gold.900}"
              },
              "Light": {
                "$value": "{color.gold.100}"
              }
            }
          }
        },
        "$type": "color"
      }
    },
    "gold": {
      "100": {
        "$type": "color",
        "$value": "#faf0c5"
      },
      "900": {
        "$type": "color",
        "$value": "#3f2909"
      }
    }
  },
  "spacing": {
    "4": {
      "$type": "dimension",
      "$value": "1rem"
    }
  }
}
```

End the file with a single trailing newline (no extra blank line).

- [ ] **Step 3: Verify the fixture parses as JSON**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json', 'utf8')))" | head -5
```

Expected: prints the top of the parsed object (`{ color: { brand: ... }`).

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json
git commit -m "to-dtcg: add CSS-mode fixtures (input + expected DTCG output)"
```

---

## Task 5: CSS source — parse @theme and produce DTCG primitives

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/css.test.js`

This task wires up the FULL CSS path end-to-end for the fixture from Task 4. It implements parsing `@theme {}`, parsing `:root {}` + `@media dark`, alias resolution, DTCG output with stable key sorting, and the main dispatcher.

- [ ] **Step 1: Write the failing end-to-end test**

Create `plugins/adhd/lib/to-dtcg/__tests__/css.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('css source: produces expected DTCG byte-for-byte', () => {
  const out = execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', 'none',
  ], { encoding: 'utf8' });

  const expected = fs.readFileSync(path.join(fixturesDir, 'sample.dtcg.json'), 'utf8');
  assert.equal(out, expected);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/css.test.js
```

Expected: fail with non-zero exit from cli.js (source dispatch not implemented).

- [ ] **Step 3: Implement the CSS path**

In `plugins/adhd/lib/to-dtcg/cli.js`, add these functions AFTER `oklchToHex` and BEFORE `parseArgs`:

```js
// ============================================================
// CSS parsing
// ============================================================

const ADHD_PRIMITIVE_PREFIXES = [
  'color', 'spacing', 'radius', 'shadow', 'font', 'text', 'font-weight', 'leading',
];

const NAMESPACE_TO_DTCG_TYPE = {
  color: 'color',
  spacing: 'dimension',
  radius: 'dimension',
  shadow: 'shadow',
  font: 'fontFamily',
  text: 'dimension',
  'font-weight': 'fontWeight',
  leading: 'number',
};

const NAMESPACE_TO_DTCG_PATH = {
  color: 'color',
  spacing: 'spacing',
  radius: 'radius',
  shadow: 'shadow',
  font: 'font',
  text: 'text',
  'font-weight': 'fontWeight',
  leading: 'leading',
};

// Match a top-level `@theme {` block (NOT @theme inline / @theme default).
// Returns { body, end } or null. The caller should slice the input to skip past `end`.
function findAtThemeBlock(text, label /* 'theme' or 'theme inline' or 'theme default' */) {
  // Build a regex: `@theme\b(?: inline)?\s*{`. We match by exact label.
  const labelEsc = label === 'theme' ? '@theme(?!\\s+(inline|default))' :
                   label === 'theme inline' ? '@theme\\s+inline' :
                   '@theme\\s+default';
  const re = new RegExp(`${labelEsc}\\s*\\{`, 'g');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = matchClosingBrace(text, start);
  if (end < 0) return null;
  return { body: text.slice(start, end), end: end + 1 };
}

function matchClosingBrace(text, openIdx) {
  let depth = 1;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Find a top-level `:root {` block that is NOT inside `@media (prefers-color-scheme: dark)`.
function findRootBlock(text) {
  const re = /:root\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Check whether this :root is inside @media dark by counting nested @media
    // before this index. Cheap heuristic: look at the chunk before m.index for
    // an open `@media (prefers-color-scheme: dark) {` whose closing brace is
    // after m.index.
    if (isInsideMediaDark(text, m.index)) continue;
    const start = m.index + m[0].length;
    const end = matchClosingBrace(text, start);
    if (end < 0) continue;
    return { body: text.slice(start, end), end: end + 1 };
  }
  return null;
}

function findMediaDarkBlock(text) {
  const mediaRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  const m = mediaRe.exec(text);
  if (!m) return null;
  const mediaBodyStart = m.index + m[0].length;
  const mediaBodyEnd = matchClosingBrace(text, mediaBodyStart);
  if (mediaBodyEnd < 0) return null;
  const mediaBody = text.slice(mediaBodyStart, mediaBodyEnd);
  // Find :root inside this body.
  const rootRe = /:root\s*\{/g;
  const rm = rootRe.exec(mediaBody);
  if (!rm) return null;
  const rootBodyStart = rm.index + rm[0].length;
  const rootBodyEnd = matchClosingBrace(mediaBody, rootBodyStart);
  if (rootBodyEnd < 0) return null;
  return { body: mediaBody.slice(rootBodyStart, rootBodyEnd) };
}

function isInsideMediaDark(text, idx) {
  // Walk backward from idx looking for nearest `@media (prefers-color-scheme: dark)`
  // whose matching `}` is after idx.
  const before = text.slice(0, idx);
  const lastMedia = before.lastIndexOf('@media');
  if (lastMedia < 0) return false;
  const mediaSlice = text.slice(lastMedia);
  const mediaMatch = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/.exec(mediaSlice);
  if (!mediaMatch) return false;
  const mediaBodyStart = lastMedia + mediaMatch[0].length;
  const mediaBodyEnd = matchClosingBrace(text, mediaBodyStart);
  if (mediaBodyEnd < 0) return false;
  return idx >= mediaBodyStart && idx < mediaBodyEnd;
}

// Parse `--name: value;` declarations from a block body. Handles multi-line values.
function parseDeclarations(body) {
  const out = []; // [{ name, value }]
  // Split on `;` but careful: values can contain `;` only if quoted. CSS variable
  // values for ADHD's domains don't contain unquoted semicolons.
  const re = /(--[a-z][a-z0-9-]*)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({ name: m[1], value: m[2].trim() });
  }
  return out;
}

// Map a CSS variable name (e.g., --color-gold-100) to (namespace, dot-path-suffix).
// Returns null if the name isn't ADHD-managed.
function variableNameToDtcg(varName) {
  // Strip leading `--`.
  const stripped = varName.replace(/^--/, '');
  for (const prefix of ADHD_PRIMITIVE_PREFIXES) {
    if (stripped === prefix) continue; // e.g., bare --color (not a token)
    const prefixDash = prefix + '-';
    if (stripped.startsWith(prefixDash)) {
      const rest = stripped.slice(prefixDash.length);
      // rest is like "gold-100" or "md" or "sans"; convert dashes to dots.
      const restDots = rest.replace(/-/g, '.');
      return { namespace: prefix, dtcgPath: `${NAMESPACE_TO_DTCG_PATH[prefix]}.${restDots}` };
    }
  }
  return null;
}

// Given a CSS value, normalize for DTCG:
// - var(--color-gold-100) → "{color.gold.100}"
// - hex stays
// - rem/px stays
// - oklch(...) is converted to hex (only via Tailwind merge path)
function normalizeCssValue(raw, namespace) {
  raw = raw.trim();
  // Alias?
  const aliasMatch = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(raw);
  if (aliasMatch) {
    const target = variableNameToDtcg(aliasMatch[1]);
    if (target) return `{${target.dtcgPath}}`;
    // Reference to a non-ADHD variable — pass through as-is, keep var() form.
    return raw;
  }
  // OKLCH? oklch(L% C H) or oklch(L% C H / a)
  const oklchMatch = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(raw);
  if (oklchMatch) {
    const L = parseFloat(oklchMatch[1]) / 100;
    const C = parseFloat(oklchMatch[2]);
    const H = parseFloat(oklchMatch[3]);
    return oklchToHex(L, C, H);
  }
  // Pass-through (hex, rem, number, font stack, etc.)
  return raw;
}

function parseCssTokens(cssText) {
  const result = {
    primitives: [], // [{ namespace, dtcgPath, value, dtcgType }]
    semanticLight: [],
    semanticDark: [],
  };
  const themeBlock = findAtThemeBlock(cssText, 'theme');
  if (themeBlock) {
    for (const decl of parseDeclarations(themeBlock.body)) {
      const mapped = variableNameToDtcg(decl.name);
      if (!mapped) continue;
      const dtcgType = NAMESPACE_TO_DTCG_TYPE[mapped.namespace];
      const value = normalizeCssValue(decl.value, mapped.namespace);
      result.primitives.push({ ...mapped, value, dtcgType });
    }
  }
  const rootBlock = findRootBlock(cssText);
  if (rootBlock) {
    for (const decl of parseDeclarations(rootBlock.body)) {
      // Semantic role: variable name doesn't match an ADHD primitive prefix.
      // It's a free-form name like `brand-surface` or `background`.
      // We treat it as a semantic role under the `color` namespace by default
      // (semantic roles are color-typed in v1; future versions may type per
      // alias target).
      if (variableNameToDtcg(decl.name)) continue; // skip primitive-prefixed
      const stripped = decl.name.replace(/^--/, '');
      const dtcgPath = `color.${stripped.replace(/-/g, '.')}`;
      const value = normalizeCssValue(decl.value, 'color');
      result.semanticLight.push({ namespace: 'color', dtcgPath, value, dtcgType: 'color' });
    }
  }
  const darkBlock = findMediaDarkBlock(cssText);
  if (darkBlock) {
    for (const decl of parseDeclarations(darkBlock.body)) {
      if (variableNameToDtcg(decl.name)) continue;
      const stripped = decl.name.replace(/^--/, '');
      const dtcgPath = `color.${stripped.replace(/-/g, '.')}`;
      const value = normalizeCssValue(decl.value, 'color');
      result.semanticDark.push({ namespace: 'color', dtcgPath, value, dtcgType: 'color' });
    }
  }
  return result;
}

// ============================================================
// DTCG output construction
// ============================================================

function setNested(obj, dotPath, leaf) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = leaf;
}

function buildDtcgFromCssTokens(tokens) {
  const root = {};
  // Primitives
  for (const t of tokens.primitives) {
    setNested(root, t.dtcgPath, { $type: t.dtcgType, $value: t.value });
  }
  // Semantic — combine Light + Dark by dtcgPath
  const semByPath = new Map();
  for (const t of tokens.semanticLight) {
    semByPath.set(t.dtcgPath, { type: t.dtcgType, light: t.value, dark: undefined });
  }
  for (const t of tokens.semanticDark) {
    const existing = semByPath.get(t.dtcgPath) || { type: t.dtcgType, light: undefined, dark: undefined };
    existing.dark = t.value;
    semByPath.set(t.dtcgPath, existing);
  }
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
  return root;
}

// Sort all object keys alphabetically (recursively). Arrays preserve order.
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
  return out;
}

function stringifyDtcgStable(obj) {
  return JSON.stringify(sortKeysDeep(obj), null, 2) + '\n';
}
```

Now update `main` to dispatch on `args.source`:

```js
function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`cli.js: ${err.message}\n`);
    process.exit(2);
  }
  try {
    let dtcg;
    if (args.source === 'css') {
      const cssText = require('fs').readFileSync(args.input, 'utf8');
      const tokens = parseCssTokens(cssText);
      // Tailwind merge — fully wired up in Task 6. The body below works once Task 6's parseTailwindTheme is implemented.
      if (args.tailwindTheme && args.tailwindTheme !== 'none') {
        const themeText = require('fs').readFileSync(args.tailwindTheme, 'utf8');
        const themeTokens = parseTailwindTheme(themeText);
        // User tokens override theme defaults by dtcgPath.
        const seen = new Set(tokens.primitives.map(p => p.dtcgPath));
        for (const t of themeTokens) {
          if (!seen.has(t.dtcgPath)) tokens.primitives.push(t);
        }
      }
      dtcg = buildDtcgFromCssTokens(tokens);
    } else if (args.source === 'figma') {
      // Figma dispatch is filled in by Task 7.
      process.stderr.write('cli.js: --source figma not yet implemented\n');
      process.exit(1);
    }
    process.stdout.write(stringifyDtcgStable(dtcg));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`cli.js: ${err.message}\n`);
    process.exit(1);
  }
}
```

Add a stub for `parseTailwindTheme` (Task 6 implements it):

```js
function parseTailwindTheme(themeText) {
  // Implemented in Task 7.
  return [];
}
```

Update `module.exports`:

```js
module.exports = {
  parseArgs,
  oklchToHex,
  parseCssTokens,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/css.test.js
```

Expected: `css source: produces expected DTCG byte-for-byte` passes.

If the test fails due to whitespace / key-order issues, inspect with:

```bash
node cli.js --source css --input __fixtures__/sample-globals.css --tailwind-theme none > /tmp/actual.json
diff -u __fixtures__/sample.dtcg.json /tmp/actual.json
```

Fix the parser/stringifier until the diff is empty.

- [ ] **Step 5: Run all existing tests**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all tests across `args.test.js`, `oklch.test.js`, `css.test.js` pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js plugins/adhd/lib/to-dtcg/__tests__/css.test.js
git commit -m "to-dtcg: implement CSS source — parse, normalize, output DTCG"
```

---

## Task 6: Tailwind theme.css merge

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css`
- Modify: `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json`
- Modify: `plugins/adhd/lib/to-dtcg/__tests__/css.test.js`

- [ ] **Step 1: Create the minimal Tailwind theme fixture**

Write `plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css`:

```css
@theme default {
  --color-red-500: oklch(63.7% 0.237 25.331);
}
```

This is a stripped-down version of Tailwind v4's `theme.css`. The full file is 510 lines; we need only one OKLCH color to validate the merge + OKLCH path.

- [ ] **Step 2: Update the expected output fixture**

Edit `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json` to ALSO include `color.red.500`. The exact hex depends on the OKLCH math you already validated in Task 3 (should be `#fb2c36` or within ±1 LSB — Tailwind v4's red-500 is defined in OKLCH and resolves to that hex via the Ottosson pipeline, NOT to v3's literal `#ef4444`). Run:

```bash
node -e '
const { oklchToHex } = require("./plugins/adhd/lib/to-dtcg/cli.js");
console.log(oklchToHex(0.637, 0.237, 25.331));
'
```

Take the printed hex (should be `#fb2c36` or within ±1 LSB) and add it to `sample.dtcg.json` so the file becomes:

```json
{
  "color": {
    "brand": {
      "surface": {
        "$extensions": {
          "com.figma": {
            "modes": {
              "Dark": {
                "$value": "{color.gold.900}"
              },
              "Light": {
                "$value": "{color.gold.100}"
              }
            }
          }
        },
        "$type": "color"
      }
    },
    "gold": {
      "100": {
        "$type": "color",
        "$value": "#faf0c5"
      },
      "900": {
        "$type": "color",
        "$value": "#3f2909"
      }
    },
    "red": {
      "500": {
        "$type": "color",
        "$value": "<HEX-FROM-OKLCH>"
      }
    }
  },
  "spacing": {
    "4": {
      "$type": "dimension",
      "$value": "1rem"
    }
  }
}
```

Substitute `<HEX-FROM-OKLCH>` with the actual hex you printed.

- [ ] **Step 3: Update the css test to use the Tailwind theme fixture**

Replace the body of `plugins/adhd/lib/to-dtcg/__tests__/css.test.js` with:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('css source with tailwind merge: produces expected DTCG byte-for-byte', () => {
  const out = execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' });

  const expected = fs.readFileSync(path.join(fixturesDir, 'sample.dtcg.json'), 'utf8');
  assert.equal(out, expected);
});

test('css source with --tailwind-theme none: omits tailwind defaults', () => {
  const out = execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', 'none',
  ], { encoding: 'utf8' });

  const parsed = JSON.parse(out);
  assert.equal(parsed.color.red, undefined, 'red should NOT be present when --tailwind-theme none');
  assert.ok(parsed.color.gold, 'gold should be present (user-defined)');
});
```

- [ ] **Step 4: Run test — expect Tailwind-merge test to fail (parseTailwindTheme is a stub)**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/css.test.js
```

Expected: the merge test fails (red.500 missing); the `none` test passes.

- [ ] **Step 5: Implement parseTailwindTheme**

Replace the stub `parseTailwindTheme` in `cli.js` with:

```js
function parseTailwindTheme(themeText) {
  // Tailwind v4's theme.css uses `@theme default { ... }`.
  const block = findAtThemeBlock(themeText, 'theme default');
  if (!block) return [];
  const out = [];
  // theme.css contains multi-line values (e.g., font-sans across multiple lines).
  // Our parseDeclarations regex matches up to the next `;`, which handles multi-line.
  for (const decl of parseDeclarations(block.body)) {
    const mapped = variableNameToDtcg(decl.name);
    if (!mapped) continue;
    const value = normalizeCssValue(decl.value, mapped.namespace);
    out.push({ ...mapped, value, dtcgType: NAMESPACE_TO_DTCG_TYPE[mapped.namespace] });
  }
  return out;
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/css.test.js
```

Expected: both tests pass. If the merge test still fails, dump and diff:

```bash
node cli.js --source css --input __fixtures__/sample-globals.css --tailwind-theme __fixtures__/tailwind-v4-theme.css > /tmp/actual.json
diff -u __fixtures__/sample.dtcg.json /tmp/actual.json
```

If the diff shows only different hex values (e.g., `#fb2c36` vs `#fb2c37`), update `sample.dtcg.json` to match the actual output rather than chasing OKLCH precision tweaks. The unit test in Task 3 already validated the math is correct within ±1 LSB.

- [ ] **Step 7: Run ALL tests**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: every test passes.

- [ ] **Step 8: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js \
        plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css \
        plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json \
        plugins/adhd/lib/to-dtcg/__tests__/css.test.js
git commit -m "to-dtcg: implement Tailwind theme.css merge"
```

---

## Task 7: Figma source — parser + alias resolution + modes

**Files:**
- Modify: `plugins/adhd/lib/to-dtcg/cli.js`
- Create: `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json`
- Create: `plugins/adhd/lib/to-dtcg/__tests__/figma.test.js`

- [ ] **Step 1: Create the synthetic Figma MCP response fixture**

Write `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json`. The shape mirrors Figma's REST API `/v1/files/:key/variables/local` response (which is what the MCP wraps).

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
          "primDefault": { "r": 0.9843, "g": 0.1725, "b": 0.2118, "a": 1 }
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

**Notes on this fixture:**
- The hex equivalents of the gold and red RGB values must round-trip to the same hex strings as the CSS fixture. The user's globals.css has `--color-gold-100: #faf0c5` (which is `(250, 240, 197)` = `(0.9804, 0.9412, 0.7725)`); the fixture above mirrors this. Same for gold-900 (`#3f2909` = `(63, 41, 9)` = `(0.2471, 0.1608, 0.0353)`) and red-500 (`#fb2c36` = `(251, 44, 54)` = `(0.9843, 0.1725, 0.2118)` — this is what Tailwind v4's `oklch(63.7% 0.237 25.331)` resolves to via the Ottosson pipeline).
- Spacing values come back as strings ("1rem"); we keep them as-is.
- Aliases use `{ "type": "VARIABLE_ALIAS", "id": "<other-var-id>" }` (Figma's documented format).

- [ ] **Step 2: Write the failing figma test**

Create `plugins/adhd/lib/to-dtcg/__tests__/figma.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('figma source: produces expected DTCG byte-for-byte', () => {
  const out = execFileSync('node', [
    cliPath,
    '--source', 'figma',
    '--input', path.join(fixturesDir, 'sample-figma-response.json'),
  ], { encoding: 'utf8' });

  const expected = fs.readFileSync(path.join(fixturesDir, 'sample.dtcg.json'), 'utf8');
  assert.equal(out, expected);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/figma.test.js
```

Expected: fail with "--source figma not yet implemented" or similar.

- [ ] **Step 4: Implement the Figma source path**

In `cli.js`, add these functions BEFORE `main`:

```js
// ============================================================
// Figma MCP response parsing
// ============================================================

function rgbObjectToHex({ r, g, b, a }) {
  const ch = (c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0');
  if (a !== undefined && a < 1) {
    const aCh = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
    return `#${ch(r)}${ch(g)}${ch(b)}${aCh}`;
  }
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

function figmaVariableNameToDtcg(name) {
  // "colors/gold/100" → { namespace: "color", dtcgPath: "color.gold.100" }
  // "colors/brand/surface" → { namespace: "color", dtcgPath: "color.brand.surface" }
  // "spacing/4" → { namespace: "spacing", dtcgPath: "spacing.4" }
  const parts = name.split('/');
  if (parts.length < 2) return null;
  const figmaNs = parts[0];
  const FIGMA_NS_TO_NS = {
    colors: 'color',
    spacing: 'spacing',
    radius: 'radius',
    shadow: 'shadow',
    font: 'font',
    text: 'text',
    'font-weight': 'font-weight',
    leading: 'leading',
  };
  const namespace = FIGMA_NS_TO_NS[figmaNs];
  if (!namespace) return null;
  const dtcgPath = NAMESPACE_TO_DTCG_PATH[namespace] + '.' + parts.slice(1).join('.');
  return { namespace, dtcgPath };
}

function parseFigmaResponse(json) {
  if (!json || !json.meta) {
    throw new Error('Invalid Figma response: missing `meta`');
  }
  const collections = json.meta.variableCollections || {};
  const variables = json.meta.variables || {};

  // Build collection ID → { name, modes: [{ id, name }] }
  const collById = {};
  for (const id of Object.keys(collections)) {
    const c = collections[id];
    collById[id] = { name: c.name, modes: c.modes || [] };
  }

  // Validate required collections.
  const primitives = Object.values(collById).find((c) => c.name === 'Primitives');
  const semantic = Object.values(collById).find((c) => c.name === 'Semantic');
  if (!primitives) throw new Error('Figma file missing `Primitives` collection');
  if (!semantic) throw new Error('Figma file missing `Semantic` collection');

  // Build variable ID → variable info, including dtcgPath.
  const varInfo = {};
  for (const id of Object.keys(variables)) {
    const v = variables[id];
    const mapped = figmaVariableNameToDtcg(v.name);
    if (!mapped) continue;
    varInfo[id] = { ...mapped, raw: v };
  }

  // Resolve a variable value (may be alias) to a DTCG value string.
  function resolveValue(value, namespace) {
    if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
      const target = varInfo[value.id];
      if (!target) throw new Error(`Unresolved alias: ${value.id}`);
      return `{${target.dtcgPath}}`;
    }
    if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
      return rgbObjectToHex(value);
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value;
    throw new Error(`Unsupported value: ${JSON.stringify(value)}`);
  }

  const out = { primitives: [], semanticLight: [], semanticDark: [] };
  for (const id of Object.keys(varInfo)) {
    const info = varInfo[id];
    const v = info.raw;
    const collection = collById[v.variableCollectionId];
    if (!collection) continue;
    const dtcgType = NAMESPACE_TO_DTCG_TYPE[info.namespace];

    if (collection.name === 'Primitives') {
      // Single mode.
      const modeId = collection.modes[0]?.modeId;
      const value = resolveValue(v.valuesByMode[modeId], info.namespace);
      out.primitives.push({ ...info, value, dtcgType });
    } else if (collection.name === 'Semantic') {
      // Two modes named Light + Dark.
      for (const m of collection.modes) {
        const value = resolveValue(v.valuesByMode[m.modeId], info.namespace);
        if (m.name === 'Light') out.semanticLight.push({ ...info, value, dtcgType });
        else if (m.name === 'Dark') out.semanticDark.push({ ...info, value, dtcgType });
        else throw new Error(`Unexpected Semantic mode: ${m.name}`);
      }
    }
  }
  return out;
}
```

Update `main` to handle figma source:

```js
} else if (args.source === 'figma') {
  const json = JSON.parse(require('fs').readFileSync(args.input, 'utf8'));
  const tokens = parseFigmaResponse(json);
  dtcg = buildDtcgFromCssTokens(tokens); // same shape input
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
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/figma.test.js
```

Expected: figma test passes byte-for-byte against the SAME `sample.dtcg.json` produced by the CSS path.

If it doesn't, dump and diff:

```bash
node cli.js --source figma --input __fixtures__/sample-figma-response.json > /tmp/actual.json
diff -u __fixtures__/sample.dtcg.json /tmp/actual.json
```

The most common issue here will be hex precision — Figma's RGB values are stored as floats (0–1), and our rounding might differ by 1 from the CSS hex. If so, adjust the fixture's RGB values to round-trip exactly to the expected hex (use `parseInt('faf0c5'.slice(0,2), 16) / 255` etc. to compute the precise value).

- [ ] **Step 6: Run ALL tests**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/
```

Expected: all four test files pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/cli.js \
        plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json \
        plugins/adhd/lib/to-dtcg/__tests__/figma.test.js
git commit -m "to-dtcg: implement Figma source — parse, resolve aliases, output DTCG"
```

---

## Task 8: Round-trip test

**Files:**
- Create: `plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js`

- [ ] **Step 1: Write the round-trip test**

Create `plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js`:

```js
'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

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

- [ ] **Step 2: Run the test**

```bash
cd plugins/adhd/lib/to-dtcg
node --test __tests__/round-trip.test.js
```

Expected: passes. Both sources produce identical bytes because:
- Both target the same `sample.dtcg.json` (verified in Tasks 5 and 7).
- Both go through `stringifyDtcgStable` which sorts keys and uses identical formatting.

If it fails, see the troubleshooting steps in Task 7 Step 5.

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/__tests__/round-trip.test.js
git commit -m "to-dtcg: add CSS↔Figma round-trip test"
```

---

## Task 9: `adhd:to-dtcg` model-invocable skill

**Files:**
- Create: `plugins/adhd/skills/to-dtcg/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

Create `plugins/adhd/skills/to-dtcg/SKILL.md`:

```markdown
---
description: "Convert design tokens between code (CSS) and Figma (MCP variable defs) representations and the canonical DTCG (Design Token Community Group) JSON shape. Used by /adhd:export-for-figma, /adhd:check, and /adhd:sync-from-figma. Wraps the deterministic Node converter at plugins/adhd/lib/to-dtcg/cli.js."
disable-model-invocation: false
allowed-tools: Read Write Bash mcp__figma__get_variable_defs
---

# ADHD to-dtcg

You are converting design tokens to DTCG JSON. There are two procedures; the caller's invocation prompt will indicate which one to run.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` (Component 2).

The skill body is intentionally thin — actual conversion logic lives in `plugins/adhd/lib/to-dtcg/cli.js`. Your job here is orchestration: run the right command, return the right output.

## Procedure A: css-to-dtcg

**Inputs:** a CSS file path (e.g., `app/globals.css`), passed by the caller.

**Steps:**

1. Determine the Tailwind theme path. Default: `node_modules/tailwindcss/theme.css`. Use `Bash` to check if the file exists:

   ```bash
   [ -f node_modules/tailwindcss/theme.css ] && echo present || echo absent
   ```

2. If present, set `THEME_ARG=node_modules/tailwindcss/theme.css`. If absent, set `THEME_ARG=none`.

3. Run the converter via `Bash`:

   ```bash
   node plugins/adhd/lib/to-dtcg/cli.js --source css --input <CALLER-PATH> --tailwind-theme <THEME_ARG>
   ```

4. The command's stdout is DTCG JSON. Return that to the caller verbatim. Include trailing newline.

5. On non-zero exit (1 = parse error, 2 = bad arguments), surface the stderr message to the caller as the failure reason.

## Procedure B: figma-to-dtcg

**Inputs:** a Figma file URL or file key, passed by the caller.

**Steps:**

1. Call `mcp__figma__get_variable_defs` with the file URL/key. Capture the full response (variable definitions for both `Primitives` and `Semantic` collections).

2. Write the response JSON to a temp file:

   ```bash
   TMPFILE=$(mktemp /tmp/adhd-figma-response.XXXXXX.json)
   ```

   Use `Write` to put the JSON content into `$TMPFILE`.

3. Run the converter via `Bash`:

   ```bash
   node plugins/adhd/lib/to-dtcg/cli.js --source figma --input "$TMPFILE"
   ```

4. The command's stdout is DTCG JSON. Return that to the caller verbatim.

5. Clean up the temp file:

   ```bash
   rm -f "$TMPFILE"
   ```

6. On non-zero exit, surface stderr to the caller. Common failures:
   - `Figma file missing `Primitives` collection` — the Figma file's structure is non-compliant.
   - `Unresolved alias: <id>` — a Semantic variable references a Primitive that doesn't exist (corrupt Figma state).

## Reference: cli.js arguments

Full CLI surface (see `plugins/adhd/lib/to-dtcg/cli.js` for the source of truth):

```
node cli.js --source <css|figma> --input <path> [--tailwind-theme <path|none>]
```

- `--source css` reads CSS text, parses ADHD-managed `@theme {}`, `:root {}`, `@media dark` blocks, and (optionally) merges Tailwind v4 defaults from `--tailwind-theme`.
- `--source figma` reads a Figma MCP `get_variable_defs` response JSON, identifies `Primitives` and `Semantic` collections, resolves aliases, and emits DTCG with mode metadata under `$extensions.com.figma.modes`.
- `--tailwind-theme none` (css mode) skips merging defaults — useful for tests where the user globals.css is the only source of truth.

Output: DTCG JSON to stdout. Keys sorted alphabetically. 2-space indent. Trailing newline.

Exit codes: 0 = success; 1 = parse error; 2 = bad arguments.
```

- [ ] **Step 2: Verify the skill is discoverable**

The user runs `/reload-plugins` and confirms the skill appears. As the implementer, you can't run `/reload-plugins` yourself — leave this as a manual verification step in the implementer's report.

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/to-dtcg/SKILL.md
git commit -m "Add adhd:to-dtcg model-invocable skill (wraps cli.js)"
```

---

## Task 10: Skill frontmatter validator script

**Files:**
- Create: `scripts/validate-skill-frontmatter.js`

- [ ] **Step 1: Write the validator**

Create `scripts/validate-skill-frontmatter.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * Validate that every plugin SKILL.md has the required frontmatter shape.
 *
 * Required keys:
 *   - description: single-line string
 *   - disable-model-invocation: boolean (true | false)
 *   - allowed-tools: space-separated string
 *
 * Optional keys (allowed but not required):
 *   - argument-hint: string
 *
 * Run: node scripts/validate-skill-frontmatter.js
 * Exit codes: 0 = all valid; 1 = at least one issue found.
 */

const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.resolve(__dirname, '..', 'plugins', 'adhd', 'skills');

function findSkillFiles() {
  const out = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (fs.existsSync(skillPath)) out.push(skillPath);
  }
  return out;
}

function parseFrontmatter(text) {
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fmMatch) throw new Error('No frontmatter found');
  const lines = fmMatch[1].split('\n');
  const obj = {};
  for (const line of lines) {
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    // Strip quotes for quoted strings.
    if (/^"(.*)"$/.test(value)) value = value.slice(1, -1);
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    obj[key] = value;
  }
  return obj;
}

function validate(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  let fm;
  try { fm = parseFrontmatter(text); } catch (e) { issues.push(e.message); return issues; }
  if (typeof fm.description !== 'string' || fm.description.length === 0) {
    issues.push('description: must be a non-empty string');
  } else if (fm.description.includes('\n')) {
    issues.push('description: must be single-line');
  }
  if (typeof fm['disable-model-invocation'] !== 'boolean') {
    issues.push('disable-model-invocation: must be true or false');
  }
  if (typeof fm['allowed-tools'] !== 'string' || fm['allowed-tools'].length === 0) {
    issues.push('allowed-tools: must be a non-empty space-separated string');
  }
  return issues;
}

function main() {
  let total = 0;
  let failed = 0;
  for (const file of findSkillFiles()) {
    total++;
    const issues = validate(file);
    if (issues.length > 0) {
      failed++;
      console.error(`FAIL ${path.relative(process.cwd(), file)}`);
      for (const issue of issues) console.error(`  - ${issue}`);
    } else {
      console.log(`OK   ${path.relative(process.cwd(), file)}`);
    }
  }
  console.log(`\n${total - failed}/${total} skills valid.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 2: Run the validator and verify it passes**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: every skill prints `OK` and exit code is 0. (If `/adhd:config` and `/adhd:sync` are still in their pre-restructure state, they should still pass — they have valid frontmatter.) The new `adhd:to-dtcg` skill should also pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-skill-frontmatter.js
git commit -m "Add skill frontmatter validator script"
```

---

## Task 11: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Verify the directory exists, create if needed**

```bash
ls .github/workflows/ 2>/dev/null || mkdir -p .github/workflows
```

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main]

jobs:
  to-dtcg-tests:
    name: to-dtcg unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run to-dtcg tests
        run: node --test plugins/adhd/lib/to-dtcg/__tests__/

  hygiene:
    name: project hygiene
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Build
        run: npm run build
      - name: Validate skill frontmatter
        run: node scripts/validate-skill-frontmatter.js
```

- [ ] **Step 3: Verify YAML syntax**

```bash
node -e "
const fs = require('fs');
const text = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
// Naive YAML check: look for tabs (yaml forbids), check indentation consistency.
const lines = text.split('\n');
const issues = lines.filter(l => /\t/.test(l));
if (issues.length) { console.error('YAML has tabs (use spaces):', issues); process.exit(1); }
console.log('OK: ', lines.length, 'lines, no tabs');
"
```

Expected: `OK: <N> lines, no tabs`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add GitHub Actions CI: to-dtcg tests + project hygiene"
```

- [ ] **Step 5: Verification (manual, by user)**

Once pushed to GitHub, the user opens the Actions tab and verifies both jobs pass. Note this in your final report — you can't directly observe CI from inside this session.

---

## Task 12: README + final smoke

**Files:**
- Create: `plugins/adhd/lib/to-dtcg/README.md`

- [ ] **Step 1: Write the README**

Create `plugins/adhd/lib/to-dtcg/README.md`:

```markdown
# adhd to-dtcg converter

Zero-dependency Node.js script that converts design tokens between code (CSS), Figma (MCP variable-defs response), and the canonical [DTCG](https://www.designtokens.org/) JSON shape.

Used by ADHD's user-facing skills:
- `/adhd:export-for-figma` — code → DTCG (user imports manually into Figma)
- `/adhd:check` — code DTCG vs. Figma DTCG diff
- `/adhd:sync-from-figma` — Figma DTCG → CSS edits

Wrapped by the model-invocable skill at `plugins/adhd/skills/to-dtcg/SKILL.md`.

## Usage

```bash
node cli.js --source <css|figma> --input <path> [--tailwind-theme <path|none>]
```

- `--source css` reads CSS, parses ADHD-managed `@theme {}`, `:root {}`, and `@media (prefers-color-scheme: dark) :root {}` blocks.
- `--source figma` reads a Figma MCP `get_variable_defs` response JSON, recognizes `Primitives` and `Semantic` collections, resolves variable aliases.
- `--tailwind-theme <path>` (css mode only) merges Tailwind v4 default tokens from the given `theme.css`. Default: `node_modules/tailwindcss/theme.css`. Pass `none` to skip.

Output: DTCG JSON on stdout, keys sorted alphabetically, 2-space indent, trailing newline.

Exit codes: 0 = success, 1 = parse error, 2 = bad arguments.

## Tests

```bash
node --test __tests__/
```

CI runs this on every push and PR (see `.github/workflows/ci.yml`).

## Fixtures

`__fixtures__/` contains the canonical input/output pairs:

- `sample-globals.css` + `tailwind-v4-theme.css` (CSS-mode inputs)
- `sample-figma-response.json` (figma-mode input)
- `sample.dtcg.json` (expected output for both modes — round-trip target)

## Refresh workflow

The fixtures pin the converter's behavior. Refresh them when:

### Tailwind v4 ships a new `theme.css`

If a Tailwind update changes the shape of `theme.css`, the parser may need updating. To check:

```bash
diff -u __fixtures__/tailwind-v4-theme.css node_modules/tailwindcss/theme.css | head
```

If significant divergence, copy the relevant subset into the fixture and re-run tests.

### Figma changes the MCP `get_variable_defs` response shape

If Figma's MCP response shape evolves and breaks the parser, capture a fresh fixture from a real Claude Code session:

1. Open the Figma file in Figma desktop.
2. In a Claude Code session, call `mcp__figma__get_variable_defs` (in code: `await tool('mcp__figma__get_variable_defs', { ... })` or via a quick skill invocation).
3. Write the raw response to `__fixtures__/sample-figma-response.json`.
4. Re-run `node --test __tests__/` and adjust `sample.dtcg.json` if necessary.

### OKLCH math drift

The OKLCH→hex math in `cli.js` is hand-rolled, vendored from colorjs.io. If color science conventions shift, refresh by:

1. Looking up the current OKLCH→sRGB conversion at https://github.com/color-js/color.js
2. Updating the `oklchToOklab`, `oklabToLinearSrgb`, `linearToCompandedSrgb` functions in `cli.js`
3. Running `node --test __tests__/oklch.test.js` to verify within ±1 LSB tolerance for known-good values.
```

- [ ] **Step 2: Run all tests one more time**

```bash
node --test plugins/adhd/lib/to-dtcg/__tests__/
```

Expected: all tests pass. Total test count should be: ≥7 (args) + 4 (oklch) + 2 (css) + 1 (figma) + 1 (round-trip) = 15+ tests.

- [ ] **Step 3: Run the skill frontmatter validator**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: all skills pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/lib/to-dtcg/README.md
git commit -m "Add to-dtcg README with usage and fixture refresh workflow"
```

- [ ] **Step 5: Final report**

Print:

```
to-dtcg converter implementation complete.

Files:
  plugins/adhd/lib/to-dtcg/cli.js         (~300 lines, zero deps)
  plugins/adhd/lib/to-dtcg/__fixtures__/  (4 fixtures)
  plugins/adhd/lib/to-dtcg/__tests__/     (5 test files, 15+ tests)
  plugins/adhd/lib/to-dtcg/README.md
  plugins/adhd/skills/to-dtcg/SKILL.md
  scripts/validate-skill-frontmatter.js
  .github/workflows/ci.yml

Acceptance criteria covered (from spec §Acceptance criteria):
  AC 1: cli.js css mode produces sample.dtcg.json byte-equal — VERIFIED via tests
  AC 2: cli.js figma mode produces sample.dtcg.json byte-equal — VERIFIED via tests
  AC 3: OKLCH red-500 → ~#fb2c36 within ±1 LSB — VERIFIED via tests
  AC 17: GitHub Actions CI runs both jobs — pending first push to GitHub
  AC 18: skill frontmatter validator catches malformed YAML — VERIFIED locally

Next steps:
  - Push to GitHub; verify CI runs green.
  - Proceed to Plan 2 (writing-plans for /adhd:export-for-figma + /adhd:config simplification).
```

---

## Self-review

**Spec coverage:** Component 1 (cli.js) covered by Tasks 1-8. Component 2 (adhd:to-dtcg skill) covered by Task 9. Component 7 (GitHub Actions CI + skill-frontmatter validator) covered by Tasks 10-11. README in Task 12. AC #1, #2, #3, #17, #18 directly tested or set up. AC #4-16 belong to Plans 2-4 (the user-facing skills).

**Placeholder scan:** every step has concrete code or commands. No "TODO: handle this case" — only one TODO in cli.js Step 2 of Task 1, immediately resolved in Task 2. Comments like "Implemented in Task 7" are scaffolding for the TDD flow, not placeholders.

**Type / signature consistency:** `parseArgs` returns `{ source, input, tailwindTheme }` (Task 2) — consumed by `main` in Task 5 and never renamed. `parseCssTokens` returns `{ primitives, semanticLight, semanticDark }` — consumed by `buildDtcgFromCssTokens` AND `parseFigmaResponse` returns the same shape (Task 7), so both feed the same builder. `oklchToHex(L, C, h)` signature stable from Task 3 onward. `variableNameToDtcg` returns `{ namespace, dtcgPath }` — consumed by `parseCssTokens` and `parseTailwindTheme`. `figmaVariableNameToDtcg` returns the same shape, used by `parseFigmaResponse`. Module exports kept in sync across tasks.

**Determinism check:** AC #1 and #2 require byte-equal output. `stringifyDtcgStable` sorts keys at every level (`sortKeysDeep`) and uses `JSON.stringify(..., null, 2) + '\n'` — both sources go through this same function, guaranteeing identical formatting given equivalent inputs.

**Fixture roundtrip:** the gold-100 RGB values in the Figma fixture (`(0.9804, 0.9412, 0.7725)`) are intentionally chosen to round to `(250, 240, 197)` = `#faf0c5`, matching the CSS fixture. The fixture-author has to verify this when committing Task 7's fixture; if it drifts by 1 channel, adjust the float values to nail it.
