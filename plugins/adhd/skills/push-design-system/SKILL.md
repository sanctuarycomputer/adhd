---
description: "Push the local design system (globals.css variables + named styles) into the configured Figma file. Two-way diff with per-attribute conflict prompts; additive (never deletes from Figma). Reads adhd.config.ts at the repo root."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Push Design System

Pushes the codebase's design tokens (variables + named styles) into the configured Figma file. Compares both sides; for each conflicting variable, prompts the user; for variables that exist only in code, creates them in Figma; for variables that exist only in Figma, leaves them alone (additive policy).

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-push-pull-design-system.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root with the `Read` tool. If it doesn't exist, abort: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `cssEntry` (optional; auto-detect `app/globals.css` then `src/app/globals.css`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 2: Read both sides

Use the `Read` tool to read the resolved `globals.css` path. Save it to `/tmp/adhd-push/globals.css` via the `Write` tool.

Use `mcp__plugin_figma_figma__use_figma` with the file key, the `figma-use` skill name, and the extract script (load it from `plugins/adhd/lib/design-system/figma-extract-script.js`'s `EXTRACT_SCRIPT` export — the skill instructions are: read the file with `Read`, extract the value of the exported constant). Pass the script as the `code` parameter of `use_figma`. Save the response JSON to `/tmp/adhd-push/figma.json` via the `Write` tool.

## Phase 3: Run the comparator

Use `Bash`:
```bash
node plugins/adhd/lib/design-system/cli.js compare \
  --code /tmp/adhd-push/globals.css \
  --figma /tmp/adhd-push/figma.json \
  --output /tmp/adhd-push/diff.json
```

Read `/tmp/adhd-push/diff.json`. The diff has four arrays: `same`, `conflict`, `codeOnly`, `figmaOnly`.

If `conflict.length === 0` and `codeOnly.length === 0`, print "Figma is already in sync with code. No changes." and exit 0.

## Phase 4: Resolve conflicts via AskUserQuestion

For each conflict in `diff.conflict`, use `AskUserQuestion` with these four options:
- "Keep Figma value (no change)" → resolution `{path, mode, winner: 'figma'}`
- "Use code value (overwrite Figma)" → `{path, mode, winner: 'code'}`
- "Use Figma's values for all N conflicts" → batch confirm (see below)
- "Use code's values for all N conflicts" → batch confirm

If the user picks a batch option, follow up with another `AskUserQuestion`:
- "Apply all" → apply chosen winner to ALL remaining conflicts; continue without further per-conflict prompts
- "Cancel — go back to per-conflict review" → resume per-conflict loop at current position

Build a `resolutions` array of `{path, mode, winner}` objects. Save it to `/tmp/adhd-push/resolutions.json` via the `Write` tool.

## Phase 5: Build actions

```bash
node plugins/adhd/lib/design-system/cli.js apply \
  --diff /tmp/adhd-push/diff.json \
  --resolutions /tmp/adhd-push/resolutions.json \
  --direction push \
  --output /tmp/adhd-push/actions.json
```

Read `/tmp/adhd-push/actions.json`. If empty, print "Nothing to apply." and exit 0.

## Phase 6: Drift check (re-fetch Figma)

Re-run the extract script via `use_figma` (same call as Phase 2). Save the response to `/tmp/adhd-push/figma-recheck.json`. Compare to `/tmp/adhd-push/figma.json` byte-for-byte:

```bash
diff /tmp/adhd-push/figma.json /tmp/adhd-push/figma-recheck.json
```

If they differ, abort with: "Figma drifted during this run. Re-run /adhd:push-design-system to see fresh conflicts." Exit 1.

## Phase 7: Apply actions to Figma

Load the write script from `plugins/adhd/lib/design-system/figma-write-script.js`'s `WRITE_SCRIPT` export. Substitute `__ACTIONS__` with the contents of `/tmp/adhd-push/actions.json` (the actions array, JSON-stringified inline into the script).

Call `mcp__plugin_figma_figma__use_figma` with the substituted script. The response contains `{ applied, errors }`.

If `errors.length > 0`, print the error list and exit 1.

## Phase 8: Final report

Print:
```
✓ Pushed to Figma:
  - <N> variables created
  - <M> conflicts resolved
  - <K> figma-only variables left untouched (additive policy)
```

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `globals.css not found` | Pass `cssEntry` in adhd.config.ts or place the file at `app/globals.css`. |
| `Figma drifted during this run` | Someone changed Figma while you were resolving conflicts. Re-run `/adhd:push-design-system`. |
| `Figma MCP unreachable` | Verify the figma plugin is installed: `claude plugin install figma@claude-plugins-official`. |
