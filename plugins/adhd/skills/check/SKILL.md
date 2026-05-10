---
description: "Validate a Figma frame, component, component set, or page against the local Tailwind theme + frame-structure best practices. Reads adhd.config.ts at the repo root. Read-only — no writes. Optional argument: a Figma URL with node-id. If no argument, uses the current Figma selection."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>]"
allowed-tools: Read Write Bash mcp__figma__get_metadata mcp__figma__get_variable_defs mcp__figma__get_design_context
---

# ADHD Check

Validate that a Figma frame/page is ready for code translation. Reports two classes of issue:

- **Variable issues** — Figma variables used by the frame that are missing locally or have conflicting values.
- **Structure issues** — STRUCT001–STRUCT010 best-practice violations (auto-layout, naming, variant properties, etc.).

Output: a markdown report saved to `adhd-check-report.md` (gitignored), plus a terminal echo. The report is paste-ready for sharing with designers via Figma comments, Slack, or GitHub issues.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-check-and-sync-design.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root. If it doesn't exist, abort with: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `naming` (optional, defaults to `kebab-case`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 2: Resolve target node

Parse `$ARGUMENTS`:

- If a Figma URL is provided:
  - Extract the file key (segment after `/design/`).
  - If it doesn't match the file key from `adhd.config.ts`, abort with: "URL points at file <X>, but adhd.config.ts is configured for file <Y>. Pass a URL from the configured file or run /adhd:config to update."
  - Extract the node ID from `?node-id=<id>` (note: URLs use `-` separator; MCP wants `:` — convert by replacing the first `-` with `:`).
- If no URL is provided: use MCP's current selection (call MCP tools without a `nodeId` argument).

Call `mcp__figma__get_metadata` with the node ID (or no arg for selection). Confirm:
- Node type is `FRAME`, `COMPONENT`, `COMPONENT_SET`, or `CANVAS` (page). Otherwise abort with: "Select a frame, component, or page (got: <type>)."
- Capture the node's name and ID for the report.

If `get_metadata` errors with "Node not found", abort with: "Node not found in <fileKey>. Verify the URL or selection."
If it errors with "MCP unreachable" / similar, abort with: "Figma MCP not configured. Run /adhd:config to verify setup."

## Phase 3: Fetch from MCP

Call `mcp__figma__get_variable_defs` with the resolved node ID.
Call `mcp__figma__get_design_context` with the resolved node ID.

If either response is empty or has a `truncated: true` flag (or equivalent), surface a warning: "MCP returned a partial response — consider running on a smaller scope (a frame within the page)." Continue with what you have.

Use the `Write` tool to save the MCP response JSON to a temp file:

- Path: `/tmp/adhd/vars.json` (variable defs) and `/tmp/adhd/ctx.json` (design context).
- Content: the literal JSON string from each MCP tool's response.

If `/tmp/adhd/` doesn't exist, the `Write` tool creates the parent dir on demand. (No `mkdir` needed.)

This avoids shell-escaping issues that arise when piping JSON through `echo` — JSON values frequently contain single and double quotes that break `echo '<json>' > file` patterns.

## Phase 4: Run the engine

Use the `Bash` tool:

```bash
node plugins/adhd/lib/check-engine/cli.js \
  --variable-defs /tmp/adhd/vars.json \
  --design-context /tmp/adhd/ctx.json \
  --globals-css <path-from-config-or-auto-detect> \
  --config adhd.config.ts \
  --target "<node-name-from-Phase-2>" \
  --target-url "https://figma.com/design/<fileKey>?node-id=<nodeId-with-hyphen>" \
  --output adhd-check-report.md
```

Globals path resolution: if `adhd.config.ts` has `cssEntry`, use it. Otherwise auto-detect `app/globals.css` then `src/app/globals.css` (matching `/adhd:config`'s logic).

## Phase 5: Present results

Read `adhd-check-report.md` with the `Read` tool and echo it to the user verbatim. Then summarize:

- If exit code 0 and zero violations: "✓ No issues found."
- If exit code 0 with warnings only: "⚠ N warnings (see report). Frame is ready for code translation."
- If exit code 1: "✗ N errors, M warnings. Frame has issues that should be resolved before code translation."

Mention the report file path: "Full report: `adhd-check-report.md` (paste-ready for Figma comments / Slack)."

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `URL points at wrong file` | Open the configured Figma file (printed in error) and copy a node URL from there. |
| `Select a frame, component, or page` | Click on a frame in Figma desktop, or pass a node-id URL. |
| `MCP unreachable` | Make sure Figma desktop is running with Dev Mode enabled. Re-run `/adhd:config`. |
