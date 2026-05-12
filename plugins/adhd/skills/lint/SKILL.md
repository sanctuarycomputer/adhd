---
description: "Validate Figma frames/components/pages or the entire file against the local Tailwind design system + frame-structure best practices. Reads adhd.config.ts at the repo root. Read-only by default; with --annotate, also writes Figma annotations on each offending node in a 'lint' category. With --fix, walks STRUCT013 Tailwind-duplicate candidates and applies approved consolidations (rebind + delete). Optional argument: a Figma URL with node-id (scoped lint). With no argument, lints the whole file."
disable-model-invocation: true
argument-hint: "[<figma-url-with-node-id>] [--annotate] [--fix]"
allowed-tools: Read Write Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Lint

Validate that a Figma file (or a single frame/component/page) is ready for code translation. Reports two classes of issue:

- **Variable issues** — Figma variables used by the lint target that are missing locally or have conflicting values.
- **Structure issues** — STRUCT001–STRUCT016 best-practice violations (auto-layout, naming, variant properties, per-layer variable naming, cross-domain variable bindings, Tailwind-default duplicates, alias-equivalent collection duplicates, layers binding variables missing from code, layers binding variables whose values differ between code and Figma, etc.).

Output: a markdown report saved to `/tmp/adhd-lint/report.md`, plus a terminal echo. The report is paste-ready for sharing with designers via Figma comments, Slack, or GitHub issues.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-lint-and-sync-design.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root. If it doesn't exist, abort with: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `naming` (optional, defaults to `kebab-case`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 1.5: Validate flag combinations

Before anything else, scan `$ARGUMENTS` for incompatible flag pairs and abort immediately if any are present:

- **`--fix` + `--dry-run` →** abort with: "`--fix` and `--dry-run` are mutually exclusive: `--fix` applies consolidations; `--dry-run` previews without changes. Drop one. (Note: `/adhd:lint` doesn't have a `--dry-run` mode of its own — the per-candidate `AskUserQuestion` in Phase 8 already gives you preview-then-approve. The `--dry-run` flag belongs to `/adhd:push-tokens` and `/adhd:pull-tokens`.)"

This guard exists because designers who've seen `--dry-run` work on push/pull-tokens may reflexively try the same flag combination on lint. Failing loudly is safer than silently picking one interpretation.

## Phase 2: Resolve target

Branch on `$ARGUMENTS`. The arguments can include a URL plus flags (`--annotate`, `--fix`) in any order; pull flags out first, then look at what remains.

- **Empty (or flags only) → whole-file mode.** Skip target resolution. The extract script (Phase 3) will return ALL pages and ALL top-level lintable nodes (COMPONENT_SET, top-level COMPONENT, top-level FRAME) on each page. Set `target = "Whole file"` and `targetUrl = <figma.url from config>`.
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

