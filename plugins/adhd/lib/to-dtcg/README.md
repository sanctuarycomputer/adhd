# adhd to-dtcg converter

Zero-dependency Node.js script that converts design tokens between code (CSS) and Figma (via DTCG-compatible plugins) and the canonical [DTCG](https://www.designtokens.org/) JSON shape.

Used by ADHD's user-facing skills:
- `/adhd:export-for-figma` — code → DTCG (user imports manually into Figma via plugin)
- `/adhd:check` — code DTCG vs. Figma DTCG diff
- `/adhd:sync-from-figma` — Figma DTCG → CSS edits

Wrapped by the model-invocable skill at `plugins/adhd/skills/to-dtcg/SKILL.md`.

## Usage

```bash
node cli.js --source <css|figma> --input <path> [--tailwind-theme <path|none>]
```

- `--source css` reads CSS, parses ADHD-managed `@theme {}`, `:root {}`, and `@media (prefers-color-scheme: dark) :root {}` blocks.
- `--source figma` reads a Figma REST API `/v1/files/:key/variables/local` response JSON, recognizes `Primitives` and `Semantic` collections, resolves variable aliases. (This source path is currently a future-Enterprise hook — see Architecture below.)
- `--tailwind-theme <path>` (css mode only) merges Tailwind v4 default tokens from the given `theme.css`. Default: `node_modules/tailwindcss/theme.css`. Pass `none` to skip.

Output: DTCG JSON on stdout, keys sorted alphabetically, 2-space indent, trailing newline.

Exit codes: 0 = success, 1 = parse error, 2 = bad arguments.

## Output format

Legacy DTCG form, chosen for compatibility with the current Figma plugin ecosystem (TokensBrücke, sd-tailwindv4, Variables JSON Import, etc.):

- **Color**: hex strings (`"#fb2c36"`, `"#rrggbbaa"` for alpha). Terrazzo's typed object form (`{ colorSpace, components, alpha }`) is the future-canonical but not yet supported by community plugins.
- **Dimension**: CSS strings (`"1rem"`, `"4px"`). Tailwind v4 mostly emits `rem`; we pass through.
- **fontFamily**: arrays (`["Inter", "sans-serif"]`).
- **fontWeight**: numbers.
- **Shadow**: CSS strings, single or multi-shadow stacks (`"0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)"`).
- **Aliases**: `{color.gold.100}` (DTCG reference syntax).
- **Modes** (Light/Dark for Semantic tokens): `$extensions.mode.{light,dark}` with lowercase keys and bare values, alongside a top-level `$value` set to the Light value.

Example semantic-token output:

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

## Recommended Figma plugin

[TokensBrücke](https://www.figma.com/community/plugin/1254538877056388290/tokensbrücke) is the recommended import target for `cli.js`'s output. It's actively maintained, follows DTCG conventions, and accepts the legacy DTCG forms cli.js emits.

To import:
1. Open your Figma file in Figma desktop.
2. Plugins menu → TokensBrücke → Import.
3. Paste the cli.js output JSON.

### TokensBrücke round-trip caveats

The export-and-re-import round-trip through TokensBrücke is **partial**, not lossless. The hex color values for primitives round-trip cleanly. Other tokens degrade:

- **Spacing units are lost on import.** `1rem` becomes a unitless number `1`, then `"1px"` on export. If your design system depends on rem-based spacing, document this.
- **Shadow `$type` downgraded to `"string"`.** Figma has no native shadow variable type, so TokensBrücke maps shadows to string variables. They round-trip as opaque strings.
- **Phantom modes on primitives.** If your Figma collection has multiple modes (e.g., Light + Dark) but you import a single-value primitive, TokensBrücke fills the unspecified mode with white (`#ffffff`). To avoid this, set the Primitives collection to a single mode in Figma before importing.
- **Path prefix dropped on export.** With `omitCollectionNames=true` (recommended for clean DTCG output), aliases come out as `{gold.100}` not `{color.gold.100}`. The collection name (`color`) is implicit from the top-level structure.

For tooling that needs lossless round-trip, this remains an open problem. ADHD's primary use case is one-way: code → Figma. The check-and-sync direction (Plans 2 onward) will need to handle these caveats explicitly.

## Architecture

`cli.js` has two source-input paths and one shared output builder:

```
                    ┌──────────────────────────────────────┐
                    │            DTCG output               │
                    │  (sorted keys, 2-space indent, hex)  │
                    └──────────────────────────────────────┘
                                       ▲
                                       │ buildDtcgFromCssTokens
                                       │
              ┌────────────────────────┴────────────────────────┐
              │                                                 │
   parseCssTokens                                       parseFigmaResponse
   (--source css)                                       (--source figma)
              │                                                 │
   reads globals.css + theme.css                       reads Figma REST API
   parses @theme/:root/@media                          /variables/local response
                                                       (Enterprise-only;
                                                        currently synthetic
                                                        fixture only)
```

The `--source figma` path consumes the Figma REST API shape, NOT the Figma MCP shape. The MCP exposes a "design context" view (variables used by a node, with values resolved) — not the raw variable database. So this code path is currently a *future hook*: it'll work the day a non-Enterprise REST equivalent appears, or a new MCP tool ships, or we add a separate `--source tokensbruecke` mode that consumes TokensBrücke's DTCG export directly.

## Tests

```bash
node --test __tests__/
```

61 tests across 11 files:
- `args.test.js` — CLI argument parsing
- `oklch.test.js` — OKLCH→hex math + OKLCH→ColorValue object
- `dimension.test.js` — `parseCssDimension`
- `font-family.test.js` — `parseFontFamily`
- `color.test.js` — `parseCssColor` (hex, rgb, rgba, named)
- `shadow.test.js` — `parseCssShadow` (single, multi-shadow stack, inset)
- `color-value.test.js` — `rgbObjectToColorValue`
- `css.test.js` — end-to-end CSS source byte-equal vs `sample.dtcg.json`
- `figma.test.js` — end-to-end Figma source (synthetic REST shape) byte-equal vs `sample.dtcg.json`
- `round-trip.test.js` — CSS source vs Figma source DTCG output (partial-domain comparison; shadow excluded)
- `tokensbruecke-round-trip.test.js` — cli.js CSS output vs real TokensBrücke export (partial: primitive hex values + mode encoding)

CI runs `node --test __tests__/` on every push and PR (see `.github/workflows/ci.yml`).

## Fixtures

`__fixtures__/` contains:

- `sample-globals.css` — example user-authored Tailwind v4 globals.css with Primitives (gold/100, gold/900, spacing/4, shadow/md), Semantic (brand-surface with Light/Dark modes), and the canonical block structure (`@theme {}`, `:root {}`, `@media dark`, `@theme inline {}`).
- `tailwind-v4-theme.css` — minimal Tailwind v4 default theme stub (red-500, shadow-2xs) used by css.test.js's merge path.
- `sample.dtcg.json` — expected DTCG output of cli.js when run against sample-globals.css + tailwind-v4-theme.css. Byte-equal target for css.test.js.
- `sample-figma-rest-shape.json` — synthetic Figma REST API response shape. Used by figma.test.js as a future-Enterprise hook for parseFigmaResponse coverage. NOT a real captured response from any Figma file.
- `TokensBrücke.json` — REAL DTCG export from a Figma file (https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd) populated by importing cli.js's CSS-source output via the TokensBrücke community plugin. Used by tokensbruecke-round-trip.test.js.

## Refresh workflow

The fixtures pin the converter's behavior. Refresh them when:

### Tailwind v4 ships a new `theme.css`

If a Tailwind update changes the shape of `theme.css`, the parser may need updating. To check:

```bash
diff -u __fixtures__/tailwind-v4-theme.css node_modules/tailwindcss/theme.css | head
```

If significant divergence, copy the relevant subset into the fixture and re-run tests.

### TokensBrücke export refresh

The canonical DTCG round-trip via TokensBrücke is captured in `__fixtures__/TokensBrücke.json`. Refresh it after:

1. **Generate the latest import payload from cli.js:**
   ```bash
   node cli.js \
     --source css \
     --input __fixtures__/sample-globals.css \
     --tailwind-theme __fixtures__/tailwind-v4-theme.css \
     > /tmp/adhd-import-payload.json
   ```

2. **Open the canonical Figma file** at `https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd` in Figma desktop.

3. **Clear existing variables** if any (Variables panel → delete the existing collections so the import is clean).

4. **Run TokensBrücke → Import.** Paste the JSON from step 1. Confirm the Variables panel populates with `color`, `spacing`, `shadow` collections.

5. **Run TokensBrücke → Export** with `useDTCGKeys=true`, `omitCollectionNames=true`, single-file output. Save to `__fixtures__/TokensBrücke.json`, replacing the existing file.

6. **Re-run tests:** `node --test __tests__/`. The `tokensbruecke-round-trip.test.js` should still pass — primitive hex values and mode encoding are the parts that round-trip cleanly. If it fails, the diff reveals where TokensBrücke's behavior changed; update the test or the fixture accordingly.

### OKLCH math drift

The OKLCH→hex math in `cli.js` is hand-rolled, vendored from colorjs.io. If color science conventions shift, refresh by:

1. Looking up the current OKLCH→sRGB conversion at https://github.com/color-js/color.js
2. Updating the `oklchToOklab`, `oklabToLinearSrgb`, `linearToCompandedSrgb` functions in `cli.js`
3. Running `node --test __tests__/oklch.test.js` to verify within ±1 LSB tolerance for known-good values.
