---
description: "Sync the design-system docs route in a Next.js consumer app. Sidebar + viewer layout: sidebar lists every Tailwind v4 token domain (colors, spacing, typography, font, font-weight, tracking, leading, radius, shadows, breakpoints, easing, animation) plus every component tracked in adhd.config.ts; the main pane renders the selected route. Tokens are read from globals.css at request time. Components are statically imported from adhd.config.ts at sync time — re-run this command after editing the components map. Component pages introspect props for URL-driven toggles. Optionally excluded from production builds via Next.js pageExtensions trick. Marker-comment detection makes it safe to re-run; stale files from earlier template layouts are cleaned up automatically."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion
---

# ADHD Sync Docs

Generates (and re-generates) a design-system docs page in a Next.js App Router project. Tokens are read live from `globals.css`. Components are statically imported from `adhd.config.ts` at the moment this skill runs — **re-run after editing the components map** to sync the static imports.

**Authoritative spec:** `docs/superpowers/specs/2026-05-11-adhd-install-design-system-docs-route.md` (historical name).

## Invariants

1. **No ADHD references in generated files** outside of two filename-style exceptions: the consumer's `adhd.config.ts` filename, and the slash-command name `/adhd:sync-docs` referenced in re-run copy.
2. **adhd.config.ts is NOT modified** by this skill. The skill reads it; the user owns it.
3. **All file writes are idempotent on re-run.** Marker-bearing files are replaced wholesale with the latest templates. Files where the user deleted the marker are left alone. Stale marker-bearing files from earlier template layouts are removed.
4. **Static component imports.** The skill parses `adhd.config.ts` and generates `componentMap.tsx` with explicit `import * as $cmpN from "@/..."` per registered component. The component page does a static lookup — no dynamic imports, no broad Webpack context modules, no Tailwind-blast-radius issues.

## Phase 1: Validate consumer environment

```bash
test -f adhd.config.ts || { echo "Missing adhd.config.ts. Run /adhd:config first."; exit 1; }
test -d app          || { echo "Missing app/ directory. This installer requires the Next.js App Router."; exit 1; }
test -f package.json || { echo "No package.json at the working directory."; exit 1; }
```

Read `package.json` and confirm `next` is in `dependencies` or `devDependencies`. Warn if missing or version < 16; continue anyway.

## Phase 2: Detect existing install

```bash
node plugins/adhd/lib/sync-docs/cli.js detect-install --app-dir .
```

Output is newline-separated paths of files containing the marker comment.

- **No matches:** fresh install. Proceed to Phase 3 with defaults.
- **One or more matches:** use `AskUserQuestion`:
  - "Update in place" — re-write the listed marker-bearing files with the latest templates.
  - "Move to new location" — Phase 3 reasks the install questions; files at the old location are NOT deleted (the user manages them).
  - "Abort" — exit with no changes.

If user chose "Update in place": derive `groupName` and `routeSegment` from the existing install's folder path, then skip Phase 3's first two questions (route URL, route group) and ask ONLY question 3 ("Exclude from production builds?") to confirm current state. Then proceed to Phase 4.

## Phase 3: Ask installation choices

Ask all three questions in a **single** `AskUserQuestion` call so the user sees them as one wizard-style prompt rather than three round-trips. The questions are independent — no branching between answers — so batching is safe.

1. **Route URL** — default `/-docs`. Validate: starts with `/`, only `a-z0-9-/` characters, no leading `_`.
2. **Route group** — default `(design-system)`. Validate: parens-wrapped, alphanumerics + hyphens inside, OR empty string for "no group."
3. **Where should the docs route render?** — three options, default `Dev only`:
   - **Dev only** — gates on `process.env.NODE_ENV === 'production'`. Excludes the route from any production build, on any host.
   - **Dev + Vercel preview** — gates on `process.env.VERCEL_ENV === 'production' || (!process.env.VERCEL && process.env.NODE_ENV === 'production')`. Renders on Vercel preview deploys; excluded from Vercel production AND from any non-Vercel production deploy.
   - **Everywhere** — no `pageExtensions` patch; route files use plain `.tsx` and ship to production (still `noindex`'d via `robots: { index: false, follow: false }` on the layout's metadata).

Map the answer to the `renderMode` field passed downstream:

| Answer label | `renderMode` |
|---|---|
| Dev only | `"dev-only"` |
| Dev + Vercel preview | `"vercel-preview"` |
| Everywhere | `"everywhere"` |

If a custom "Other" answer fails validation, re-ask only that one question in a follow-up `AskUserQuestion` call.

Derive `groupName` and `routeSegment` from these answers. Example: routeUrl `/-docs` → routeSegment `-docs`. The group is independent of the URL.

## Phase 4: Detect Next.js config file

```bash
for f in next.config.ts next.config.mjs next.config.js; do
  test -f "$f" && echo "$f" && break
done
```

If none found: abort with "No next.config.* at the project root. Create one before running this installer."

## Phase 5: Detect filesystem collisions

```bash
TARGET="app/${GROUP}/${SEGMENT}"
test -e "$TARGET" && echo "EXISTS" || echo "FREE"
```

If `EXISTS` and Phase 2 didn't already mark this as an existing install: prompt "Path `<TARGET>` already exists but is not an installer artifact. Pick a different route or abort."

