# ADHD DTCG Format Compliance — Design Spec

**Date:** 2026-05-10
**Status:** Approved for implementation planning
**Companion to:** `2026-05-09-adhd-restructure-design.md` (the parent restructure spec). Sits between Plan 1 and Plan 2 of that restructure.

## Purpose

Plan 1 of the ADHD restructure shipped a working zero-deps Tailwind ↔ DTCG converter at `plugins/adhd/lib/to-dtcg/cli.js`. It has 15/15 tests green and is internally consistent. But its output uses formats that **diverge from the canonical DTCG conventions** as implemented by Terrazzo (formerly Cobalt UI), the canonical reference parser. Two days of comparison research against:

- **Terrazzo** (`terrazzoapp/terrazzo`) — canonical DTCG parser, source of truth for shape decisions
- **tokens-bruecke** (`tokens-bruecke/figma-plugin`) — popular Figma plugin, follows Terrazzo's conventions
- **sd-tailwindv4** (`tokens-studio/sd-tailwindv4`) — useful Tailwind-token reference but explicitly self-described as "an exploration and experiment"; not a stable target

…surfaced five concrete format mismatches in our Plan 1 output. Plan 1.5 fixes them, swaps the synthetic Figma test fixture for a real captured one, and ends with `cli.js`'s output round-trippable through actual Figma plus any Terrazzo-compatible consumer. No skill changes; the format shift is internal to `cli.js` and its fixtures.

**Compatibility target:** Terrazzo's parser is the canonical DTCG reference. Where Terrazzo and tokens-bruecke agree (which is most places), we match both. Where they diverge, Terrazzo wins.

**Acknowledged tech-debt:** Terrazzo marks `$extensions.mode` as `@deprecated` in their types — they're moving to a Resolver file pattern. We use `$extensions.mode` for compat today (it's the form every existing community plugin understands). Future plan can add Resolver output as a flag when consumer tooling moves.

## Format mismatches to fix

### 1. Mode encoding

**Plan 1's output:**
```json
"surface": {
  "$extensions": { "com.figma": { "modes": {
    "Dark": { "$value": "{color.gold.900}" },
    "Light": { "$value": "{color.gold.100}" }
  }}},
  "$type": "color"
}
```

**Plan 1.5's output:**
```json
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
```

