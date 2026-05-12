---
description: "Validate Figma frames/components/pages or the entire file against the local Tailwind design system + frame-structure best practices. Reads adhd.config.ts at the repo root. Read-only by default; with --annotate, also writes Figma annotations on each offending node in a 'lint' category. Optional argument: a Figma URL with node-id (scoped lint). With no argument, lints the whole file."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>] [--annotate]"
allowed-tools: Read Write Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Lint

Validate that a Figma file (or a single frame/component/page) is ready for code translation. Reports two classes of issue:

- **Variable issues** — Figma variables used by the lint target that are missing locally or have conflicting values.
- **Structure issues** — STRUCT001–STRUCT010 best-practice violations (auto-layout, naming, variant properties, etc.).

Output: a markdown report saved to `/tmp/adhd-lint/report.md`, plus a terminal echo. The report is paste-ready for sharing with designers via Figma comments, Slack, or GitHub issues.

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
   - `fillStyleId`, `strokeStyleId` — paint-style bindings (Figma's legacy design-token mechanism, distinct from variable bindings). The lint engine uses these to recognize style-bound layers and skip the raw-color rule on them.
   - `componentPropertyDefinitions` — **only** when `n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && n.parent?.type !== 'COMPONENT_SET')`. Accessing it on a variant COMPONENT (a child of a COMPONENT_SET) throws.
   - `variantProperties` — only on COMPONENT children of a COMPONENT_SET.
   - `textStyleId`, `effectStyleId`
   - For TEXT: `characters`, `fontSize`, `fontName`
   - For FRAME: `wasInstance`
   - `children` — recursively `serializeNode`-mapped.

   **`figma.mixed` handling.** Several fields return the `figma.mixed` Symbol when a node has per-range variation (most commonly `node.fills` on TEXT with multiple colored spans, `node.fontSize` on multi-size text, `node.fillStyleId` / `node.strokeStyleId` when only some ranges have a style applied). `JSON.stringify` drops Symbols silently — which means a multi-color TEXT layer with raw whites would have its `fills` quietly disappear from the serialized output, and STRUCT003 would never fire on it. Before assigning each potentially-mixed field, coerce: `value === figma.mixed ? "__MIXED__" : value`. The lint engine recognizes the `"__MIXED__"` sentinel and reports it as a STRUCT003 violation with a "mixed paints — bind each range to a variable, or apply a paint style" message, so the violation surfaces instead of disappearing.
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

Use the `Bash` tool. Redirect stdout (the engine's JSON summary) to a temp file so Phase 6 can re-use it for `--annotate`:

```bash
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd-lint/vars.json \
  --design-context /tmp/adhd-lint/ctx.json \
  --globals-css <path-from-config-or-auto-detect> \
  --config adhd.config.ts \
  --target "<target-label>" \
  --target-url "<target-url>" \
  --output /tmp/adhd-lint/report.md \
  > /tmp/adhd-lint/stdout.json
```

Where `<target-label>` is `"Whole file"` in whole-file mode, or `"<page> / <node-name>"` in scoped mode. `<target-url>` is `<figma.url>` (whole-file) or the original URL with node-id (scoped).

Globals path resolution: if `adhd.config.ts` has `cssEntry`, use it. Otherwise auto-detect `app/globals.css` then `src/app/globals.css` (matching `/adhd:config`'s logic).

## Phase 5: Present results

Read `/tmp/adhd-lint/report.md` with the `Read` tool and echo it to the user verbatim. Then summarize:

- **Whole-file mode:**
  - Exit 0 with zero violations: "✓ No issues found across all <N> top-level nodes on <P> pages."
  - Exit 0 with warnings only: "⚠ <W> warnings across <X> nodes on <Y> pages (see report). File is ready for code translation."
  - Exit 1: "✗ <E> errors, <W> warnings across <X> nodes on <Y> pages."
- **Scoped mode:**
  - Exit 0 with zero violations: "✓ No issues found."
  - Exit 0 with warnings only: "⚠ <W> warnings (see report). Frame is ready for code translation."
  - Exit 1: "✗ <E> errors, <W> warnings. Frame has issues that should be resolved before code translation."

Mention the report file path: "Full report: `/tmp/adhd-lint/report.md` (paste-ready for Figma comments / Slack)."

## Phase 6: Optional — annotate offending nodes in Figma (`--annotate`)

If the user passed `--annotate` (the only flag this skill accepts), push each violation to Figma as an annotation on its `nodeId`. ADHD owns a dedicated annotation category named **"lint"** (orange); designer-authored annotations and any other categories are left untouched.

If `--annotate` was NOT passed, skip this phase.

### Inputs

The lint engine's stdout (captured to `/tmp/adhd-lint/stdout.json` during Phase 4) is a JSON object with `variable` and `structure` arrays. Combine them into a flat violation list keeping only items with a `nodeId`:

```bash
node -e '
const r = JSON.parse(require("fs").readFileSync("/tmp/adhd-lint/stdout.json", "utf8"));
const all = [...(r.structure ?? []), ...(r.variable ?? [])].filter(v => v.nodeId);
const out = all.map(v => ({ nodeId: v.nodeId, code: v.code, message: v.message, severity: v.severity ?? "error" }));
require("fs").writeFileSync("/tmp/adhd-lint/violations.json", JSON.stringify(out));
console.log(out.length);
'
```

### The use_figma script

Pass the violations array to `mcp__plugin_figma_figma__use_figma` with `skillNames: "figma-use"`. The script ensures the category exists, applies current violations, and clears stale ADHD annotations file-wide (so a re-run reflects the current state — fixed violations get their annotations cleared automatically).

```js
const VIOLATIONS = /* substituted: contents of /tmp/adhd-lint/violations.json */;
const CATEGORY_LABEL = "lint";
const CATEGORY_COLOR = "orange";

// 1) Ensure the lint category exists (idempotent across runs).
const cats = await figma.annotations.getAnnotationCategoriesAsync();
let cat = cats.find(c => c.label === CATEGORY_LABEL);
if (!cat) {
  cat = await figma.annotations.addAnnotationCategoryAsync({ label: CATEGORY_LABEL, color: CATEGORY_COLOR });
}

// 2) Group violations by nodeId.
const byNode = new Map();
for (const v of VIOLATIONS) {
  if (!byNode.has(v.nodeId)) byNode.set(v.nodeId, []);
  byNode.get(v.nodeId).push(v);
}

// 3) Walk every page to find nodes with prior ADHD annotations + apply updates.
//    Pages load incrementally — use `setCurrentPageAsync` so `findAll` sees their content.
let updated = 0, cleared = 0;
const touchedIds = new Set();

for (const page of figma.root.children) {
  await figma.setCurrentPageAsync(page);
  // Previously-annotated nodes under this page.
  const prior = page.findAll(n =>
    "annotations" in n && (n.annotations ?? []).some(a => a.categoryId === cat.id)
  );
  for (const n of prior) touchedIds.add(n.id);
}

// Union of "previously annotated" and "currently violated" — every node that needs a write.
const allTargetIds = new Set([...touchedIds, ...byNode.keys()]);

for (const id of allTargetIds) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || !("annotations" in node)) continue;
  const keep = (node.annotations ?? []).filter(a => a.categoryId !== cat.id);
  const fresh = (byNode.get(id) ?? []).map(v => ({
    label: `${v.code}: ${v.message}`,
    categoryId: cat.id,
  }));
  const hadAdhd = touchedIds.has(id);
  node.annotations = [...keep, ...fresh];
  if (fresh.length > 0) updated++;
  else if (hadAdhd) cleared++;
}

return { categoryId: cat.id, categoryLabel: cat.label, updated, cleared, totalViolations: VIOLATIONS.length };
```

### Report the result

After the script returns, print one line:

```
✓ Annotated <updated> Figma node(s) in the "lint" category. Cleared <cleared> stale annotation(s).
```

If `updated === 0 && cleared === 0`, print:

```
No node-bound violations to annotate (whole-file violations like pageGrouping are reported but not annotated).
```

### Why a dedicated category

The "lint" category gives designers a one-click filter in Figma's annotations panel and lets us cleanly own/replace our own annotations without touching designer-authored ones. The category persists in the file — even after the user uninstalls ADHD, the annotations remain as plain Figma annotations the designer can edit or delete.

## Phase 7: Offer to annotate when `--annotate` wasn't passed

If `--annotate` was passed, this phase is a no-op (Phase 6 already ran).

If `--annotate` was NOT passed AND the lint produced at least one violation with a `nodeId` (count it from `/tmp/adhd-lint/stdout.json` using the same `node -e` snippet as Phase 6 — count of items in the distilled violations array), use `AskUserQuestion`:

```
Question: "Push these <N> violation(s) to Figma as annotations? They'll appear on the offending nodes in a 'lint' category that designers can filter on."
Header: "Annotate?"
Options:
  - "Yes, annotate them in Figma"
  - "No, skip"
```

On "Yes": run Phase 6 inline (the distill step + the `use_figma` script) and print the result line.

On "No": exit normally with no annotation work done.

If there are zero `nodeId`-bearing violations (e.g. only whole-file violations like `pageGrouping`), skip the prompt — there's nothing to annotate.

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `URL points at wrong file` | Open the configured Figma file (printed in error) and copy a node URL from there. |
| `Select a frame, component, or page` | Click on a frame in Figma desktop, or pass a node-id URL. |
| `MCP unreachable` | Make sure Figma desktop is running with Dev Mode enabled. Re-run `/adhd:config`. |
