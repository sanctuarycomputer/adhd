---
description: "Install a self-generating design-system documentation route into a Next.js consumer app. The route reads adhd.config.ts and globals.css at request time, renders a token catalog (colors / spacing / typography / radius / shadows) plus per-component pages with URL-driven prop toggles. Optionally excluded from production builds via Next.js pageExtensions trick. Re-runnable: marker-comment detection drives updates."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion
---

# ADHD Install Design System Docs Route

One-shot installer that drops a live design-system docs page into a Next.js App Router project. The page reads `adhd.config.ts` and `globals.css` at request time — no regen needed when components or tokens change. Re-running this skill picks up template improvements over time.

**Authoritative spec:** `docs/superpowers/specs/2026-05-11-adhd-install-design-system-docs-route.md`

## Invariants

1. **No ADHD references in generated files** outside of import paths pointing at `adhd.config.ts`. The marker comment is generic.
2. **adhd.config.ts is NOT modified** by this skill. Install choices live in the filesystem.
3. **All file writes are idempotent on re-run.** Marker-bearing files are replaced wholesale with the latest templates. Files where the user deleted the marker are left alone.

## Phase 1: Validate consumer environment

```bash
test -f adhd.config.ts || { echo "Missing adhd.config.ts. Run /adhd:config first."; exit 1; }
test -d app          || { echo "Missing app/ directory. This installer requires the Next.js App Router."; exit 1; }
test -f package.json || { echo "No package.json at the working directory."; exit 1; }
```

Read `package.json` and confirm `next` is in `dependencies` or `devDependencies`. Warn if missing or version < 16; continue anyway.

## Phase 2: Detect existing install

```bash
node plugins/adhd/lib/install-design-system-docs-route/cli.js detect-install --app-dir .
```

Output is newline-separated paths of files containing the marker comment.

- **No matches:** fresh install. Proceed to Phase 3 with defaults.
- **One or more matches:** use `AskUserQuestion`:
  - "Update in place" — re-write the listed marker-bearing files with the latest templates.
  - "Move to new location" — Phase 3 reasks the install questions; files at the old location are NOT deleted (the user manages them).
  - "Abort" — exit with no changes.

If user chose "Update in place," skip ahead to Phase 6 (patch + write) using the existing folder's group/segment as the choice; ask only "Exclude from production builds?" to confirm current state.

## Phase 3: Ask installation choices

Use `AskUserQuestion` three times:

1. **Route URL** — default `/-docs`. Validate: starts with `/`, only `a-z0-9-/` characters, no leading `_`.
2. **Route group** — default `(design-system)`. Validate: parens-wrapped, alphanumerics + hyphens inside, OR empty string for "no group."
3. **Exclude from production builds?** — default `Yes`.

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
node plugins/adhd/lib/install-design-system-docs-route/cli.js patch-next-config \
  --config "<next.config.path>" \
  --route-url "<routeUrl>"
```

Exit code 3 means an existing different `pageExtensions` was detected. The CLI prints the existing value. Use `AskUserQuestion`: "Your next.config.ts sets pageExtensions to `<existing>`. Merge with the design-system extension conditional? [Yes / Show me the manual patch / Abort]."

On "Yes": re-run the CLI without `detectOnly` (currently errors; for v1, print "Manual merge required. Patch the file to combine the existing pageExtensions with the conditional. Example:" and abort). On "Show me the manual patch": print the patch block and continue with file installs.

## Phase 7: Write the page files

```bash
node plugins/adhd/lib/install-design-system-docs-route/cli.js install \
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

The CLI prints the list of files it wrote.

## Phase 8: Patch robots.txt

```bash
node plugins/adhd/lib/install-design-system-docs-route/cli.js patch-robots \
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
✓ Design system docs route installed.

  URL:            http://localhost:3000<routeUrl>
  Filesystem:     app/<group>/<segment>/
  Prod exclusion: <ON | OFF>
  noindex meta:   ON
  robots.txt:     Disallow added

Run `npm run dev` and visit the URL to preview. The page reads adhd.config.ts
and globals.css at request time — no regen needed when you add components or
tokens.

Re-run /adhd:install-design-system-docs-route to pick up improved templates
over time. Files where you've removed the marker comment will be left alone.
```

## Common errors

| Error | Fix-up |
|---|---|
| `Missing adhd.config.ts` | Run `/adhd:config` first. |
| `Missing app/ directory` | This installer requires the Next.js App Router (not Pages Router). |
| `No next.config.* at the project root` | Create one with a default export of `{}`. |
| `Path <X> already exists but is not an installer artifact` | Pick a different route URL or move/delete the existing folder. |
| `next.config.ts sets pageExtensions to <existing>` | Manually merge with the design-system conditional, or skip prod-exclusion. |
