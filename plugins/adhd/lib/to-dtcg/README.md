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
