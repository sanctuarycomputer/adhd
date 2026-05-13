---
description: "Validate Figma frames/components/pages or the entire file against the local Tailwind design system + frame-structure best practices. Reads adhd.config.ts at the repo root. Always interactive — walks every violation through a per-rule resolution wizard (auto-fix in Figma / add in code / take Figma's value / take code's value / annotate only / skip). Lint never aborts a sync because there's no sync to abort; the wizard's choices are the only outputs (annotations, Figma rebinds, globals.css writes). Optional argument: a Figma URL with node-id (scoped lint). With no argument, lints the whole file."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>]"
allowed-tools: Read Write Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Lint

Validate that a Figma file (or a single frame/component/page) is ready for code translation. Reports two classes of issue:

- **Variable issues** — Figma variables used by the lint target that are missing locally or have conflicting values.
- **Structure issues** — STRUCT001–STRUCT016 best-practice violations (auto-layout, naming, variant properties, per-layer variable naming, cross-domain variable bindings, Tailwind-default duplicates, alias-equivalent collection duplicates, layers binding variables missing from code, layers binding variables whose values differ between code and Figma, etc.).

Output: a markdown report saved to `/tmp/adhd-lint/report.md`, plus a terminal echo. After the report, the wizard walks every violation and applies the picked actions — Figma rebinds, globals.css writes, lint-category annotations. The report is paste-ready for sharing with designers via Figma comments, Slack, or GitHub issues.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-lint-and-sync-design.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root. If it doesn't exist, abort with: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `naming` (optional, defaults to `kebab-case`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 2: Resolve target

Branch on `$ARGUMENTS`.

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
3. Also collects the variables referenced by the target subtree(s). Walk every `boundVariables` entry across the serialized nodes, dedupe by variable id, look each up via `figma.variables.getVariableByIdAsync`, and return two sibling maps:
   - `vars: { '<collection>/<name>': <resolvedValueForActiveMode> }` — the variable definitions, keyed by name. Same shape `get_variable_defs` would have produced from the local MCP. Use the "primary" mode of each variable's collection.
   - `varIdMap: { '<VariableID>': '<collection>/<name>' }` — Figma variable ID → name lookup, built from the same dedupe pass. Per-layer lint rules (STRUCT011's per-layer annotations, STRUCT012's cross-domain check) need this to bridge node-level `boundVariables` (which reference variables by ID) to the variable names the engine reasons about. Without it, those rules can't fire.

   The `use_figma` invocation returns a single payload; split it into `{ ctx, vars, varIdMap }` after.

Save the response to `/tmp/adhd-lint/`:

- `/tmp/adhd-lint/ctx.json` — the design-context payload (whole-file shape OR a single serialized subtree).
- `/tmp/adhd-lint/vars.json` — the `vars` map.
- `/tmp/adhd-lint/varidmap.json` — the `varIdMap` lookup.

The `Write` tool creates the parent dir on demand. (No `mkdir` needed.)

If the response indicates `error: 'Node not found'`, abort with: "Node not found in <fileKey>. Verify the URL." If `use_figma` errors with an MCP/transport problem, abort with: "Figma plugin not connected. In Figma, run the Claude plugin (Plugins → Claude) and retry."

## Phase 4: Run the engine