Use the `Bash` tool. Redirect stdout (the engine's JSON summary) to a temp file so Phase 6 can re-use it for `--annotate`:

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

Pass the violations array to `mcp__plugin_figma_figma__use_figma` with `skillNames: "figma-use"`. The script ensures the category exists, applies current violations, and clears stale "lint"-category annotations — **scoped to whatever the current lint covered**. This is important: scoped lints (Phase 2 with a target nodeId) should ONLY touch annotations within the scoped subtree, never wipe annotations on unrelated frames that this run didn't lint. Whole-file lints walk every page.

Inject `SCOPE_ROOT_ID` from Phase 2's resolved target: the nodeId for scoped mode, `null` for whole-file mode. The script branches on it.

```js
const VIOLATIONS = /* substituted: contents of /tmp/adhd-lint/violations.json */;
const SCOPE_ROOT_ID = /* substituted: scoped target's nodeId, or null for whole-file */;
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

// 3) Find previously-annotated nodes WITHIN THE LINT'S SCOPE.
//    Pages load incrementally — use `setCurrentPageAsync` so `findAll`
//    sees their content. The scope branch is critical: a scoped lint on
//    UserAvatar must not wipe a STRUCT010 annotation that lives on Logotype
//    — that frame wasn't part of this run.
let updated = 0, cleared = 0;
const touchedIds = new Set();

if (SCOPE_ROOT_ID) {
  // Scoped: walk only the scope's subtree (root + descendants).
  const scopeRoot = await figma.getNodeByIdAsync(SCOPE_ROOT_ID);
  if (!scopeRoot) return { error: "Scope root not found", SCOPE_ROOT_ID };
  // Set page context so findAll sees descendants.
  let page = scopeRoot;
  while (page.parent && page.type !== "PAGE") page = page.parent;
  if (page && page.type === "PAGE") await figma.setCurrentPageAsync(page);
  // Include the scope root itself if it has prior annotations (STRUCT011's
  // aggregated message attaches there).
  if ("annotations" in scopeRoot && (scopeRoot.annotations ?? []).some(a => a.categoryId === cat.id)) {
    touchedIds.add(scopeRoot.id);
  }
  if (typeof scopeRoot.findAll === "function") {
    const prior = scopeRoot.findAll(n =>
      "annotations" in n && (n.annotations ?? []).some(a => a.categoryId === cat.id)
    );
    for (const n of prior) touchedIds.add(n.id);
  }
} else {
  // Whole-file: walk every page.
  for (const page of figma.root.children) {
    await figma.setCurrentPageAsync(page);
    const prior = page.findAll(n =>
      "annotations" in n && (n.annotations ?? []).some(a => a.categoryId === cat.id)
    );
    for (const n of prior) touchedIds.add(n.id);
  }
}

// Union of "previously annotated" and "currently violated" — every node that needs a write.
const allTargetIds = new Set([...touchedIds, ...byNode.keys()]);

for (const id of allTargetIds) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || !("annotations" in node)) continue;
  const keep = (node.annotations ?? []).filter(a => a.categoryId !== cat.id);
  const fresh = (byNode.get(id) ?? []).map(v => {
    // labelMarkdown renders newlines and bullet lists (used by STRUCT011's
    // aggregated variable-naming message); label collapses them to spaces.
    // Prefer labelMarkdown when the message contains a newline.
    const text = `${v.code}: ${v.message}`;
    return text.includes("\n")
      ? { labelMarkdown: text, categoryId: cat.id }
      : { label: text, categoryId: cat.id };
  });
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

## Phase 8: Optional — consolidate Tailwind duplicates (`--fix`)

If the user passed `--fix`, walk every STRUCT013 violation in `/tmp/adhd-lint/stdout.json` and offer to consolidate each one. Each STRUCT013 entry has `figmaVarName`, `figmaVarId`, and `tailwindCssVar` fields that drive the rebind.

**Strict-match guarantee.** STRUCT013 only fires when the Figma variable's normalized name AND value both match a Tailwind v4 default — semantic variables like `Color/MyZinc` (different name, coincidental value match) are never surfaced. The `--fix` flow inherits that precision; it can't accidentally migrate a semantic variable.

If `--fix` was NOT passed, skip this phase. If `--fix` was passed but there are no STRUCT013 violations, print `No Tailwind duplicates to consolidate.` and continue.

### Pre-flight: the canonical must exist in Figma

`--fix` rebinds layers from the duplicate to the canonical Tailwind variable. For that to work, the canonical variable has to actually exist in the Figma file (i.e. the user has already run `/adhd:push-tokens` to populate the Tailwind defaults). Before prompting, check the canonical names against `/tmp/adhd-lint/varidmap.json`:

```bash
node -e '
const fs = require("fs");
const idMap = JSON.parse(fs.readFileSync("/tmp/adhd-lint/varidmap.json", "utf8"));
const summary = JSON.parse(fs.readFileSync("/tmp/adhd-lint/stdout.json", "utf8"));
const struct013 = (summary.structure ?? []).filter(v => v.rule === "STRUCT013");
const nameToId = Object.fromEntries(Object.entries(idMap).map(([id, name]) => [name, id]));
// Expected canonical Figma name = the tailwindCssVar with `--` stripped,
// matched against any Figma variable whose normalized name aligns. The
// quick-and-dirty form: look for an exact match on the slashed equivalent
// (e.g. "Color/white" for "--color-white"). Designers who pushed via
// /adhd:push-tokens get this naming by default.
const out = struct013.map(v => {
  const canonical = v.tailwindCssVar.replace(/^--/, "").replace(/^([a-z]+)-/, "$1/");
  const canonicalId = nameToId[canonical] ?? null;
  return { ...v, canonicalFigmaName: canonical, canonicalFigmaId: canonicalId };
});
fs.writeFileSync("/tmp/adhd-lint/struct013-resolved.json", JSON.stringify(out, null, 2));
console.log(out.filter(x => x.canonicalFigmaId).length + "/" + out.length);
'
```

If the printed count shows fewer resolved than total (e.g. `2/4`), at least one canonical isn't in Figma yet. Print:

```
⚠ <N> STRUCT013 candidates can't be auto-fixed yet — the canonical Tailwind
variable isn't in Figma. Run /adhd:push-tokens first (it'll add the missing
canonicals), then re-run /adhd:lint --fix.

Remaining <M> candidate(s) with canonicals present will be offered for
consolidation now.
```

Continue with the resolved subset.

### Per-candidate prompts

For each resolved candidate, use `AskUserQuestion`:

```
Question: "Consolidate `<figmaVarName>` into Tailwind default `<tailwindCssVar>`? Every layer that uses `<figmaVarName>` will be rebound to the canonical, and the duplicate will be deleted from Figma."
Header: "Consolidate?"
Options:
  - "Yes — rebind + delete"
  - "No — skip this one"
  - "Yes to all remaining"
  - "Cancel — stop"
