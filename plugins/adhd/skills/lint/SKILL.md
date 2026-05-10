---
description: "Validate Figma frames/components/pages or the entire file against the local Tailwind design system + frame-structure best practices. Reads adhd.config.ts at the repo root. Read-only — no writes. Optional argument: a Figma URL with node-id (scoped lint). With no argument, lints the whole file."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>]"
allowed-tools: Read Write Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Lint

Validate that a Figma file (or a single frame/component/page) is ready for code translation. Reports two classes of issue:

- **Variable issues** — Figma variables used by the lint target that are missing locally or have conflicting values.
- **Structure issues** — STRUCT001–STRUCT010 best-practice violations (auto-layout, naming, variant properties, etc.).

Output: a markdown report saved to `adhd-lint-report.md` (gitignored), plus a terminal echo. The report is paste-ready for sharing with designers via Figma comments, Slack, or GitHub issues.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-lint-and-sync-design.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root. If it doesn't exist, abort with: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `naming` (optional, defaults to `kebab-case`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 2: Resolve target

Branch on `$ARGUMENTS`:

- **Empty argument → whole-file mode.** Skip target resolution. The extract script (Phase 3) will return ALL pages and ALL top-level lintable nodes (COMPONENT_SET, top-level COMPONENT, top-level FRAME) on each page. Set `target = "Whole file"` and `targetUrl = <figma.url from config>`.
- **URL provided → scoped mode.**
  - Extract the file key (segment after `/design/`).
  - If it doesn't match the file key from `adhd.config.ts`, abort with: "URL points at file <X>, but adhd.config.ts is configured for file <Y>. Pass a URL from the configured file or run /adhd:config to update."
  - Extract the node ID from `?node-id=<id>` (note: URLs use `-` separator; MCP wants `:` — convert by replacing the first `-` with `:`).
  - Capture the node ID for use in Phase 3. The node's name and type are filled in once the extract returns.

## Phase 3: Extract from Figma via use_figma

Construct a JS string for `mcp__plugin_figma_figma__use_figma` that:

1. Defines a `serializeNode(n)` helper that captures a node and its descendants. Fields to capture (when present):
   - `id`, `name`, `type`
   - `layoutMode`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `itemSpacing`, `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius`
   - `fills`, `strokes`, `effects`, `boundVariables`
   - `componentPropertyDefinitions` — **only** when `n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && n.parent?.type !== 'COMPONENT_SET')`. Accessing it on a variant COMPONENT (a child of a COMPONENT_SET) throws.
   - `variantProperties` — only on COMPONENT children of a COMPONENT_SET.
   - `textStyleId`, `effectStyleId`
   - For TEXT: `characters`, `fontSize`, `fontName`
   - For FRAME: `wasInstance`
   - `children` — recursively `serializeNode`-mapped.
2. Branches on a `nodeId` parameter (passed via the `inputs` object on `use_figma`):
   - **Whole-file** (no `nodeId`): walk `figma.root.children` (pages); for each page, find children whose type is `COMPONENT_SET`, or `COMPONENT` (top-level only — i.e. parent is the page, not nested), or `FRAME` (top-level). Serialize each. Return `{ mode: 'whole-file', pages: [{ id, name, nodes: [...serialized...] }, ...] }`.
   - **Scoped** (`nodeId` provided): `await figma.getNodeByIdAsync(nodeId)`; if missing, return `{ error: 'Node not found' }`; otherwise `serializeNode(node)` and return it directly (no `mode` field).
3. Also collects the variables referenced by the target subtree(s). Walk every `boundVariables` entry across the serialized nodes, dedupe by variable id, look each up via `figma.variables.getVariableByIdAsync`, and return a sibling map `{ vars: { '<collection>/<name>': <resolvedValueForActiveMode> } }`. Use the "primary" mode of each variable's collection. (This is the same shape `get_variable_defs` would have produced from the local MCP.)

   The `use_figma` invocation returns a single payload; split it into `{ ctx, vars }` after.

Save the response to `/tmp/adhd-lint/`:

- `/tmp/adhd-lint/ctx.json` — the design-context payload (whole-file shape OR a single serialized subtree).
- `/tmp/adhd-lint/vars.json` — the `vars` map.

The `Write` tool creates the parent dir on demand. (No `mkdir` needed.)

If the response indicates `error: 'Node not found'`, abort with: "Node not found in <fileKey>. Verify the URL." If `use_figma` errors with an MCP/transport problem, abort with: "Figma plugin not connected. In Figma, run the Claude plugin (Plugins → Claude) and retry."

## Phase 4: Run the engine

Use the `Bash` tool:

```bash
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd-lint/vars.json \
  --design-context /tmp/adhd-lint/ctx.json \
  --globals-css <path-from-config-or-auto-detect> \
  --config adhd.config.ts \
  --target "<target-label>" \
  --target-url "<target-url>" \
  --output adhd-lint-report.md
```

Where `<target-label>` is `"Whole file"` in whole-file mode, or `"<page> / <node-name>"` in scoped mode. `<target-url>` is `<figma.url>` (whole-file) or the original URL with node-id (scoped).

Globals path resolution: if `adhd.config.ts` has `cssEntry`, use it. Otherwise auto-detect `app/globals.css` then `src/app/globals.css` (matching `/adhd:config`'s logic).

## Phase 5: Present results

Read `adhd-lint-report.md` with the `Read` tool and echo it to the user verbatim. Then summarize:

- **Whole-file mode:**
  - Exit 0 with zero violations: "✓ No issues found across all <N> top-level nodes on <P> pages."
  - Exit 0 with warnings only: "⚠ <W> warnings across <X> nodes on <Y> pages (see report). File is ready for code translation."
  - Exit 1: "✗ <E> errors, <W> warnings across <X> nodes on <Y> pages."
- **Scoped mode:**
  - Exit 0 with zero violations: "✓ No issues found."
  - Exit 0 with warnings only: "⚠ <W> warnings (see report). Frame is ready for code translation."
  - Exit 1: "✗ <E> errors, <W> warnings. Frame has issues that should be resolved before code translation."

Mention the report file path: "Full report: `adhd-lint-report.md` (paste-ready for Figma comments / Slack)."

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `URL points at wrong file` | Open the configured Figma file (printed in error) and copy a node URL from there. |
| `Select a frame, component, or page` | Click on a frame in Figma desktop, or pass a node-id URL. |
| `MCP unreachable` | Make sure Figma desktop is running with Dev Mode enabled. Re-run `/adhd:config`. |