## Phase 6: Patch next.config.ts

Always run. The patcher emits up to two blocks depending on `renderMode`:

- A `pageExtensions` conditional (skipped when `renderMode` is `"everywhere"` — those files ship to prod as plain `.tsx`, no gate needed).
- An `outputFileTracingIncludes` entry that ships `globals.css` alongside the tokens-page function bundle (emitted whenever the route is deployed to a serverless runtime — i.e. `vercel-preview` or `everywhere`; not needed for pure `dev-only` since `next dev` runs locally with the project root as `cwd`).

Without tracing, the runtime `fs.readFile` in the tokens page returns `null` on Vercel/serverless deploys (the CSS source isn't bundled with the function by default), and every token domain falls through to the empty state — even though `globals.css` is full of declarations.

```bash
node plugins/adhd/lib/sync-docs/cli.js patch-next-config \
  --config "<next.config.path>" \
  --route-url "<routeUrl>" \
  --render-mode "<dev-only|vercel-preview|everywhere>" \
  --css-entry "<cssEntry>"
```

Exit codes:
- `0` — patched successfully (or already at the expected state; idempotent no-op).
- `3` — the file already sets `pageExtensions` to a different value. The CLI prints the existing value on stdout.
- non-zero, non-3 — the file's shape isn't safely patchable. Print the manual patch block (matching the chosen `renderMode`) and continue with file installs.

**On exit code 3**, use `AskUserQuestion`: "Your next.config.ts sets pageExtensions to `<existing>`. How do you want to handle it? [Show me the manual patch and continue / Abort]."

Automatic merging is NOT supported in v1. On "Show me the manual patch and continue," print the appropriate block(s) for the chosen `renderMode` and continue with Phase 7. Substitute `<routeUrl>` and `<cssEntry>` in the tracing block:

```ts
// renderMode: "dev-only" — pageExtensions only (no tracing; runs locally via next dev)
pageExtensions: process.env.NODE_ENV === 'production'
  ? ['ts', 'tsx']
  : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],

// renderMode: "vercel-preview" — pageExtensions AND tracing
pageExtensions:
  process.env.VERCEL_ENV === 'production' ||
  (!process.env.VERCEL && process.env.NODE_ENV === 'production')
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],
// adhd:sync-docs — file-tracing for tokens route (so globals.css ships with the serverless function)
outputFileTracingIncludes: {
  '<routeUrl>/tokens/[domain]': ['./<cssEntry>'],
},

// renderMode: "everywhere" — tracing only
outputFileTracingIncludes: {
  '<routeUrl>/tokens/[domain]': ['./<cssEntry>'],
},
```

Tell the user to merge into their existing config by hand. On "Abort," exit with no further changes.

## Phase 7: Write the page files

```bash
node plugins/adhd/lib/sync-docs/cli.js install \
  --config <choices.json>
```

Where `<choices.json>` is a temp file with shape:
```json
{
  "projectRoot": ".",
  "groupName": "(design-system)",
  "routeSegment": "-docs",
  "renderMode": "dev-only"
}
```

`renderMode` is one of `"dev-only"`, `"vercel-preview"`, or `"everywhere"` (from Phase 3's third question). The installer derives the file extension internally (`.design-system.tsx` for the two excluding modes, plain `.tsx` for `"everywhere"`).

The CLI reads `adhd.config.ts` from `<projectRoot>` to discover the components list and `cssEntry`, bakes them into the generated files (including a per-install `componentMap.tsx` with static imports), and prints the list of files it wrote plus the slugs that ended up in the map.

If `adhd.config.ts` is missing, the CLI aborts with `install: failed to read adhd.config.ts ...`. Phase 1 has already guaranteed it exists, so this only fires if the file vanished between phases — rare, but surface the error verbatim.

## Phase 8: Patch robots.txt

```bash
node plugins/adhd/lib/sync-docs/cli.js patch-robots \
  --robots public/robots.txt \
  --route-url "<routeUrl>"
```

If `public/` doesn't exist, create it first:
```bash
mkdir -p public
```

## Phase 9: Final report

Print:
```
✓ Design system docs synced.

  URL:            http://localhost:3000<routeUrl>
  Filesystem:     app/<group>/<segment>/
  Prod exclusion: <ON | OFF>
  noindex meta:   ON
  robots.txt:     Disallow added
  Components:     <comma-separated slug list from the install CLI output, or "none">

Run `npm run dev` and visit the URL to preview.

Tokens are read from globals.css at request time, so editing globals.css just
works. Components are statically imported from adhd.config.ts — after adding,
renaming, or removing entries in the components map, re-run
/adhd:sync-docs to regenerate the static imports.

Files where you've removed the marker comment are left alone.
```

## Common errors

| Error | Fix-up |
|---|---|
| `Missing adhd.config.ts` | Run `/adhd:config` first. |
| `Missing app/ directory` | This installer requires the Next.js App Router (not Pages Router). |
| `No next.config.* at the project root` | Create one with a default export of `{}`. |
| `Path <X> already exists but is not an installer artifact` | Pick a different route URL or move/delete the existing folder. |
| `next.config.ts sets pageExtensions to <existing>` | Manually merge with the design-system conditional, or skip prod-exclusion. |
