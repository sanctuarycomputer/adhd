---
description: "Generate a DTCG JSON file from this project's design tokens (Tailwind v4 defaults + custom tokens in globals.css). The user imports the resulting file into Figma via a DTCG-compatible community plugin (TokensBrücke recommended). Reads adhd.config.ts; never talks to Figma directly."
disable-model-invocation: true
allowed-tools: Read Write Bash Skill
---

# ADHD Export for Figma

You are running the ADHD export-for-figma skill. ADHD ("agent-driven harmonious development") keeps design tokens synchronized between this Tailwind v4 codebase and a Figma file. This skill produces a DTCG (Design Token Community Group) JSON file the user imports into Figma manually via a community plugin.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` — Component 3.

The skill is **linear**: validate config → convert tokens → write file → report. It never modifies Figma.

## Phase 1: Validate

### 1.1 Read and validate `adhd.config.ts`

- Use `Read` to load `adhd.config.ts` at the repo root.
- If the file does not exist, abort with:

```
ADHD export-for-figma cannot proceed.

Reason:    Cannot find adhd.config.ts at the repo root.
Next step: Run /adhd:config to fix.
```

- **PAT-leak preflight.** Before parsing for fields, scan the source text of the file you just read with two regex checks:
  1. `figd_[A-Za-z0-9_-]+` — Figma PAT prefix.
  2. `(pat|token|secret)\s*:\s*"[^"]{30,}"` — long opaque value assigned to a credential-named key. If the matched value also satisfies `^[A-Z][A-Z0-9_]*$` (i.e., it looks like an env var name), skip this heuristic — it's a valid name, not a token.

  On match, abort with:

```
ADHD export-for-figma cannot proceed.

Reason:    Looks like a Figma PAT is committed to adhd.config.ts. This is a credential leak.
Next step: Remove it from the config and store it as FIGMA_PAT in either .env.local
           (gitignored) or your shell environment. Then run /adhd:config.
```

- Parse the default-exported object with targeted regex (look for `figma:`, `domains:`, `cssEntry:`).
- Validate:
  - `figma.url` matches `^https://www\.figma\.com/design/[^/]+/`. If not, abort with `Run /adhd:config to fix.` (config-fixable).
  - `domains` (if present) is an array containing only `"colors"`, `"spacing"`, `"typography"`, `"radius"`, `"shadow"`. If not, abort with the same `Run /adhd:config to fix.` next-step.
  - `cssEntry` (if present) points to a file that exists.

  Emit errors in the standard format:

```
ADHD export-for-figma cannot proceed.

Reason:    <one-line specific issue>
Next step: Run /adhd:config to fix.
```

### 1.2 Resolve and check `cssEntry`

- Resolve the CSS path: `config.cssEntry ?? "app/globals.css"`.
- If the resolved file does not exist, abort with:

```
ADHD export-for-figma cannot proceed.

Reason:    Cannot find CSS entry at <resolved-path>.
Next step: Run /adhd:config to fix.
```

- Read the file's first ~40 lines and confirm `@import "tailwindcss"` is present. If not, warn (don't abort) and continue.

The `figma.url` field is parsed but unused by this skill. Validating it ensures the credential-leak check runs over the full config.

## Phase 2: Convert

Invoke the model-invocable `adhd:to-dtcg` skill with Procedure A (css-to-dtcg). Use the `Skill` tool with skill name `adhd:to-dtcg` and tell it: "Run Procedure A. Input CSS file path: `<resolved-cssEntry>`."

The to-dtcg skill will:
1. Check whether `node_modules/tailwindcss/theme.css` exists.
2. Run `node plugins/adhd/lib/to-dtcg/cli.js --source css --input <cssEntry> --tailwind-theme <theme-or-none>`.
3. Return the DTCG JSON output (stdout).

If the `Skill` invocation surfaces a non-zero exit error from the converter, propagate it as the abort reason:

```
ADHD export-for-figma cannot proceed.

Reason:    Token conversion failed: <stderr from cli.js>
Next step: Inspect the input file and rerun. If the error persists, file an issue.
```

## Phase 3: Write

- Use `Write` to write the DTCG JSON to `adhd-export-for-figma.json` at the repo root.
- The output is already pretty-printed (cli.js emits sorted keys, 2-space indent, trailing newline).
- Check `.gitignore` for `adhd-export-for-figma.json`. If absent, also check for a covering glob (`*.json` and the like). If the file isn't gitignored, append `adhd-export-for-figma.json` to `.gitignore` on its own line.
- Track whether `.gitignore` was modified — Phase 4 reports it.

## Phase 4: Report

Print a summary tailored to what happened:

```
Wrote adhd-export-for-figma.json (<N> tokens: <M> primitives, <K> semantic).

[If .gitignore was modified:]
Added adhd-export-for-figma.json to .gitignore.

Next:
  1. Open your Figma file (<URL from config>).
  2. Install the TokensBrücke community plugin if not already:
     https://www.figma.com/community/plugin/1254538877056388290/tokensbrücke
  3. Run TokensBrücke → Import. Paste the contents of
     adhd-export-for-figma.json. Recommended settings: HEX color mode,
     Use DTCG keys ON, Omit collection names OFF, Include figma metadata OFF.
  4. Verify the variables appear in Figma's Variables panel under
     `color`, `spacing`, and `shadow` collections.

Known import caveats (documented in plugins/adhd/lib/to-dtcg/README.md):
  - Spacing units lost (`1rem` becomes `1px`).
  - Shadow `$type` downgraded to `"string"`.
  - Phantom mode values added to single-value primitives in 2-mode collections.
```

Substitute `<N>`, `<M>`, `<K>`, and `<URL from config>` with actual counts and the URL.

For token counts: `<M>` is the number of leaf entries under non-mode keys (color/spacing/shadow/font/text/fontWeight/leading) that are NOT semantic. `<K>` is the number of entries with `$extensions.mode`. `<N>` = `<M>` + `<K>`.

## Reference: Common errors and fix-up guidance

### "Cannot find adhd.config.ts at the repo root"
Run `/adhd:config` to create one.

### "Looks like a Figma PAT is committed to adhd.config.ts"
The preflight scan found a string that looks like a Figma personal access token in your config. Tokens never go in `adhd.config.ts` (it's tracked in git). Move the token to `.env.local` (gitignored) or your shell rc, then re-run.

### "Cannot find CSS entry at <path>"
The `cssEntry` field in your config (or the default `app/globals.css`) doesn't exist on disk. Run `/adhd:config` and confirm the auto-detection picks the right path. For a custom path, set `cssEntry` explicitly in `adhd.config.ts`.

### "Token conversion failed"
The underlying `cli.js` couldn't produce DTCG. Check the stderr output for specifics — commonly an unparseable shadow, OKLCH, or alias in `globals.css`. Fix the offending CSS and rerun.

## Reference: What the export contains

The output `adhd-export-for-figma.json` has top-level namespaces by domain:

- `color` — color primitives (e.g., `color.gold.100`) AND semantic colors with mode aliases (e.g., `color.brand.surface`).
- `spacing` — dimension primitives (e.g., `spacing.4`).
- `radius` — dimension primitives.
- `shadow` — shadow primitives (CSS shadow strings).
- `font`, `text`, `fontWeight`, `leading` — typography primitives.

Tailwind v4 default tokens are merged in. User-defined tokens in `@theme {}` override defaults. Semantic tokens use `$extensions.mode.{light,dark}` encoding alongside a top-level `$value` (the Light/default value).

See `plugins/adhd/lib/to-dtcg/README.md` for the canonical format reference.
