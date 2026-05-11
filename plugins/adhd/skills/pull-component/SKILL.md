---
description: "Pull a Figma Component Set into a React component source file. Inverse of /adhd:push-component. Updates only design-token lookup tables and union type members — function body, JSX, hooks, handlers, and imports are never modified. Reads adhd.config.ts and uses the mapping at components.<path>.figma.url. Pre-flight validates the Figma source using the same lint engine /adhd:lint uses; structural violations abort the pull."
disable-model-invocation: true
argument-hint: "<react-path | figma-url> [--allow-unbound]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Pull Component

Reconciles a Figma Component Set back into a React source file. The model (you) is the diff/apply engine: read both sides, compute the diff in working memory, prompt the user, apply edits via the Edit tool. Lookup tables and union types only — the function body is invariant.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-pull-component.md`

---

## Invariants (apply throughout)

1. **Function body untouched.** You may modify exported type aliases, the props interface, and top-level `Record<Union, string>` (or 2-axis) lookup table object literals. You must NOT modify the exported function declaration, its body, its JSX return, hooks, event handlers, or imports.
2. **Edit tool, not Write.** For updates, use `Edit` calls with `old_string` / `new_string`. Edit preserves whitespace, comments, and surrounding code by construction. Only use `Write` in scaffold mode (creating a new file).
3. **One Component Set per invocation.** If `node-id` resolves to anything else, abort.
4. **Read the spec when in doubt.** The spec at `docs/superpowers/specs/2026-05-10-adhd-pull-component.md` is the contract.

---

## Phase 1: Validate config

Use `Read` on `adhd.config.ts` (in the current working directory). Confirm `figma.url` is set. If the file is missing or `figma.url` is absent, abort:

> "Run /adhd:config first to set up ADHD."

Save the resolved file-level Figma URL and file key for later validation.

## Phase 2: Resolve target

Parse `$ARGUMENTS`. First positional is either a path (existing file, relative or absolute) or a Figma URL (starts with `https://`).

Detect `--allow-unbound` flag if present.

Use `Bash` to invoke the config-writer CLI for path/URL resolution:

```bash
# Path form:
node plugins/adhd/lib/pull-component/cli.js config-read \
  --config adhd.config.ts \
  --path "<relative-path>"
# Exit 0 with URL on stdout = update mode. Exit 1 = no mapping.

# URL form:
node plugins/adhd/lib/pull-component/cli.js config-reverse \
  --config adhd.config.ts \
  --figma-url "<url>"
# Exit 0 with path on stdout = update mode. Exit 1 = scaffold mode.
```

Branch:
- **Path form, mapping found:** `update` mode. Use the returned URL.
- **Path form, no mapping (exit 1):** abort with "No Figma mapping for `<path>`. Push it first with /adhd:push-component, or pass a Figma URL to scaffold."
- **URL form, mapping found:** `update` mode. Use the returned path.
- **URL form, no mapping:** `scaffold` mode. Use `AskUserQuestion` to ask: "Where should this component be created? (relative path from adhd.config.ts directory)". Validate via `Bash` that the path doesn't exist (`test ! -e <path>`); if it exists, abort.

Validate that the resolved Figma URL's file key matches `config.figma.url`'s file key (the segment between `/design/` and the next `/`). If different, abort with: "URL points at file `<X>`, but adhd.config.ts is configured for file `<Y>`."

Save resolved `{ mode, path, figmaUrl }` to working memory.

## Phase 2.5: Pre-flight lint

Extract the Figma node-id from the URL (`?node-id=A-B` → `A:B`). Use `mcp__plugin_figma_figma__use_figma` to:
1. Resolve the node by id; if not a `COMPONENT_SET` or top-level `COMPONENT`, abort: "Target node `<id>` is a `<type>`. Pull requires a Component Set."
2. Serialize the node's structural data (the same way /adhd:lint does for scoped mode — fields: `id, name, type, layoutMode, padding*, itemSpacing, cornerRadius, *Radius, fills, strokes, effects, boundVariables, componentPropertyDefinitions, variantProperties, textStyleId, effectStyleId, characters, fontSize, fontName`, recursing into children).
3. Collect the variable defs (walk boundVariables, look each up via `figma.variables.getVariableByIdAsync`, emit a `{ vars: { 'collection/name': value } }` map).