```

If "Yes to all remaining," skip further prompts and queue every remaining candidate. If "Cancel," exit the loop. Collect the approved set into `/tmp/adhd-lint/fix-actions.json` as `[{ duplicateId, canonicalId, duplicateName, canonicalName }, ...]`.

If the approved set is empty, print `Nothing to consolidate.` and return.

### Apply via use_figma

Substitute `__ACTIONS__` with the JSON contents of `/tmp/adhd-lint/fix-actions.json` and call `mcp__plugin_figma_figma__use_figma`:

```js
const ACTIONS = /* substituted */;

// For each consolidation: walk every page, rebind every layer that
// references the duplicate variable to the canonical, then delete the
// duplicate. Atomicity matters — if the rebind fails partway, we'd be
// left with broken bindings. We deliberately scope per-variable so a
// failure on one consolidation doesn't taint the others.
const results = [];
for (const action of ACTIONS) {
  const { duplicateId, canonicalId, duplicateName, canonicalName } = action;
  const dupVar = await figma.variables.getVariableByIdAsync(duplicateId);
  const canVar = await figma.variables.getVariableByIdAsync(canonicalId);
  if (!dupVar || !canVar) {
    results.push({ duplicateName, status: "skipped", reason: "variable not found" });
    continue;
  }

  let rebound = 0;
  for (const page of figma.root.children) {
    await figma.setCurrentPageAsync(page);
    const nodes = page.findAll(() => true);
    for (const node of nodes) {
      if (!node.boundVariables) continue;
      // Top-level scalar bindings (letterSpacing, padding*, *Radius, etc.)
      for (const [prop, alias] of Object.entries(node.boundVariables)) {
        if (prop === "fills" || prop === "strokes" || prop === "effects") continue;
        if (alias && alias.id === duplicateId) {
          node.setBoundVariable(prop, canVar);
          rebound++;
        }
      }
      // Per-paint color bindings on fills + strokes.
      for (const kind of ["fills", "strokes"]) {
        const arr = node[kind];
        if (!Array.isArray(arr)) continue;
        const next = arr.map((paint) => {
          if (paint?.boundVariables?.color?.id === duplicateId) {
            rebound++;
            return figma.variables.setBoundVariableForPaint(paint, "color", canVar);
          }
          return paint;
        });
        node[kind] = next;
      }
    }
  }

  // Delete the duplicate. Will fail if it's still referenced anywhere we
  // missed (effect colors, text-range bindings, etc.) — caller surfaces
  // the error and the variable stays alive.
  try {
    dupVar.remove();
    results.push({ duplicateName, canonicalName, rebound, status: "ok" });
  } catch (e) {
    results.push({ duplicateName, canonicalName, rebound, status: "rebound-only", error: String(e) });
  }
}

return { results };
```

### Report

Echo each result line:

```
✓ Consolidated `<duplicateName>` → `<canonicalName>` (<rebound> layer(s) rebound, duplicate deleted)
```

Or, on `rebound-only`:

```
⚠ Rebound `<duplicateName>` → `<canonicalName>` (<rebound> layer(s)) but could not delete the duplicate: <error>. It's no longer referenced by any visible layer; you can delete it manually if you confirm nothing else uses it.
```

Continue to Phase 8b if any STRUCT014 violations exist. Otherwise exit normally.

## Phase 8b: Consolidate duplicate collections (`--fix`, STRUCT014)

If `--fix` was passed AND `/tmp/adhd-lint/stdout.json` contains STRUCT014 violations, walk each duplicate group and offer to consolidate. Each STRUCT014 entry has `canonical` (the Tailwind domain) and `collections` (array of `{ name, varCount }` for the duplicate collections in that group, sorted by varCount descending).

If no STRUCT014 violations exist, skip this phase.

### Per-group prompts

For each group, use `AskUserQuestion`. The first option is the most-populated collection (the natural "keep this one" choice):

```
Question: "<N> Figma collections describe the same domain (`<canonical>`): <list with counts>. Which should be the keeper? Every variable in the others will be moved into the keeper (their layer bindings update automatically), then the empty collections are deleted."
Header: "Consolidate"
Options:
  - "Keep \"<most-populated>\" (<count> vars)"            // first option
  - "Keep \"<next>\" (<count> vars)"
  - ... one per remaining collection ...
  - "Skip — don't consolidate this group"                 // last option