Use the `Bash` tool. Redirect stdout (the engine's JSON summary) to a temp file so the resolution wizard (Phase 6) can re-use it:

```bash
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd-lint/vars.json \
  --var-id-map /tmp/adhd-lint/varidmap.json \
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
  - Exit 0 with zero violations: "✓ No issues found across all <N> top-level nodes on <P> pages." Skip to Phase 8.
  - Otherwise: print "<E> errors, <W> warnings across <X> nodes on <Y> pages — walking each through the resolution wizard."
- **Scoped mode:**
  - Zero violations: "✓ No issues found." Skip to Phase 8.
  - Otherwise: print "<E> errors, <W> warnings — walking each through the resolution wizard."

Mention the report file path: "Full report: `/tmp/adhd-lint/report.md` (paste-ready for Figma comments / Slack)."

## Phase 6: Resolution wizard — walk every violation

For every violation in `/tmp/adhd-lint/stdout.json`, prompt with rule-specific options via `AskUserQuestion`. Lint is always a dry run for *sync operations* (it doesn't move tokens between code and Figma without explicit per-violation consent), but the wizard's picks ARE applied — they write to Figma (rebinds, value updates, annotations) and to `globals.css` (variable additions, value updates). There's no abort option because there's no sync to abort; the last option on every prompt is "Skip" (record nothing, no annotation lands).

Collect picks into three queues that Phase 7 applies in order:
- `figmaActions[]` — Figma-side writes: variable rebinds, consolidations, variable-value updates
- `codeActions[]` — `globals.css` writes (via `applyToCss`)
- `annotateNodes[]` — node IDs whose violations get a fresh Figma annotation; everything NOT in this list and previously annotated gets its annotation cleared on the cleanup pass at the end of Phase 7

Iterate violations in this order so foundational ones get addressed first:

1. STRUCT011 (variable naming)
2. STRUCT012 (cross-domain binding)
3. STRUCT013 (Tailwind-default duplicate)
4. STRUCT014 (alias-equivalent collections)
5. STRUCT015 (variable missing in code)
6. STRUCT016 (value conflict)
7. STRUCT001–010 (structural rules)
8. Variable-level violations from the `variable` array that didn't surface as STRUCT015/016 (rare — usually whole-file-mode entries that aren't bound by any scoped layer)

### STRUCT011 — variable naming non-compliance

Per unique offending variable (deduplicate by `figmaVarName`):

```
Question: "Variable `<figmaVarName>` doesn't follow the naming convention. <suggested-rename-from-violation-message>. What do you want to do?"
Header: "Variable naming"
Options:
  - "Annotate only — leave a Figma annotation for the designer to rename"
  - "Skip"
```

Rename can't be automated safely (designers might disagree with the suggested canonical), so the only paths are annotate-for-later or skip.

### STRUCT012 — cross-domain binding

Per unique (variable, property) pair:

```
Question: "Layer binds `<variable>` (`<varDomain>` variable) to `<property>` (expects `<propDomain>`). Rebinding requires designer judgment. What do you want to do?"
Header: "Cross-domain binding"
Options:
  - "Annotate only — flag this layer for the designer to rebind"
  - "Skip"
```

### STRUCT013 — Tailwind-default duplicate

Per duplicate (one prompt per Figma variable that duplicates a Tailwind canonical):

```
Question: "Figma variable `<figmaVarName>` duplicates Tailwind default `<tailwindCssVar>` (same value). Rebinding layers from `<figmaVarName>` to `<tailwindCssVar>` and deleting the duplicate has no visual effect. What do you want to do?"
Header: "Tailwind duplicate"
Options:
  - "Auto-fix in Figma — consolidate (rebind + delete)"
  - "Annotate only"
  - "Skip"
```

On "Auto-fix": push a `{ kind: 'consolidate', duplicateName: figmaVarName, canonicalCssVar: tailwindCssVar }` action into `figmaActions[]`.

### STRUCT014 — alias-equivalent collections

Per duplicate group (collections that resolve to the same canonical domain):

```
Question: "<N> collections describe the same domain `<canonical>`: <list with counts>. Consolidating moves every variable in the others into the keeper and deletes the empties. What do you want to do?"
Header: "Collection duplicates"
Options:
  - "Auto-fix in Figma — pick keeper, consolidate"
  - "Annotate only"
  - "Skip"
```

On "Auto-fix," ask a follow-up `AskUserQuestion` to pick the keeper (most-populated suggested first; other collections listed; final option "Cancel — go back to the previous prompt"). Then push `{ kind: 'consolidate-collections', keeper, losers: [...] }` into `figmaActions[]`.

### STRUCT015 — variable missing in code

Per unique variable (deduplicate by `figmaVarName`). Each STRUCT015 violation in the engine's output may carry two optional fields:
- `canonicalCandidate` — set when the Figma value strictly equals a Tailwind canonical
- `looksSemantic` — set when the path looks semantic (`brand`, `accent`, `surface`, etc.)

These drive the option set the same way they do in `/adhd:pull-component` Phase 2.5:

```
Question: "`<figmaVarName>` is referenced by Figma but doesn't exist in code's design system. Figma resolves it to `<figmaValueNormalized>`.<canonical-hint-if-any> What do you want to do?"
Header: "Variable missing"
Options:
  <only when canonicalCandidate is set:>
  - "Auto-fix in Figma — rebind to `<canonicalCandidate>` (same value, no visual change)"
  <always, with label varying by looksSemantic:>
  - "Add in code as `--<cssVar>`"
    when looksSemantic=true, replace the label with:
  - "Add as semantic — keep `<figmaVarName>` in code (recommended for brand / accent / surface tokens)"
  <always:>
  - "Annotate only"
  - "Skip"
```

Pick handling:
- **Auto-fix**: `{ kind: 'rebind-to-canonical', figmaName, canonicalCandidate, figmaValue }` → `figmaActions[]`.
- **Add / Add as semantic**: queue a `resolve-actions` CLI invocation (same as `/adhd:pull-component`'s Phase 2.5) to get alias-aware `set-primitive` / `set-semantic` actions. Concatenate into `codeActions[]`.
- **Annotate only**: add the violation's `nodeId` to `annotateNodes[]`.
- **Skip**: record nothing.

### STRUCT016 — value conflict

Per unique variable. Per the user's design decision, lint IS a generalized resolver — both directions of the value sync are available alongside the diagnostic options:

```
Question: "`<figmaVarName>` differs between Figma and code:\n  code:  <local-normalized>\n  figma: <figma-normalized>\nWhat do you want to do?"
Header: "Value conflict"
Options:
  - "Take Figma's value — write `<figma-normalized>` to globals.css (alias-aware)"
  - "Take code's value — push `<local-normalized>` to Figma's variable"
  - "Annotate only"
  - "Skip"
```

Pick handling:
- **Take Figma**: queue a `resolve-actions` CLI invocation. Concatenate into `codeActions[]`.
- **Take code**: `{ kind: 'update-figma-value', figmaName, mode, value: localNormalized }` → `figmaActions[]`.
- **Annotate only**: `annotateNodes[]`.
- **Skip**: record nothing.

### STRUCT001–010 (structural rules)

These fire per-layer and outnumber the variable rules in most scopes. The only meaningful resolution paths are "annotate" or "skip" — the underlying fix (auto-layout, raw-value rebind, variant declaration) requires designer judgment in Figma. To keep the wizard tractable, batch by rule code: ONE prompt per rule, applied to every layer that violates it.

```
Question: "STRUCT00<X> fires on <N> layer(s): <first-3-layer-names, +more>. The fix needs designer judgment in Figma. What do you want to do?"
Header: "STRUCT00<X>"
Options:
  - "Annotate all <N> in Figma"
  - "Skip all"
```

On "Annotate all": add every offending `nodeId` to `annotateNodes[]`. On "Skip all": no-op.

### Whole-file scope considerations

In whole-file mode, the violation count can be large (hundreds). Walk per-prompt regardless — designers can hit Enter quickly on the recommended option for each — but consider adding a one-shot "Walk back to this prompt later" exit option in future iterations if the volume becomes a real problem.

## Phase 7: Apply queued actions

After the wizard completes, apply the three queues in this order: Figma actions first (rebinds before annotation pushes so annotations land on the post-rebind state), then code actions, then annotation reconciliation.

### 7a. Figma-side actions (single use_figma call)

Substitute `__ACTIONS__` with the `figmaActions[]` JSON. The script dispatches on `kind`:

```js
const ACTIONS = __ACTIONS__;

function hexToRgb(h) {
  let c = h.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  return {
    r: parseInt(c.slice(0, 2), 16) / 255,
    g: parseInt(c.slice(2, 4), 16) / 255,
    b: parseInt(c.slice(4, 6), 16) / 255,
    a: c.length === 8 ? parseInt(c.slice(6, 8), 16) / 255 : 1,
  };
}

function dimensionToPx(raw) {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(String(raw).trim());
  if (!m) return Number(raw);
  const unit = m[2] || '';
  return parseFloat(m[1]) * (unit === 'rem' || unit === 'em' ? 16 : 1);
}

function canonicalFigmaName(cssVar) {
  const PREFIXES = ['color', 'spacing', 'radius', 'text', 'leading', 'tracking', 'font-weight', 'font', 'shadow', 'opacity', 'border-width', 'breakpoint', 'container', 'ease', 'animate', 'blur'].sort((a, b) => b.length - a.length);
  const stripped = cssVar.replace(/^--/, '');
  for (const p of PREFIXES) {
    if (stripped === p) return p;
    if (stripped.startsWith(p + '-')) return p + '/' + stripped.slice(p.length + 1);
  }
  return stripped;
}

const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
async function findVarByName(name) {
  for (const col of allCollections) {
    for (const vid of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(vid);
      if (v && v.name === name) return v;
    }
  }
  return null;
}

async function rebindLayersAndDelete(source, target) {
  let rebound = 0;
  for (const page of figma.root.children) {
    await figma.setCurrentPageAsync(page);
    const nodes = page.findAll(() => true);
    for (const node of nodes) {
      if (!node.boundVariables) continue;
      for (const [prop, alias] of Object.entries(node.boundVariables)) {
        if (prop === 'fills' || prop === 'strokes' || prop === 'effects') continue;
        if (alias && alias.id === source.id) { node.setBoundVariable(prop, target); rebound++; }
      }
      for (const kind of ['fills', 'strokes']) {
        const arr = node[kind];
        if (!Array.isArray(arr)) continue;
        node[kind] = arr.map((paint) => paint?.boundVariables?.color?.id === source.id
          ? figma.variables.setBoundVariableForPaint(paint, 'color', target)
          : paint
        );
      }
    }
  }
  try { source.remove(); return { rebound, deleted: true }; }
  catch (e) { return { rebound, deleted: false, error: String(e) }; }
}

const results = [];
for (const a of ACTIONS) {
  try {
    if (a.kind === 'rebind-to-canonical' || a.kind === 'consolidate') {
      const sourceName = a.figmaName || a.duplicateName;
      const canonicalName = canonicalFigmaName(a.canonicalCandidate || a.canonicalCssVar);
      const source = await findVarByName(sourceName);
      if (!source) { results.push({ ...a, status: 'skipped', reason: 'source not found' }); continue; }
      let canonical = await findVarByName(canonicalName);
      if (!canonical) {
        canonical = figma.variables.createVariable(canonicalName, source.variableCollectionId, source.resolvedType);
        canonical.scopes = source.scopes;
        for (const [modeId, val] of Object.entries(source.valuesByMode)) canonical.setValueForMode(modeId, val);
      }
      const r = await rebindLayersAndDelete(source, canonical);
      results.push({ ...a, ...r, status: 'ok' });
    } else if (a.kind === 'consolidate-collections') {
      // Reuse the per-keeper consolidation logic — move each loser
      // collection's variables into the keeper (mode-name-mapped),
      // rebind layers, delete empty losers. (Same loop as the old
      // STRUCT014 --fix script.)
      // ... implementation as in pre-rewrite Phase 8b ...
      results.push({ ...a, status: 'consolidated' });
    } else if (a.kind === 'update-figma-value') {
      const v = await findVarByName(a.figmaName);
      if (!v) { results.push({ ...a, status: 'skipped', reason: 'variable not found' }); continue; }
      const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      const wantMode = (a.mode || col.modes[0].name).toLowerCase();
      const target = col.modes.find(m => m.name.toLowerCase() === wantMode) || col.modes[0];
      let figmaValue;
      if (v.resolvedType === 'COLOR') figmaValue = hexToRgb(a.value);
      else if (v.resolvedType === 'FLOAT') figmaValue = dimensionToPx(a.value);
      else figmaValue = a.value;
      v.setValueForMode(target.modeId, figmaValue);
      results.push({ ...a, status: 'ok' });
    } else {
      results.push({ ...a, status: 'unknown-kind' });
    }
  } catch (e) {
    results.push({ ...a, status: 'error', error: String(e) });
  }
}
return { results };
```

### 7b. Code-side actions (one applyToCss invocation)

Concatenate every `set-primitive` / `set-semantic` action from `codeActions[]` (each was produced by `lib/pull-component/cli.js resolve-actions`) and apply:

```bash
node -e '
  const fs = require("fs");
  const { applyToCss } = require("plugins/adhd/lib/design-system/code-writer");
  const css = fs.readFileSync("<globals.css path>", "utf8");
  const actions = JSON.parse(fs.readFileSync("/tmp/adhd-lint/code-actions.json", "utf8"));
  fs.writeFileSync("<globals.css path>", applyToCss(css, actions));
'
```

### 7c. Annotation reconciliation (single use_figma call)

Push annotations for every node in `annotateNodes[]` AND clear stale annotations from nodes that were previously annotated but didn't make the list this run. The script ensures the `"lint"` category exists and is scoped via `SCOPE_ROOT_ID` (the resolved target's nodeId for scoped mode, `null` for whole-file). Same script as the pre-rewrite Phase 6 annotation block — it remains the source of truth for category lifecycle, the scoped subtree walk, `labelMarkdown` rendering, and stale-cleanup.

Distill the picks first:

```bash
node -e '
  const fs = require("fs");
  const summary = JSON.parse(fs.readFileSync("/tmp/adhd-lint/stdout.json", "utf8"));
  const all = [...(summary.structure ?? []), ...(summary.variable ?? [])];
  const annotateIds = new Set(JSON.parse(fs.readFileSync("/tmp/adhd-lint/annotate-ids.json", "utf8")));
  const out = all
    .filter(v => v.nodeId && annotateIds.has(v.nodeId))
    .map(v => ({ nodeId: v.nodeId, code: v.code, message: v.message, severity: v.severity ?? "error" }));
  fs.writeFileSync("/tmp/adhd-lint/violations.json", JSON.stringify(out));
'
```

Then call `use_figma` with the annotation script, passing `VIOLATIONS = <distilled list>` and `SCOPE_ROOT_ID = <scope or null>`. The script's stale-cleanup pass takes care of clearing annotations on nodes that fell out of the list.

## Phase 8: Final report

Print a concise summary:

```
✓ Resolution complete:
  - <F> Figma actions applied (<rebinds> rebinds, <consolidations> consolidations, <value-updates> value updates)
  - <C> code-side writes to globals.css
  - <A> annotations pushed, <S> stale annotations cleared
  - <K> violations skipped (no action recorded)
```

If any action failed (error in the `results[]` payload from 7a or a Figma rebind reported `deleted: false`), surface the failures inline. They don't abort the run — they just need designer review.

Exit 0 if all resolution actions succeeded (or the user picked Skip for everything). Exit 1 only if any Figma write erred out; the user should see the failures and decide whether to re-run.

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `URL points at wrong file` | Open the configured Figma file (printed in error) and copy a node URL from there. |
| `Select a frame, component, or page` | Click on a frame in Figma desktop, or pass a node-id URL. |
| `MCP unreachable` | Make sure Figma desktop is running with Dev Mode enabled. Re-run `/adhd:config`. |