Save both via `Bash` heredoc to:
- `/tmp/adhd-pull-component/ctx.json`
- `/tmp/adhd-pull-component/vars.json`

Run the lint engine:

```bash
mkdir -p /tmp/adhd-pull-component
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd-pull-component/vars.json \
  --design-context /tmp/adhd-pull-component/ctx.json \
  --globals-css example/app/globals.css \
  --config adhd.config.ts \
  --target "PullComponent Preflight" \
  --target-url "<figma-url>" \
  --output /tmp/adhd-pull-component/preflight.md
```

Use the globals.css path from `config.cssEntry` if set, otherwise auto-detect: `example/app/globals.css` → `app/globals.css` → `src/app/globals.css`.

Use `Read` on `/tmp/adhd-pull-component/preflight.md`. Scan for STRUCT003/004/005 (variable-binding errors). Other rules' violations are noted for the final report but don't block.

**If variable-binding errors exist:**

Check whether the escape is active:
- `--allow-unbound` CLI flag, OR
- `components.<path>.allowUnboundFigma === true` in config (use `Bash` + a small `node -e` to inspect)

**Without escape:** abort with the helpful error, listing each offending layer:

```
✗ Cannot pull — the Figma Component Set has <N> unbound values:

  • <variant-path> > <layer-name> — raw <property> <value> (not a variable)
  ...

These need to be bound to design-system variables before we can pull. The designer can:
  1. Bind them in Figma (right-click the layer → "Apply variable")
  2. Or create new variables if these are new design tokens, then run
     /adhd:pull-design-system first, then re-run /adhd:pull-component

We don't generate arbitrary Tailwind classes like text-[20px] or h-[80px] in your
code — those would leak the design system the moment they shipped.
```

**With escape:** show the same list, then use `AskUserQuestion`:

```
⚠ The Figma Component Set has <N> unbound values:
  ...

If you continue, these will land in your code as ARBITRARY Tailwind classes (text-[10px], h-[80px]).
They will be marked with // adhd:off-system comments so they're greppable.
They WILL drift over time and break /adhd:push-component on the round-trip.

The right fix is to bind these in Figma. This escape is a pragmatic short-term path.

Continue? [Y] yes / [N] no (abort)
```

On `no` or no answer, abort. On `yes`, note which entries will be off-system; you'll prefix their applied values with the `// adhd:off-system — <reason>` comment in Phase 7.

## Phase 3: Read both sides

**React side (update mode only):** use `Read` on `<react-path>` (from Phase 2). Identify:
- The exported function component name (look for `export function <Name>(`).
- Exported `type X = "a" | "b" | ...` string-literal unions.
- The component's props interface (`<Name>Props`) — note which prop name maps to which union (e.g. `size?: AvatarSize` → axis `size` corresponds to union `AvatarSize`).
- Top-level `export const TABLE: Record<Union, string> = { ... }` and `Record<Outer, Record<Inner, string>>` lookup tables.

If the file lacks ALL of (exported function + props interface + at least one Record<Union, string> table), abort: "`<path>` doesn't follow the lookup-table convention. v1 requires it."

Write a brief structured summary of what you found to `/tmp/adhd-pull-component/local-summary.md` (for forensics and so the final report can reference it).