```

If "Skip," move to the next group. Otherwise record `{ canonical, keeper: '<chosen name>', losers: [<other names>] }` into a running array.

### Apply via use_figma

After every group is decided, write the consolidation plan to `/tmp/adhd-lint/struct014-actions.json` and call `mcp__plugin_figma_figma__use_figma`. The script discovers each collection by name (case-insensitive), iterates every variable in the losers, creates an equivalent in the keeper, rebinds layers, deletes the original.

```js
const ACTIONS = /* substituted: contents of struct014-actions.json */;

const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
const findColl = (name) => allCollections.find(c => c.name.toLowerCase().trim() === name.toLowerCase().trim()) || null;

const results = [];
for (const action of ACTIONS) {
  const { keeper, losers } = action;
  const keeperColl = findColl(keeper);
  if (!keeperColl) {
    results.push({ canonical: action.canonical, status: "skipped", reason: "keeper collection not found: " + keeper });
    continue;
  }

  // Map of variable name (within collection) → variable id, for the keeper.
  // Used to detect name collisions before creating duplicates within the keeper.
  const keeperByName = new Map();
  for (const vid of keeperColl.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (v) keeperByName.set(v.name, v);
  }

  let moved = 0, skippedCollision = 0, deletedColls = 0;
  const collisions = [];

  for (const loserName of losers) {
    const loserColl = findColl(loserName);
    if (!loserColl) continue;
    const loserVarIds = [...loserColl.variableIds];

    for (const vid of loserVarIds) {
      const oldVar = await figma.variables.getVariableByIdAsync(vid);
      if (!oldVar) continue;

      // Name collision in the keeper? Skip the move and surface the
      // conflict — we don't want to silently clobber a same-named
      // variable that has different value or scopes.
      if (keeperByName.has(oldVar.name)) {
        collisions.push({ varName: oldVar.name, loserColl: loserName, keeperColl: keeper });
        skippedCollision++;
        continue;
      }

      // Create the replacement in the keeper with the same name + type.
      const newVar = figma.variables.createVariable(oldVar.name, keeperColl, oldVar.resolvedType);
      newVar.scopes = oldVar.scopes;
      newVar.description = oldVar.description;

      // Copy values per mode. The keeper and the loser may have different
      // mode IDs even with the same mode names — map by name.
      const keeperModesByName = new Map(keeperColl.modes.map(m => [m.name, m.modeId]));
      for (const [oldModeId, value] of Object.entries(oldVar.valuesByMode)) {
        const oldMode = loserColl.modes.find(m => m.modeId === oldModeId);
        const targetModeId = oldMode && keeperModesByName.get(oldMode.name);
        if (targetModeId) newVar.setValueForMode(targetModeId, value);
      }
      keeperByName.set(newVar.name, newVar);

      // Rebind every layer using the old variable to the new one.
      for (const page of figma.root.children) {
        await figma.setCurrentPageAsync(page);
        const nodes = page.findAll(() => true);
        for (const node of nodes) {
          if (!node.boundVariables) continue;
          for (const [prop, alias] of Object.entries(node.boundVariables)) {
            if (prop === "fills" || prop === "strokes" || prop === "effects") continue;
            if (alias && alias.id === oldVar.id) node.setBoundVariable(prop, newVar);
          }
          for (const kind of ["fills", "strokes"]) {
            const arr = node[kind];
            if (!Array.isArray(arr)) continue;
            node[kind] = arr.map((paint) => paint?.boundVariables?.color?.id === oldVar.id
              ? figma.variables.setBoundVariableForPaint(paint, "color", newVar)
              : paint
            );
          }
        }
      }

      try { oldVar.remove(); moved++; }
      catch (e) { results.push({ canonical: action.canonical, status: "remove-failed", varName: oldVar.name, error: String(e) }); }
    }

    // Delete the loser collection if it's now empty.
    if (loserColl.variableIds.length === 0) {
      try { loserColl.remove(); deletedColls++; }
      catch (e) { results.push({ canonical: action.canonical, status: "collection-remove-failed", collName: loserName, error: String(e) }); }
    }
  }
  results.push({ canonical: action.canonical, keeper, moved, skippedCollision, deletedColls, collisions, status: "ok" });
}

return { results };
```

### Report

For each successful group:

```
✓ Consolidated <N> collections into `<keeper>` (<moved> variables moved, <deletedColls> empty collections removed)
```

If any name collisions surfaced (`skippedCollision > 0`):

```
⚠ <count> variable(s) in <loserColl> couldn't be moved into <keeperColl> — a variable with the same name already exists there with a potentially different value. Inspect manually in the Figma variables panel and decide which to keep:
  - <varName>
  - <varName>
  ...
```

Then exit normally.

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `URL points at wrong file` | Open the configured Figma file (printed in error) and copy a node URL from there. |
| `Select a frame, component, or page` | Click on a frame in Figma desktop, or pass a node-id URL. |
| `MCP unreachable` | Make sure Figma desktop is running with Dev Mode enabled. Re-run `/adhd:config`. |
