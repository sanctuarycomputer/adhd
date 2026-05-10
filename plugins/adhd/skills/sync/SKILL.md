---
description: "Sync design tokens from a Figma frame, component, component set, or page into this repo's globals.css. Runs the same checks as /adhd:lint, then writes Figma's variable values into globals.css with per-conflict prompts. Optional argument: a Figma URL with node-id. If no argument, uses the current Figma selection."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>]"
allowed-tools: Read Edit Write Bash AskUserQuestion mcp__figma__get_metadata mcp__figma__get_variable_defs mcp__figma__get_design_context
---

# ADHD Sync

Frame-scoped variable sync from Figma → code. Pulls the values of variables referenced by the target Figma frame and writes them into `globals.css`. Auto-applies missing variables; prompts per-conflict when local has a different value.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-lint-and-sync-design.md`

## Phase 1: Validate config (same as /adhd:lint)

Read `adhd.config.ts` at the repo root. If missing, abort: "Run /adhd:config first."

Extract `figma.url` (required), `naming` (optional, defaults to `kebab-case`), and `cssEntry` (or auto-detect `app/globals.css` then `src/app/globals.css`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 2: Resolve target node (same as /adhd:lint)

Parse `$ARGUMENTS`:

- If a Figma URL is provided:
  - Extract the file key (segment after `/design/`).
  - If it doesn't match the file key from `adhd.config.ts`, abort with: "URL points at file <X>, but adhd.config.ts is configured for file <Y>. Pass a URL from the configured file or run /adhd:config to update."
  - Extract the node ID from `?node-id=<id>` (URLs use `-` separator; MCP wants `:` — convert by replacing the first `-` with `:`).
- If no URL is provided: use MCP's current selection (call MCP tools without a `nodeId` argument).

Call `mcp__figma__get_metadata`. Confirm node type is `FRAME`, `COMPONENT`, `COMPONENT_SET`, or `CANVAS`. Otherwise abort with: "Select a frame, component, or page (got: <type>)."

If `get_metadata` errors with "Node not found", abort with: "Node not found in <fileKey>. Verify the URL or selection."
If it errors with "MCP unreachable" / similar, abort with: "Figma MCP not configured. Run /adhd:config to verify setup."

## Phase 3: Fetch from MCP (same as /adhd:lint)

Call `mcp__figma__get_variable_defs` and `mcp__figma__get_design_context` for the resolved node ID.

If either response is empty or has a `truncated: true` flag, surface a warning: "MCP returned a partial response — consider running on a smaller scope (a frame within the page)." Continue with what you have.

Use the `Write` tool to save the MCP response JSON to a temp file:

- Path: `/tmp/adhd/vars.json` (variable defs) and `/tmp/adhd/ctx.json` (design context).
- Content: the literal JSON string from each MCP tool's response.

If `/tmp/adhd/` doesn't exist, the `Write` tool creates the parent dir on demand. (No `mkdir` needed.)

This avoids shell-escaping issues that arise when piping JSON through `echo` — JSON values frequently contain single and double quotes that break `echo '<json>' > file` patterns.

## Phase 4: Run the engine

Same CLI invocation as `/adhd:lint`, writing the report to `adhd-lint-report.md`. Capture stdout (JSON summary).

```bash
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd/vars.json \
  --design-context /tmp/adhd/ctx.json \
  --globals-css <path-from-config-or-auto-detect> \
  --config adhd.config.ts \
  --target "<node-name-from-Phase-2>" \
  --target-url "https://figma.com/design/<fileKey>?node-id=<nodeId-with-hyphen>" \
  --output adhd-lint-report.md
```

## Phase 5: Handle structure issues

Parse the JSON summary's `structure` array.

If any structure violations have `severity: "error"`:
1. Echo the structure section of the report to the user.
2. Use `AskUserQuestion`:
   - Question: "N structure errors found. Proceed with variable sync anyway?"
   - Options: "Proceed — sync variables despite structure errors" / "Abort — fix structure issues in Figma first"
3. If user picks Abort: print "Sync aborted. See adhd-lint-report.md for details." and exit.

If only structure warnings (no errors): print them as a heads-up but continue without prompting.

## Phase 6: Apply missing variables

Parse the JSON summary's `variable` array.

For variables with `status: "missing"`: print one consolidated message:
```
+ Adding 3 missing variables: color/brand/600, space/2xl, radius/pill
```

Apply each by editing `globals.css`:
- Primitives (no `mode` field) → add to the `@theme {}` block.
- Light-mode missing → add to `:root {}` block.
- Dark-mode missing → add to `:root[data-theme="dark"] {}` block.

Use the `Edit` tool to insert the new declarations. Maintain alphabetical ordering within each block when possible.

## Phase 7: Apply conflicts (per-conflict prompt)

For variables with `status: "conflict"`, iterate. Use `AskUserQuestion` once per conflict:

- Question: `<token> (<mode>): local=<localValue>, figma=<figmaValue> — what should happen?`
- Options:
  - "Keep local"
  - "Overwrite with Figma"
  - "Take Figma for ALL remaining conflicts"
  - "Keep local for ALL remaining conflicts"

If the user picks one of the "ALL remaining" options, stop prompting and apply the choice to every remaining conflict in this batch.

For each "Overwrite with Figma" choice (single or batched), use the `Edit` tool to replace the variable's value in the appropriate block (`@theme {}` / `:root {}` / `:root[data-theme="dark"] {}`).

## Phase 8: Commit per domain

After all writes, group changes by domain (color, spacing, radius, typography, shadow). For each domain that received writes, create a commit:

```bash
git add <path-to-globals.css>
git commit -m "ADHD sync: <domain> (<count> changes)"
```

If multiple domains were touched, this produces multiple commits. If none were touched (user kept everything local), no commit.

## Phase 9: Final report

Update `adhd-lint-report.md` with a "Sync result" section listing:
- Variables added (with token + value)
- Variables overwritten (with old + new value)
- Variables kept (with local + figma values, "no change")
- Structure issues (unchanged from Phase 4 report — purely informational)

Echo the sync-result section to the user. Print: "Sync complete. <N> changes across <M> domains. Full report: adhd-lint-report.md."

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config` — the wizard walks you through creating one. |
| `URL points at wrong file` | Open the configured Figma file (printed in error) and copy a node URL from there. |
| `Select a frame, component, or page` | Click on a frame in Figma desktop, or pass a node-id URL. |
| `Figma MCP not configured` / `MCP unreachable` | Make sure Figma desktop is running with Dev Mode enabled. Re-run `/adhd:config` to verify setup. |
| `Edit failed: variable not found in target block` | The variable was expected in `@theme {}` (etc.) but the block doesn't have it. Re-run `/adhd:lint` to confirm classification, then file an issue if the engine is wrong. |
| `git commit failed: nothing to commit` | All conflicts were resolved as "keep local"; no writes were made. Not an error. |