**Figma side:** use another `use_figma` call (separate from Phase 2.5's structural extract) that, for every variant in the Component Set, captures the resolved Tailwind class string for each design-token-bearing property on each named layer.

The JS you pass to `use_figma` must, for each variant COMPONENT in the set: walk its named children; for each child read its `variantProperties` (on the parent COMPONENT) and `boundVariables`; for every bound variable id, call `await figma.variables.getVariableByIdAsync(id)` and read `.name` (and its collection's name via `getVariableCollectionByIdAsync(variable.variableCollectionId).name`) to form a `'<collection>/<name>'` key. Return a structure that lets you build the `figma.json` shape below — e.g. `[{ props, layers: [{ name, fills, strokes, fontSize, cornerRadius, padding*, itemSpacing, effectStyleId, boundVarNames: { fill: 'color/zinc/800', ... } }] }]`. Do NOT rely on Phase 2.5's `vars.json` for the id→name lookup — that map is keyed by name, not id.

The mapping from variable name → Tailwind class is direct:
- `color/zinc/800` → `bg-zinc-800` (for a fill) or `text-zinc-800` (for a text color) — disambiguate by the layer/property context.
- `typography/text/xs` → `text-xs`.
- `radius/lg` → `rounded-lg`.
- `spacing/2` → `p-2` / `px-2` / etc. — context-dependent.

For unbound (raw) values, write the Tailwind arbitrary form: `bg-[#abcdef]`, `text-[10px]`, `rounded-[32px]`. These only appear if Phase 2.5's escape was used.

**Choose the Tailwind utility prefix based on the layer's TYPE, not the Figma property name.** A Figma `fill` on a `VECTOR` layer is an SVG path color (use `fill-*` or `text-*` with `currentColor`). A Figma `fill` on a `FRAME` layer is a CSS background-color (use `bg-*`). Mapping every Figma `fill` to `bg-*` produces classes that don't drive SVG paint — a common mistake.

| Layer type + Figma property | Tailwind prefix in the lookup |
|---|---|
| `VECTOR / BOOLEAN_OPERATION / ELLIPSE / RECTANGLE / STAR / POLYGON / LINE` + `fill` | `text-*` (recommended, used with `fill="currentColor"`) or `fill-*` |
| `VECTOR /...` + `stroke` | `stroke-*` |
| `FRAME / COMPONENT / INSTANCE` + `fill` | `bg-*` |
| `TEXT` + `fill` | `text-*` |
| Any + `cornerRadius` / `*Radius` | `rounded-*` |
| Any + `fontSize` | `text-*` (size scale, not color) |
| Any + `padding*` / `itemSpacing` | `p*-*` / `gap-*` (with auto-layout direction) |

Save the result to `/tmp/adhd-pull-component/figma.json` with this shape (write it via `Bash` heredoc with the JSON you compose):

```json
{
  "componentSetId": "<id>",
  "componentName": "<name>",
  "variantAxes": { "size": ["xs","sm","md","lg","xl"], ... },
  "variants": [
    {
      "props": { "size": "lg", "shape": "circle", "status": "away" },
      "tokens": {
        "avatar-body.fill": "bg-zinc-800",
        "avatar-body.cornerRadius": "rounded-full",
        "initials.fontSize": "text-base",
        "initials.fill": "text-zinc-100",
        "status-dot.fill": "bg-amber-500",
        "Vector.fill": "text-foreground"
      },
      "layerTypes": {
        "avatar-body": "FRAME",
        "initials": "TEXT",
        "status-dot": "FRAME",
        "Vector": "VECTOR"
      }
    }
  ]
}
```

The `tokens` key is `<layer-name>.<property>`. Layer names come from Figma; properties are one of `fill`, `stroke`, `fontSize`, `cornerRadius`, `padding{Top,Right,Bottom,Left}`, `itemSpacing`, `effectStyle`. The `layerTypes` map carries each named layer's Figma node type so downstream phases can pick the right Tailwind prefix without re-querying Figma.

### SVG export for vector-driven variants

If a variant's leaf content is predominantly vector geometry (its tree's leaves are mostly `VECTOR` / `BOOLEAN_OPERATION` / `ELLIPSE` / `RECTANGLE` / `STAR` / `POLYGON` / `LINE`, with no TEXT or nested layout FRAMEs), also export the variant's SVG string in the same `use_figma` call:

```js
const svg = await variantNode.exportAsync({ format: 'SVG_STRING' });
```

Include the export in the variant's payload as a `svg` field:

```json
{
  "props": { "colour": "dark" },
  "tokens": { "Vector.fill": "text-foreground" },
  "layerTypes": { "Vector": "VECTOR" },
  "svg": "<svg width=\"180\" height=\"127\" viewBox=\"0 0 180 127\" fill=\"none\" ...><path d=\"...\" fill=\"#1C1917\"/></svg>"
}
```

Phase 7's scaffold mode reads these and inlines the SVG into the generated function body (see Phase 7). For non-vector variants, omit the `svg` field — Phase 7 will fall back to a `<span />` stub.

Hash the JSON (for the Phase 6 drift check) and store the hash in working memory.

## Phase 4: Diff

In working memory, walk both sides and produce three buckets:

1. **`unionDiff`** — for each Figma `variantAxes` entry, compare its values to the corresponding local union. Record adds (Figma has, local doesn't) and removes (local has, Figma doesn't). Skip if no matching local union (becomes `unmapped`).

2. **`tableDiff`** — for each local lookup table:
   - Determine its axis (the union the Record is keyed by, mapped to a prop name via the props interface).
   - For each entry in the local table, find Figma variant(s) whose `props[axis]` matches the key.
   - The relevant Figma token is the one whose layer/property maps to this table's "thing." This requires knowing what the table affects — use the convention: `SIZE_BOX` and similar h-/w- tables describe the root element; `SIZE_TEXT` describes text size; `STATUS_COLOR` describes a status indicator's fill.
   - If the local class string differs from the Figma class string for the matched variant, record a cell diff entry.

3. **`unmapped`** — Figma axes with no matching local prop/union; local tables whose axis isn't in Figma.

Write a human-readable summary to `/tmp/adhd-pull-component/diff.md` so the final report can reference it. Keep the structured form in working memory for Phase 5/7.

If all three buckets are empty AND mode is `update`: print "No changes — <ComponentName> is in sync with Figma." Skip to Phase 11 cleanup. Exit 0.

## Phase 5: Resolve divergences

Top-of-loop short-circuit via `AskUserQuestion` with these options:

```
Pull plan:
  • <N> union change(s)
  • <M> table(s) with cell changes
  • <K> unmapped Figma properties

How to proceed?
  [1] Apply ALL Figma values
  [2] Keep ALL local values (no edits — proceeds to final report)
  [3] Review each
```

If `Apply ALL`: short-circuit — every unionDiff add accepted, every cell diff accepted (Figma wins). Skip the per-axis/per-table prompts and proceed to Phase 6.

If `Keep ALL`: skip to Phase 10 final report (nothing applied).

If `Review each`:

### 5a — Union changes (asked first)

For each `unionDiff` entry, ask via `AskUserQuestion`:

```
Variant axis `<axis>` differs:
  Local (<Union>):  <existing members>
  Figma:            <Figma members>

  [1] Add <new-value> to <Union> + cascade entries to all Record<<Union>, ...> tables
  [2] Skip — leave union as-is (table cells for this axis also skipped)
```

For removals:

```
Variant axis `<axis>` is missing values in Figma:
  Local:  ... | <removed-value>
  Figma:  ...

  [1] Remove `<removed-value>` from <Union> + all Record<<Union>, ...> entries
  [2] Skip — keep `<removed-value>` (you may have logic that uses it)
```

If the user skips an axis, mark it so Phase 5b's prompts for that axis are also skipped.

### 5b — Table cells

For each table in `tableDiff` (whose axis is NOT skipped from 5a), show:

```
<TABLE_NAME> (Record<<Union>, string>):

  <key>  local              figma
  ─────────────────────────────────
  ...
  ⚠ <K> changes.

  [1] Apply Figma's values to all <K> cells
  [2] Review each one
  [3] Keep all local values (skip this table)
```

`Review each one` → per-cell:

```
<TABLE_NAME>.<key>
  Local: <local>
  Figma: <figma>

  [1] Use Figma (<figma>)
  [2] Keep local (<local>)
```

### 5c — Unmapped (informational)

Print, no prompts:

```
ℹ Figma has <K> variant axis/axes with no matching Record<...> table in your code:

  • <axis> (Figma values: ...) — add `export type ...` and a Record table, then re-run.
```

Accumulate resolutions in working memory: which union members to add/remove, which cells to apply, which to keep.

## Phase 6: Drift check

Re-fetch the Figma CS via `use_figma`, re-serialize the variants+tokens shape (same script as Phase 3). Hash the JSON, compare to the Phase 3 hash. If different, abort:

> "Figma changed during pull. Re-run /adhd:pull-component."

## Phase 7: Apply

**Update mode:** for each resolution, use `Edit` on `<react-path>`:

- **Cell update** (`tableDiff` cell accepted): identify the property line in the relevant `Record<...>` table. `Edit` with `old_string` matching the line (including enough context to be unique — usually the key name itself suffices, but include the indent/value if needed), `new_string` with the new value. Preserve trailing comma.

  ```
  Edit:
    old_string: "  md: \"text-sm\","
    new_string: "  md: \"text-base\","
  ```

- **Union add** (`unionDiff` add accepted): two-step:
  1. `Edit` the type alias to include the new member. Example:
     ```
     old_string: "export type AvatarSize = \"xs\" | \"sm\" | \"md\" | \"lg\" | \"xl\";"
     new_string: "export type AvatarSize = \"xs\" | \"sm\" | \"md\" | \"lg\" | \"xl\" | \"xxl\";"
     ```
  2. For each `Record<<Union>, ...>` table in the file, `Edit` to insert a new entry. Find the closing brace and insert the new entry just before it, matching the existing indentation. For 2-axis tables, insert into each outer entry's inner Record.

  If a new value is off-system (Phase 2.5 escape was active for this property), prepend a `// adhd:off-system — <reason>` comment on its own line above the new entry.

- **Union remove** (`unionDiff` remove accepted):
  1. `Edit` the type alias to drop the member.
  2. For each `Record<<Union>, ...>` table, `Edit` to remove the corresponding entry (the property line including its trailing newline).

**Scaffold mode:** compose the new file with `Write`. The shape is always:

1. One exported `type X = "..." | "..."` union per Figma variant axis.
2. An exported `<Component>Props` interface that maps each variant axis to an optional prop of its union type. Always include a `className?: string` prop so the component is composable.
3. One exported `Record<<Union>, string>` lookup table per design-token surface of the component (fill, stroke, etc.). The function reads from these tables; future pulls update them.
4. An exported function component that destructures the props and renders.

**Lookup table values — pick the right Tailwind utility prefix for what the class is going to drive in the JSX. Do NOT default to `bg-*`.**

| If the class will drive… | Use | Pattern in JSX |
|---|---|---|
| An SVG fill via `currentColor` (recommended for icons/logos) | `text-*` | `<svg className={LOOKUP[v]}>...<path fill="currentColor" /></svg>` |
| An SVG fill directly | `fill-*` | `<path className={LOOKUP[v]} />` |
| A background on a layout element | `bg-*` | `<div className={LOOKUP[v]} />` |
| A text color on a layout element | `text-*` | `<span className={LOOKUP[v]}>...</span>` |
| Sizing | `h-*` / `w-*` / `size-*` | `<div className={LOOKUP[v]} />` |

The `text-*` + `currentColor` pattern is the most flexible for vector-art components — it lets callers override the color via a parent's text-color class. Use it by default when the Figma source is a single SVG path that just needs colour-driven fill.

### Function body — branch on what the Figma source is

**For vector-driven components** (icons, logos, decorative shapes — when the Figma variants are primarily vector geometry rather than nested layout):

The Figma source already contains everything needed to render a real implementation. Inline the SVG rather than writing a stub. Specifically:

1. Call `node.exportAsync({ format: 'SVG_STRING' })` on each variant during Phase 3's Figma extract. Save the SVGs alongside the variant tokens.
2. Compare the variant SVGs:
   - **Identical geometry, different fill colours**: inline the SVG once with `fill="currentColor"` on the colored path(s), drive the colour via a `text-*` lookup on the SVG's `className`.
   - **Different geometry per variant**: inline both paths and render based on the variant prop (`{colour === "dark" ? <path d="..." /> : <path d="..." />}`).
3. Convert SVG attributes to JSX casing — `fill-rule` → `fillRule`, `clip-rule` → `clipRule`, `stroke-linecap` → `strokeLinecap`, etc.
4. Preserve the original `width`, `height`, `viewBox` from the SVG export.
5. Combine the lookup-table class with the passed-in `className` prop using a template literal.

Concrete example (identical-geometry case, for a logo):

```tsx
export type LogoColour = "dark" | "light";

export interface LogoProps {
  colour?: LogoColour;
  className?: string;
}

export const LOGO_VECTOR_FILL: Record<LogoColour, string> = {
  dark: "text-foreground",
  light: "text-background",
};

export function Logo({ colour = "dark", className = "" }: LogoProps) {
  return (
    <svg
      width="180"
      height="127"
      viewBox="0 0 180 127"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${LOGO_VECTOR_FILL[colour]} ${className}`}
      role="img"
      aria-label="Logo"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="<the actual path from exportAsync>"
        fill="currentColor"
      />
    </svg>
  );
}
```

This is first-pass code, not a stub. The developer can iterate from a working component.

**For layout-driven components** (cards, buttons, forms — when the Figma variants contain multiple children, text, or nested frames):

Reconstructing JSX from a flattened Figma capture is unreliable, so keep the stub:

```tsx
export type <Component>Size = "<v1>" | "<v2>" | ...;

