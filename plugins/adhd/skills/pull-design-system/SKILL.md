---
description: "Pull the design system (variables + named styles) from the configured Figma file into globals.css. Two-way diff with per-attribute conflict prompts; additive (never deletes from code). Reads adhd.config.ts at the repo root."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Pull Design System

Pulls Figma's design tokens (variables + named styles) into the codebase's `globals.css`. Compares both sides; for each conflicting variable, prompts the user; for variables that exist only in Figma, creates them in code; for variables that exist only in code, leaves them alone (additive policy).

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-push-pull-design-system.md`

## Phase 1: Validate config

(Same as /adhd:push-design-system Phase 1.)

## Phase 2: Read both sides

(Same as /adhd:push-design-system Phase 2 — read globals.css, run extract script via use_figma, save both to `/tmp/adhd-pull/`.)

## Phase 3: Run the comparator

```bash
node plugins/adhd/lib/design-system/cli.js compare \
  --code /tmp/adhd-pull/globals.css \
  --figma /tmp/adhd-pull/figma.json \
  --output /tmp/adhd-pull/diff.json
```

If `conflict.length === 0` and `figmaOnly.length === 0`, print "Code is already in sync with Figma. No changes." and exit 0.

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

## Common errors

(Same table as push, plus:)

| Error | Fix-up guidance |
|---|---|
| `globals.css block missing` | The CSS doesn't have an `@theme {}` or `:root {}` block. Pull will create the block as needed. |
| `Edit failed: cannot find variable in target block` | The action expected to update an existing entry but didn't find it. Should never happen if the diff was current; if it does, re-run pull. |
