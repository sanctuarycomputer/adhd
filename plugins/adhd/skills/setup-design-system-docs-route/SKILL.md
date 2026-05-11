---
description: "Generate a design-system documentation route in a Next.js consumer app. Sidebar + viewer layout: sidebar lists every Tailwind v4 token domain (colors, spacing, typography, font, font-weight, tracking, leading, radius, shadows, breakpoints, easing, animation) plus every component tracked in adhd.config.ts; the main pane renders the selected route. Tokens are read from globals.css at request time. Components are statically imported from adhd.config.ts at install time — re-run this command after editing the components map. Component pages introspect props for URL-driven toggles. Optionally excluded from production builds via Next.js pageExtensions trick. Marker-comment detection makes it safe to re-run; stale files from earlier template layouts are cleaned up automatically."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion
---

# ADHD Setup Design System Docs Route

Generates a design-system docs page in a Next.js App Router project. Tokens are read live from `globals.css`. Components are statically imported from `adhd.config.ts` at the moment this skill runs — **re-run after editing the components map** to regenerate the static imports.

**Authoritative spec:** `docs/superpowers/specs/2026-05-11-adhd-install-design-system-docs-route.md` (historical name).

## Invariants

1. **No ADHD references in generated files** outside of two filename-style exceptions: the consumer's `adhd.config.ts` filename, and the slash-command name `/adhd:setup-design-system-docs-route` referenced in troubleshooting copy.
2. **adhd.config.ts is NOT modified** by this skill. The skill reads it; the user owns it.
3. **All file writes are idempotent on re-run.** Marker-bearing files are replaced wholesale with the latest templates. Files where the user deleted the marker are left alone. Stale marker-bearing files from earlier template layouts are removed.
4. **Static component imports.** The installer parses `adhd.config.ts` and generates `componentMap.tsx` with explicit `import * as $cmpN from "@/..."` per registered component. The component page does a static lookup — no dynamic imports, no broad Webpack context modules, no Tailwind-blast-radius issues.

## Phase 1: Validate consumer environment

```bash
test -f adhd.config.ts || { echo "Missing adhd.config.ts. Run /adhd:config first."; exit 1; }
test -d app          || { echo "Missing app/ directory. This installer requires the Next.js App Router."; exit 1; }
test -f package.json || { echo "No package.json at the working directory."; exit 1; }
```

Read `package.json` and confirm `next` is in `dependencies` or `devDependencies`. Warn if missing or version < 16; continue anyway.

## Phase 2: Detect existing install

```bash
node plugins/adhd/lib/setup-design-system-docs-route/cli.js detect-install --app-dir .
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
3. **Exclude from production builds?** — default `Yes`.

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

## Phase 6: Patch next.config.ts (only if prod-exclusion: yes)

```bash
node plugins/adhd/lib/setup-design-system-docs-route/cli.js patch-next-config \
  --config "<next.config.path>" \
  --route-url "<routeUrl>"
```

Exit codes:
- `0` — patched successfully (or already at the expected state; idempotent no-op).
- `3` — the file already sets `pageExtensions` to a different value. The CLI prints the existing value on stdout.
- non-zero, non-3 — the file's shape isn't safely patchable. Print the manual patch block (see below) and continue with file installs.

**On exit code 3**, use `AskUserQuestion`: "Your next.config.ts sets pageExtensions to `<existing>`. How do you want to handle it? [Show me the manual patch and continue / Abort]."

Automatic merging is NOT supported in v1. On "Show me the manual patch and continue," print this block and continue with Phase 7:

```ts
pageExtensions: process.env.NODE_ENV === 'production'
  ? ['ts', 'tsx']
  : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],
```

…and tell the user to merge it with their existing `pageExtensions` value by hand. On "Abort," exit with no further changes.

## Phase 7: Write the page files

```bash
node plugins/adhd/lib/setup-design-system-docs-route/cli.js install \
  --config <choices.json>
```

Where `<choices.json>` is a temp file with shape:
```json
{
  "projectRoot": ".",
  "groupName": "(design-system)",
  "routeSegment": "-docs",
  "prodExcluded": true
}
```

The CLI reads `adhd.config.ts` from `<projectRoot>` to discover the components list and `cssEntry`, bakes them into the generated files (including a per-install `componentMap.tsx` with static imports), and prints the list of files it wrote plus the slugs that ended up in the map.

If `adhd.config.ts` is missing, the CLI aborts with `install: failed to read adhd.config.ts ...`. Phase 1 has already guaranteed it exists, so this only fires if the file vanished between phases — rare, but surface the error verbatim.

## Phase 8: Patch robots.txt

```bash
node plugins/adhd/lib/setup-design-system-docs-route/cli.js patch-robots \
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
✓ Design system docs route set up.

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
/adhd:setup-design-system-docs-route to regenerate the static imports.

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