export interface <Component>Props {
  // axes from Figma variantAxes, optional
  className?: string;
}

export const <COMPONENT>_<TABLE>: Record<<Component>Size, string> = {
  // entries from Figma tokens, one per variant value
};

export function <Component>({ /* props from interface */ }: <Component>Props) {
  return <span />; // adhd: scaffold stub — replace with your implementation
}
```

In this case the function body really is the developer's responsibility. The lookup tables remain the round-trippable surface; future pulls update them safely without touching whatever JSX the developer writes.

### How to decide which branch

Look at the variant subtrees you captured in Phase 3. A component is vector-driven when, across all variants, the leaf nodes are predominantly `VECTOR` / `BOOLEAN_OPERATION` / `ELLIPSE` / `RECTANGLE` / `STAR` / `POLYGON` / `LINE`, and there are no TEXT nodes or nested FRAMEs with multiple children. If you're unsure, treat it as layout-driven and keep the stub — the user can re-run pull-component once the file exists if they want to iterate.

## Phase 8: Write mapping if scaffold mode

Only in `scaffold` mode:

```bash
node plugins/adhd/lib/pull-component/cli.js config-write \
  --config adhd.config.ts \
  --path "<new-relative-path>" \
  --figma-url "<figma-url>"
```

## Phase 9: Per-axis commit

Group applied resolutions by axis. For each axis with applied changes:

```bash
git add <react-path> [adhd.config.ts]
git commit -m "ADHD pull: <ComponentName>.<axis> (<N> changes)"
```

Zero applied changes → no commit. Multiple axes → multiple commits.

## Phase 10: Final report

```
✓ Pulled <ComponentName> from Figma:
  - <N> variant(s) added
  - <M> table cells updated
  - <K> cells kept local
  - <U> unmapped Figma properties
  - <O> off-system entries (use `git grep "adhd:off-system"` to find them)

Component file: <react-path>
Figma URL: <figma-url>
```

## Phase 11: Cleanup

Always runs (even on abort):

```bash
rm -rf /tmp/adhd-pull-component
```

---

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `No mapping for <path>` | Push it first: `/adhd:push-component <path>`. |
| `URL points at wrong file` | Open the configured file and copy a node URL from there. |
| `Pre-flight: <N> unbound values` | Bind values in Figma, or pass `--allow-unbound`. |
| `<react-path> doesn't follow the lookup-table convention` | This component uses inline classes or a non-Record pattern. v1 requires `Record<Union, string>` tables. |
| `Figma changed during pull` | Re-run `/adhd:pull-component`. |
| `Edit failed: text not found` | The expected text in the source didn't match. Re-read the file and adjust. |