Three changes:
- Key path: `$extensions.com.figma.modes` → `$extensions.mode` (singular, no vendor prefix).
- Value shape: `{ "$value": "..." }` wrapper → bare value.
- Mode names: `"Light"`/`"Dark"` (Figma's literal names) → `"light"`/`"dark"` (lowercase per Terrazzo fixtures).
- Top-level `$value` required alongside `$extensions.mode` — serves as the default/fallback. Set to the Light value.

### 2. Color values

**Plan 1's output:** `"$value": "#fb2c36"` (hex string).

**Plan 1.5's output:** `"$value": { "colorSpace": "srgb", "components": [0.984, 0.172, 0.212], "alpha": 1 }`.

Per Terrazzo: hex strings are explicitly the **legacy** format, rejected by the linter unless the consumer enables `legacyFormat: true`. Components are 0–1 normalized.

Simplifies the Figma path: Figma's MCP gives floats in `[0, 1]` already; we just package as the object form. No conversion math needed for Figma source.

For OKLCH source (Tailwind v4 defaults): existing pipeline (`OKLCH → OKLab → linear sRGB → companded sRGB`) is unchanged; we stop one step short of 8-bit quantization and emit components as gamma-encoded sRGB floats directly.

### 3. Dimension values

**Plan 1's output:** `"$value": "1rem"` (CSS string).

**Plan 1.5's output:** `"$value": { "value": 1, "unit": "rem" }`.

Per Terrazzo's `valid-dimension.ts`: bare CSS strings rejected. Units `px`, `em`, `rem` are accepted by default. Tailwind v4 emits all three; pass-through preserves the user's intent.

### 4. fontFamily values

**Plan 1's output:** `"$value": "Geist Sans, system-ui"` (comma-joined string).

**Plan 1.5's output:** `"$value": ["Geist Sans", "system-ui"]`.

Per Terrazzo's `normalizeFontFamily`: a string with commas is treated as a single family literally named `"Geist Sans, system-ui"` — not what the user means. Split on commas + trim quotes.

### 5. Shadow values

**Plan 1's output:** `"$value": "0 4px 6px -1px rgba(0,0,0,0.1)"` (raw CSS string passthrough — currently broken for any DTCG consumer).

**Plan 1.5's output (single shadow):**
```json
{
  "$type": "shadow",
  "$value": [{
    "offsetX": { "value": 0, "unit": "px" },
    "offsetY": { "value": 4, "unit": "px" },
    "blur":    { "value": 6, "unit": "px" },
    "spread":  { "value": -1, "unit": "px" },
    "color":   { "colorSpace": "srgb", "components": [0, 0, 0], "alpha": 0.1 },
    "inset":   false
  }]
}
```

**Multi-shadow (e.g. Tailwind v4's `shadow-md`):** `$value` is a 2-element array of the same object shape.

Always wrap in array (even single shadow) for forward compatibility — Terrazzo accepts both, but array-always means consumers don't need to switch on type.

## Component additions to `cli.js`

### `oklchToColorValue(L, C, h) → ColorValue`

Refactor of the existing `oklchToHex`. Pipeline unchanged (OKLCH → OKLab → linear sRGB → companded sRGB). Stop short of 8-bit quantization; round components to 4 decimals for stable output.

Returns: `{ colorSpace: "srgb", components: [r, g, b], alpha: 1 }`.

### `rgbObjectToColorValue({ r, g, b, a }) → ColorValue`

Replaces `rgbObjectToHex`. No conversion — Figma's MCP already returns 0–1 floats. Round to 4 decimals. Returns: `{ colorSpace: "srgb", components: [r, g, b], alpha }`.

### `parseCssDimension(raw) → { value, unit } | null`

New helper. Regex: `^(-?\d+\.?\d*)(rem|em|px)$`. Returns `null` on non-match (caller decides).

### `parseFontFamily(raw) → string[]`

New helper. Split on commas, trim whitespace, strip surrounding quotes. Always returns array (single family → 1-element array).

### `parseCssColor(raw) → ColorValue`

New helper. Handles:
- Hex `#rgb` / `#rrggbb` / `#rrggbbaa`
- `rgb(r, g, b)` / `rgba(r, g, b, a)` legacy comma-separated syntax
- `rgb(r g b / a)` modern space-separated syntax
- Named: `transparent`, `black`, `white`. Anything else throws.

Components 0–1 normalized.

### `parseCssShadow(raw) → ShadowValue[]`

New helper. The largest addition (~80 lines). Always returns an array (even for single shadow).

Strategy:
1. Split `raw` by **top-level commas** (track parenthesis depth so commas inside `rgb(...)` are not split points).
2. For each shadow part:
   - Strip leading `inset` keyword if present.
   - Tokenize remaining string by whitespace, but treat `rgb(...)` / `rgba(...)` / hex as single tokens.
   - Last token is the color; preceding tokens are dimensions (`offsetX offsetY [blur [spread]]`).
   - Convert each via `parseCssDimension` and `parseCssColor`.
   - Default `spread: { value: 0, unit: "px" }` if missing; default `inset: false` if no inset keyword.

### `normalizeCssValue(raw, namespace, dtcgType) → DtcgValue`

Refactored dispatcher. Replaces value-passthrough behavior. New logic dispatches on `dtcgType`:
- `color` → `parseCssColor` (or alias / oklch)
- `dimension` → `parseCssDimension`
- `fontFamily` → `parseFontFamily`
- `fontWeight` / `number` → `parseFloat`
- `shadow` → `parseCssShadow`
- Aliases: detected first, return DTCG `{dot.path}` reference regardless of dtcgType.

### `buildDtcgFromCssTokens` — semantic-leaf shape

The semantic-token leaf shape changes per the new mode encoding:
```js
const leaf = {
  $type: sem.type,
  $value: sem.light,
  $extensions: { mode: {} },
};
if (sem.light !== undefined) leaf.$extensions.mode.light = sem.light;
if (sem.dark !== undefined) leaf.$extensions.mode.dark = sem.dark;
```

### `parseFigmaResponse` — value-shape adjustments

Internal token resolution unchanged. `resolveValue` returns ColorValue objects (via `rgbObjectToColorValue`) instead of hex strings. Spacing/dimension floats wrapped in `{ value, unit }`. Aliases stay `{dot.path}`.

The Semantic-mode mapping uses the same shape change as `buildDtcgFromCssTokens`.

## Two-phase implementation flow

### Phase A — format implementation (~10 tasks, fully automated)

Each task is TDD: failing test → implementation → green. All tests run via `node --test plugins/adhd/lib/to-dtcg/__tests__/`.

1. Refactor `oklchToColorValue` (rename, return components instead of hex). Update `oklch.test.js`.
2. Add `rgbObjectToColorValue` + tests.
3. Add `parseCssDimension` helper + tests for units (rem/em/px), edge cases.
4. Add `parseFontFamily` helper + tests (single family, stack, quoted names).
5. Add `parseCssColor` helper + tests (hex 3/6/8, rgb/rgba legacy + modern, transparent/black/white).
6. Add `parseCssShadow` helper + tests with shadow strings borrowed from sd-tailwindv4 fixtures (single, multi-shadow, inset).
7. Refactor `normalizeCssValue` to dispatch on dtcgType; update `parseCssTokens` to thread dtcgType through.
8. Refactor `buildDtcgFromCssTokens` semantic-leaf shape (top-level `$value`, lowercase modes, `$extensions.mode`, bare values).
9. Refactor `parseFigmaResponse` to call new helpers and emit the new semantic-leaf shape.
10. Rewrite `__fixtures__/sample.dtcg.json`, add `--shadow-md` to `__fixtures__/sample-globals.css` and `__fixtures__/tailwind-v4-theme.css`, update `__fixtures__/sample-figma-response.json` (still synthetic at this point) to match new shape, update `css.test.js` / `figma.test.js` / `round-trip.test.js`. All tests green.

End of Phase A: cli.js, fixtures, tests in new format. Synthetic `sample-figma-response.json` matches the shape but is not a real MCP capture.

### Phase B — replace synthetic Figma fixture with real MCP capture (1 manual handoff + verification)

11. **Generate the import payload.** Run `node cli.js --source css --input <fixture> --tailwind-theme <fixture>` → DTCG JSON.
12. **Manual import (user action).** User opens `https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd` in Figma desktop, installs Variables JSON Import community plugin, pastes the JSON, imports. Verifies `Primitives` and `Semantic` collections appear with the right variables and Light/Dark modes.
13. **Capture via MCP.** Controller calls `mcp__figma__get_variable_defs` (with the file open in Figma desktop) and saves the response to `__fixtures__/sample-figma-response.json`, replacing the synthetic version.
14. **Re-run tests.** `figma.test.js` and `round-trip.test.js` should still pass byte-equal. If they don't, the diff between synthetic and real fixture surfaces parser bugs in `parseFigmaResponse`. Fix and commit.
15. **Update README** with the canonical fixture-refresh workflow: cli.js → import → capture → commit. This becomes the procedure used whenever Figma's MCP shape evolves.
16. **Final commit.** All tests green, fixture real, format Terrazzo-compliant.

### What this earns

- **Synthetic-fixture-drift risk eliminated.** Tests run against real Figma data, not docs-derived guesses.
- **End-to-end validation in CI.** `figma.test.js` proves our converter handles what Figma actually emits.
- **`PBCAkpPnvGXWrz6H7qfH3V/adhd` becomes the canonical demo file.** Anyone evaluating ADHD can import-and-capture against it.

## File change summary

**Modify:**
- `plugins/adhd/lib/to-dtcg/cli.js` — bulk of the work. ~250–300 lines of refactor + new helpers.
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample-globals.css` — add `--shadow-md`.
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample.dtcg.json` — full rewrite to new format.
- `plugins/adhd/lib/to-dtcg/__fixtures__/sample-figma-response.json` — first updated to new shape (Phase A), then replaced with real capture (Phase B).
- `plugins/adhd/lib/to-dtcg/__fixtures__/tailwind-v4-theme.css` — add a default shadow.
- `plugins/adhd/lib/to-dtcg/__tests__/oklch.test.js` — update to expect ColorValue objects.
- `plugins/adhd/lib/to-dtcg/__tests__/css.test.js`, `figma.test.js`, `round-trip.test.js` — adjust for new fixture shape.
- `plugins/adhd/lib/to-dtcg/README.md` — fixture refresh workflow + format reference (Terrazzo as canonical).

**Create:**
- `plugins/adhd/lib/to-dtcg/__tests__/shadow-parser.test.js` — unit tests for the new `parseCssShadow` helper using canonical Tailwind v4 shadow strings.

**Not modified** (the format shift is internal to `cli.js` and invisible at the skill interface):
- `plugins/adhd/skills/to-dtcg/SKILL.md`
- `plugins/adhd/skills/config/SKILL.md`, `plugins/adhd/skills/sync/SKILL.md`
- `scripts/validate-skill-frontmatter.js`
- `.github/workflows/ci.yml`

**Spec/plan documentation updates** (ship in the same plan):
- `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` — Section 5's mode-extension example updated to new shape.
- This spec (`docs/superpowers/specs/2026-05-10-adhd-dtcg-format-compliance-design.md`) — itself, ships with the spec commit.

## Out of scope (v1 of this format)

- **Resolver pattern.** Terrazzo's newer mode-encoding replacement is documented as the migration target for `$extensions.mode`. Future plan when consumer tooling moves there.
- **DTCG composite typography.** `typography` composite type (combined fontFamily/fontSize/fontWeight/lineHeight on one token). We continue emitting individual primitives.
- **Group-level `$type` inheritance.** Compaction optimization. Defer.
- **Style Dictionary legacy-format flag.** Explicitly rejected — sd-tailwindv4 is an unstable experiment; sd-transforms accepts modern DTCG anyway.
- **Boolean / String Figma variable types.** Defer; ADHD's five domains don't use them.
- **OKLCH/HSL color formats inside CSS shadow strings.** `parseCssColor` handles hex + rgb/rgba (what Tailwind v4 actually emits). OKLCH-in-shadows is rare.
- **Multi-mode beyond Light/Dark.** Same constraint as before; enforced by the existing parser.
- **`$deprecated` field.** Terrazzo supports it on tokens/groups. Not in our use case yet.

## Acceptance criteria

1. **`oklchToColorValue` returns ColorValue object.** `oklchToColorValue(0.637, 0.237, 25.331)` returns `{ colorSpace: "srgb", components: [r, g, b], alpha: 1 }` with each component within ±0.005 of the previously-validated `#fb2c36` post-companding floats (~`[0.984, 0.172, 0.212]`).

2. **`rgbObjectToColorValue` packages floats directly.** `rgbObjectToColorValue({ r: 0.5, g: 0.5, b: 0.5, a: 1 })` returns `{ colorSpace: "srgb", components: [0.5, 0.5, 0.5], alpha: 1 }`.

3. **`parseCssDimension` parses standard units.** `0.25rem` → `{ value: 0.25, unit: "rem" }`. `4px` → `{ value: 4, unit: "px" }`. `-1.5em` → `{ value: -1.5, unit: "em" }`. `null` for non-matching strings.

4. **`parseFontFamily` splits and trims.** `'"Geist Sans", system-ui'` → `["Geist Sans", "system-ui"]`. Single family → single-element array.

5. **`parseCssShadow` single shadow.** `0 4px 6px -1px rgba(0, 0, 0, 0.1)` → 1-element array of ShadowValue with `offsetX/Y/blur/spread` as dimension objects, `color` as ColorValue, `inset: false`.

6. **`parseCssShadow` multi-shadow.** `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)` → 2-element array of ShadowValue objects.

7. **`parseCssShadow` inset.** `inset 0 2px 4px 0 rgba(0,0,0,0.05)` → 1-element array with `inset: true`.

8. **Semantic token shape:** Light value as top-level `$value`; `$extensions.mode.{light,dark}` with lowercase keys and bare values (no `$value` wrapping inside).

9. **`/adhd:to-dtcg` cli.js, css mode** produces JSON byte-equal to the rewritten `__fixtures__/sample.dtcg.json`.

10. **`/adhd:to-dtcg` cli.js, figma mode** produces JSON byte-equal to the same `sample.dtcg.json`, using the **real captured** `sample-figma-response.json` (Phase B).

11. **Round-trip:** css and figma sources produce byte-identical output (proves Phase A and Phase B share a builder).

12. **Phase B import succeeds:** the DTCG output of `cli.js --source css` imports cleanly into Figma at `PBCAkpPnvGXWrz6H7qfH3V/adhd` via the Variables JSON Import community plugin. Variables appear in `Primitives` and `Semantic` collections with Light/Dark modes.

13. **Phase B capture round-trips:** after import, `mcp__figma__get_variable_defs` returns a response that, when fed back through `cli.js --source figma`, produces the same DTCG output as the source CSS.

14. **README updated** with the canonical fixture-refresh workflow (cli.js → import → capture → commit).

15. **CI continues to pass.** All `node --test` targets green; skill frontmatter validator unchanged.

## Implementation note

This plan ships as **one shipping unit**, not split. Phase A and Phase B are sequential within the same plan; the Phase B handoff is a documented manual step in the implementation plan rather than a separate plan boundary. Total work: ~300 LOC of code changes plus fixture rewrites plus README update plus one Figma import + capture step.
