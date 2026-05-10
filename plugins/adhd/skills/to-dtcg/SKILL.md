---
description: "Convert design tokens between code (CSS) and Figma (MCP variable defs) representations and the canonical DTCG (Design Token Community Group) JSON shape. Used by /adhd:export-for-figma, /adhd:lint, and /adhd:sync-from-figma. Wraps the deterministic Node converter at plugins/adhd/lib/to-dtcg/cli.js."
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
