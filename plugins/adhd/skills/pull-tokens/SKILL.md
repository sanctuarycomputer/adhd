---
description: "Pull design tokens (variables + named styles) from the configured Figma file into globals.css. Two-way diff with per-attribute conflict prompts; additive (never deletes from code). Reads adhd.config.ts at the repo root. Pass --dry-run to preview without writing."
disable-model-invocation: true
argument-hint: "[--dry-run]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Pull Tokens

Pulls Figma's design tokens (variables + named styles) into the codebase's `globals.css`. Compares both sides; for each conflicting variable, prompts the user; for variables that exist only in Figma, creates them in code; for variables that exist only in code, leaves them alone (additive policy).

Pass `--dry-run` to see exactly what would be added or overwritten without making any changes — no prompts, no writes, no commits.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-push-pull-design-system.md`

## Phase 1: Validate config

(Same as /adhd:push-tokens Phase 1.)

## Phase 2: Read both sides

(Same as /adhd:push-tokens Phase 2 — read globals.css, run extract script via use_figma, save both to `/tmp/adhd-pull/`. Use Strategy B — chunked extraction — for any non-trivial design system; the MCP truncates single-shot responses around 20–30 KB and a full Tailwind v4 color collection blows past that limit. The push SKILL documents the chunked manifest + slice + `cli.js assemble-extract` flow.)

## Phase 3: Run the comparator

```bash
node plugins/adhd/lib/design-system/cli.js compare \
  --code /tmp/adhd-pull/globals.css \
  --figma /tmp/adhd-pull/figma.json \
  --output /tmp/adhd-pull/diff.json
```

If `conflict.length === 0` and `figmaOnly.length === 0`, print "Code is already in sync with Figma. No changes." and exit 0.

## Phase 3b: Dry run (only if `--dry-run` was passed)

If the user invoked `/adhd:pull-tokens --dry-run`, print the preview from the comparator and exit BEFORE the prompt loop. The dry run is a pure discovery tool — no `AskUserQuestion`, no writes, no commits, no MCP traffic beyond Phase 2's extract:

```bash
node plugins/adhd/lib/design-system/cli.js preview \
  --diff /tmp/adhd-pull/diff.json \
  --direction pull
```

The preview lists every variable that would be added to `globals.css` (one row per mode), every variable whose Figma/code values differ (showing both — the dry run intentionally doesn't pre-resolve in favor of either side), and the count of code-only variables that would stay untouched per the additive policy. Echo the output verbatim to the user, then print a one-line summary: `Dry run complete. Re-run without --dry-run to apply (you'll be prompted on each conflict).` Exit 0.

If `--dry-run` was NOT passed, skip this phase and continue to Phase 4.

## Phase 4: Resolve conflicts

For each conflict in `diff.conflict`, use `AskUserQuestion` with:
- "Keep Figma value (overwrite code)" → `{path, mode, winner: 'figma'}`
- "Use code value (no change)" → `{path, mode, winner: 'code'}`
- "Use Figma's values for all N conflicts" → batch confirm
- "Use code's values for all N conflicts" → batch confirm

(Same batch confirm flow as push.)

Save `resolutions.json` to `/tmp/adhd-pull/`.

## Phase 5: Build actions (pull direction)

```bash
node plugins/adhd/lib/design-system/cli.js apply \
  --diff /tmp/adhd-pull/diff.json \
  --resolutions /tmp/adhd-pull/resolutions.json \
  --direction pull \
  --output /tmp/adhd-pull/actions.json
```

Read `/tmp/adhd-pull/actions.json`. Each action has kind `set-primitive`, `set-semantic`, or `set-exposure`.

## Phase 6: Drift check

(Same as push Phase 6 — re-fetch Figma, diff against the original capture, abort on change.)

## Phase 7: Apply actions to globals.css

Use the `Read` tool to read the current `globals.css`. Apply each action by editing the relevant block:

- `set-primitive` → edit/insert in the `@theme {}` block
- `set-semantic` with `mode: light` → edit/insert in `:root {}`
- `set-semantic` with `mode: dark` → edit/insert in `:root[data-theme="dark"]` if it exists, else inside `@media (prefers-color-scheme: dark) :root {}` (create the block if neither exists)
- `set-exposure` → edit/insert in `@theme inline {}`

The block-targeting logic mirrors `lib/design-system/code-writer.js`'s `applyToCss`. To stay deterministic, the recommended approach: write `globals.css` to `/tmp/adhd-pull/globals-original.css`, then run a Bash one-liner that invokes a small Node helper:

```bash
node -e "
const { applyToCss } = require('plugins/adhd/lib/design-system/code-writer.js');
const fs = require('fs');
const css = fs.readFileSync('/tmp/adhd-pull/globals-original.css', 'utf8');
const actions = JSON.parse(fs.readFileSync('/tmp/adhd-pull/actions.json', 'utf8'));
process.stdout.write(applyToCss(css, actions));
" > /tmp/adhd-pull/globals-new.css
```

Then use the `Write` tool to write the new content back to the actual `globals.css` path (resolved in Phase 1).

## Phase 8: Per-domain commit

Group actions by domain (color / spacing / radius / shadow / typography). For each domain that received writes, create a commit:

```bash
git add <path-to-globals.css>
git commit -m "ADHD pull: <domain> (<count> changes)"
```

If multiple domains were touched, multiple commits land. If no domain received writes (all conflicts resolved as "keep code"), no commit.

## Phase 9: Final report

Print:
```
✓ Pulled from Figma:
  - <N> variables added to code
  - <M> conflicts resolved
  - <K> code-only variables left untouched (additive policy)
```

## Phase 10: Offer to sync the docs route

Runs only on success (skip if no changes were applied to `globals.css`). The docs route reads `globals.css` at request time, so the new tokens will appear without any code change — but if the user has also been editing components, re-syncing refreshes `componentMap.tsx`'s baked prop schemas at the same time.

```bash
node plugins/adhd/lib/sync-docs/cli.js detect-install --app-dir .
```

- **Empty output** (route not installed): skip this phase silently.
- **Non-empty output** (route installed): use `AskUserQuestion`:

```
Question: "Re-sync the design-system docs route now? Tokens propagate live, but a re-sync also regenerates componentMap.tsx in case your components changed."
Header: "Sync docs"
Options:
  - "Yes, re-sync now"
  - "No, skip"
```

On "Yes": execute the phases of `/adhd:sync-docs` inline. See `plugins/adhd/skills/sync-docs/SKILL.md`. Existing install choices are preserved.

On "No": print `Run /adhd:sync-docs later to refresh the docs route.` Exit normally.

## Common errors

(Same table as push, plus:)

| Error | Fix-up guidance |
|---|---|
| `globals.css block missing` | The CSS doesn't have an `@theme {}` or `:root {}` block. Pull will create the block as needed. |
| `Edit failed: cannot find variable in target block` | The action expected to update an existing entry but didn't find it. Should never happen if the diff was current; if it does, re-run pull. |
