# /adhd:push-component — Push a React Component to Figma with Preflight Lint

**Goal:** Take a path to a React component file, push it into Figma as a new page containing a properly-structured Component Set with all variants, with bindings to the design-system variables we've already pushed. Before finalizing the push, run the same lint engine `/adhd:lint` uses to validate the captured result — symmetric pipeline, so bugs surface from both sides.

**Architectural premise:** Figma's official `code → Figma` path uses `generate_figma_design` (remote MCP) to capture running web UI as editable design layers. We don't reinvent that; we use it. The `/adhd:push-component` command wraps it with framework-specific preview-page generation upstream and a Component-Set + variable-binding cleanup pass downstream — plus a preflight lint check that exercises the same code path as `/adhd:lint`.

**Precondition:** the design system has been pushed to Figma via `/adhd:push-design-system`. All variables/effect-styles the component will reference exist in the file.

---

## Final command surface

```
/adhd:config                — setup wizard (existing)
/adhd:push-design-system    — tokens code → Figma (existing)
/adhd:pull-design-system    — tokens Figma → code (existing)
/adhd:lint                  — validate Figma frame/file (existing)
/adhd:push-component <path> — push a React component to Figma (NEW)
```

**Out of scope for v1:**
- Non-Next.js App Router frameworks. URL inference is framework-specific; we ship Next.js v15+ for now.
- Updating an existing Figma component. Push always creates a fresh page. Updating in place is future work.
- Composite components requiring deep child trees (we provide a string/fragment placeholder for `children` but don't recursively expand sub-components).
- Auto-fix for preflight violations.

**Note on interactive components (Button, Input, etc.):** these are fully supported. Required props like `onClick`, `onChange`, refs, objects get safe placeholders at preview-render time (see "Required prop defaults" below). The component renders its visual structure; we don't actually exercise interactivity (no Figma equivalent for click handlers anyway).

---

## Pipeline

```
1. PARSE
   - Read the component file.
   - Light TypeScript analysis (typescript compiler API, transitive dep): find
     exported union-type aliases like `type AvatarSize = "xs" | "sm" | ...`.
   - Find the props interface (named ComponentNameProps or first-param type).
   - For each prop:
     • If type is a found union → variant axis with those values.
     • If optional → include `undefined` as an implicit value.
     • If required non-union string → use a placeholder ("John Doe" for `name`).
     • If required complex (function/ref/object) → ABORT with error.
   - Output: variant matrix + non-variant prop defaults.

2. GENERATE TEMP PREVIEW PAGE
   - Cartesian product of variants. Warn at >30 combinations; --max-variants
     for a coverage-first cap.
   - Write `example/__adhd-preview/page.tsx` (gitignored, auto-generated).
   - Each variant wrapped in `<div data-adhd-variant="size=xs;shape=circle;...">`.
   - Renders in a lexically-ordered grid (matches the post-capture positional
     fallback strategy).

3. VERIFY DEV SERVER
   - Check `http://localhost:<port>/` reachability (default 3000; configurable
     in adhd.config.ts via a new `devServerUrl` field).
   - If unreachable: abort with "Run `npm run dev` and re-invoke."

4. CAPTURE
   - Call `mcp__plugin_figma_figma__generate_figma_design` with the preview URL.
   - This creates a new page in the configured Figma file containing the
     captured layout.
   - Capture the page ID from the response.

5. CLEAN UP TEMP FILE
   - Delete `example/__adhd-preview/page.tsx` from the filesystem.
   - (We don't leave it around; the next push regenerates as needed.)

6. POST-CAPTURE CONSOLIDATION (use_figma)
   See "Consolidation pass" below.

7. PREFLIGHT LINT
   See "Preflight lint" below.

8. FINALIZE OR ROLLBACK
   - If preflight passes → page is named after the component, positioned,
     and reported.
   - If preflight fails and user chooses rollback → captured page is deleted
     from Figma, command exits.

9. REPORT
   - Page URL, variant count, variables bound, preflight result summary.
```

---

## Parse step details

### TypeScript analysis

Use the TypeScript compiler API (typescript is a transitive dependency via Next.js — no new install). Walk the source AST and extract:

1. **Exported union-type aliases**: `TypeAliasDeclaration` with a `UnionTypeNode` of `LiteralTypeNode`s. e.g., `export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl"` → `{ AvatarSize: ["xs", "sm", "md", "lg", "xl"] }`.

2. **The props interface**: `InterfaceDeclaration` or `TypeAliasDeclaration` named `<ComponentName>Props` (where `<ComponentName>` is the exported function), OR the first parameter type of the exported function.

3. **The component's exported function name**: for the preview file's import.

### Variant axes vs default props

Variant axes (props that become variant property dimensions in the Figma Component Set) are:

- **All union-typed props** (literal-union type aliases or inline unions), automatically — unless `--variants <list>` overrides
- Any prop explicitly named in `--variants <prop1,prop2,...>`, even if it's a boolean

Optional union props always include `undefined` as an implicit variant value.

Booleans are **NOT** variant axes by default (even though they have a small 2-value space) to keep the variant matrix bounded — a component with 4 boolean props would have 16 variants just from those before we even multiply by other axes. Users opt boolean axes in via `--variants disabled,loading`.

### Required prop defaults

Any required prop NOT acting as a variant axis gets a safe placeholder so the component renders structurally. The placeholder doesn't have to be meaningful — just non-crashing.

| Prop type (form-based detection) | Placeholder |
|---|---|
| `string` (or `string \| undefined` not in unions) | `"John Doe"` if name-like (`name`, `label`, `title`); else `"Sample text"` |
| `number` | `0` |
| `boolean` (not opted as variant) | `false` |
| `Array<T>` / `T[]` | `[]` |
| Function (`(...) => *`) — typical event handlers | No-op: `() => {}` |
| `RefObject<T>` / `MutableRefObject<T>` | `null` (React tolerates null refs) |
| `ReactNode` / `ReactElement` / `JSX.Element` (typically `children`) | `"…"` placeholder string |
| Object literal (`{ ... }`) | `{}` |
| Generic / unresolvable | `{}` (and emit a warning in the report) |

Detection is **syntactic** (we look at the TypeScript type's surface form, not full type resolution). For example:

```ts
onClick: (event: React.MouseEvent) => void  // → matches `(...) => *` → noop default
ref: React.Ref<HTMLDivElement>              // → matches Ref → null
items: string[]                              // → matches array → []
```

If the placeholder choice causes the component to throw at render time (rare, but possible if the component dereferences a callback synchronously or asserts a non-null prop), the capture phase will report the failure with the rendered error message, and the user can either pass `--variants <prop>` to opt the prop into the variant matrix (with explicit values), or wrap the component in a default-providing parent in their own preview file.

### Cap algorithm

If `--max-variants N` is passed and the Cartesian product > N:

1. Group all combinations by axis-value coverage: ensure every value of every axis appears in at least one chosen combination.
2. Sort combinations alphabetically by axis-value tuple.
3. Include combinations greedily until we have N, while preserving coverage.

Predictable; ensures no axis value silently dropped.

---

## Temp preview page

Generated at `example/__adhd-preview/page.tsx` (path is the user's project root + `__adhd-preview`, exact directory adjustable per framework convention later):

```tsx
// Auto-generated by /adhd:push-component. Do not edit.
// Deleted automatically after capture.
import { Avatar } from "@/app/components/avatar";

export default function Page() {
  return (
    <main className="p-8 grid grid-cols-5 gap-4 bg-white dark:bg-zinc-950">
      <div data-adhd-variant="size=xs;shape=circle;status=undefined">
        <Avatar name="John Doe" size="xs" shape="circle" />
      </div>
      {/* …all other combinations… */}
    </main>
  );
}
```

The `data-adhd-variant` attribute is the variant identifier for consolidation. The implementer empirically validates whether `generate_figma_design` preserves the attribute (in a layer name, in metadata). If neither, fall back to positional matching by lexical grid order.

The `__adhd-preview/` directory is added to `example/.gitignore`.

---

## Consolidation pass

After `generate_figma_design` produces a captured page, a `use_figma` call performs the following:

### Locate variant frames

```
1. Walk the captured page's descendants.
2. Match each frame against the data-adhd-variant pattern (in layer name OR
   data attribute, whichever the implementer confirms generate_figma_design
   preserves).
3. Build a map: variantKey → frameId.
4. If zero matches found, fall back to positional matching: enumerate
   top-level children in row/column reading order, map by lexical sort of
   variant keys.
5. If still zero, abort with "Capture produced no recognizable variant frames.
   Re-check the preview page rendered correctly at the dev server URL."
```

### Deduplicate by visual signature

Before combining into a Component Set, collapse variants whose captured frames are structurally identical. Some union-typed props don't actually affect rendering (e.g., `analyticsEvent: "click" | "hover" | "focus"` fires callbacks but produces the same DOM). The Cartesian generator can't tell ahead of time; the captured frames can.

```
1. For each captured variant frame, compute a "visual signature" — a stable
   hash of the structural tree (node types, dimensions, fills, strokes,
   effects, layout fields, text content). Ignore positional offsets and
   layer IDs; we want shape-equivalence, not identity.

2. Group variants by signature.

3. For each group of size > 1, keep the lexically-first variant key; drop
   the rest from Figma (delete those frames).

4. For each remaining variant, compute its EFFECTIVE variant properties:
   only axes whose value differs from at least one other surviving variant.
   E.g., if every surviving variant has status="online" (because all other
   status values collapsed), drop `status` from the Component Set's
   property declarations entirely — it wasn't visual.
```

The result: the Figma Component Set's variant property axes match the props that actually affect visual output. Non-visual axes silently disappear.

### Combine into Component Set

```
const componentSet = figma.combineAsVariants(survivingFrames, page);
componentSet.name = componentName;  // e.g., "Avatar"
```

For each variant Component child, set its `variantProperties` to the **effective** axes (post-dedup):

```
variant.variantProperties = { size: "xs", shape: "circle", status: "undefined" };
// If `status` was dropped because non-visual, omit it from variantProperties.
```

The set's `componentPropertyDefinitions` get auto-populated.

### Rebind raw values to existing Figma variables

Build a reverse index of the file's variables at start of consolidation:

```ts
{
  "color": Map<RGBKey, VariableId>,      // {r, g, b, a} → variable
  "spacing": Map<number, VariableId>,    // px → variable
  "radius": Map<number, VariableId>,
  "typography": { fontSize, lineHeight, ... },
}
```

For colors, also build per-mode entries (the Light value and the Dark value of a variable both map to the same `VariableId`).

Walk each variant frame's subtree:

- **Fills/strokes**: for each `SOLID` paint, look up its color in the reverse index. If found, replace with `figma.variables.setBoundVariableForPaint(paint, 'color', variable)`.
- **Padding/itemSpacing**: for each `paddingTop/Right/Bottom/Left/itemSpacing` (always a number in Figma's API), look up in the spacing reverse index. If found, call `setBoundVariable(field, variable)`.
- **Corner radius**: same pattern. If `cornerRadius` is uniform, bind it. If mixed (per-corner), bind each corner individually.
- **Effects**: if the effect's parameters match a known shadow effect-style, set `effectStyleId = matchingStyle.id`.

Unmatched values stay raw. Preflight lint catches them.

### Layer naming

For v1 we do minimal renaming:

- Component Set: rename to component name (`Avatar`).
- Each variant Component: keep Figma's auto-generated name from `variantProperties`.
- Direct children: leave as captured (likely `<div>`, `<span>`, `Frame N`).

STRUCT008 (meaningful naming) will fire on the leaf layers; acceptable v1 warning. v2 can use the React tree to infer semantic names.

### Page cleanup

- Delete any captured grid wrapper (the `<main>` container that wrapped our variant `<div>`s). Only the Component Set should remain at the page's top level.
- Rename the page from `generate_figma_design`'s auto-generated name to the component name.
- Position the Component Set at `(40, 40)`.

---

## Preflight lint (symmetric pipeline)

**Why this exists:** the same `lint-engine` that validates Figma frames during `/adhd:lint` also runs against the pushed component before we finalize. Symmetric pipeline; bugs in `checkStructure` / `variable-categorizer` / `report-formatter` surface in both flows.

### When it runs

Between consolidation (variable bindings applied) and finalize (page name, position). After this step, the Component Set is structurally final — we either keep it or roll back.

### What it runs

```js
// Same extraction code path as /adhd:lint uses
const designContext = await extractStructuralData(componentSetId);
const variableDefs = await extractVariableDefs(componentSetId);

// Same engine call /adhd:lint makes
const structureViolations = checkStructure(designContext, {
  fileKey,
  namingConvention: config.naming ?? "kebab-case",
});
const variableViolations = categorizeVariables(variableDefs, localTheme);
```

### Decision logic

```
errors = filter(violations, sev === "error")
warnings = filter(violations, sev === "warning")

if (errors.length === 0):
  print "✓ Preflight clean ({warnings.length} warnings)"
  → finalize

else:
  print preflight report (errors + warnings)
  ask via AskUserQuestion:
    - "Keep the pushed page (you can fix in Figma manually)"
    - "Roll back — delete the captured page and exit"

  if "roll back":
    use_figma: delete the captured page
    print "Rolled back. No changes to Figma."
    exit with code 1

  else:
    print "Pushed with {errors.length} errors. Run /adhd:lint to re-check."
    → finalize
```

### Expected first-push violations

Based on `generate_figma_design`'s known behaviors:

| Rule | Expected on first push? | Why |
|---|---|---|
| STRUCT001 (auto-layout required) | Maybe (low) | generate_figma_design typically preserves auto-layout structure from the captured HTML |
| STRUCT002 (spacing uses vars) | Possible | Some captured paddings won't match our pushed `--spacing-N` values |
| STRUCT003 (colors use vars) | Possible | Tailwind utility colors should match, but edge cases (the `<main>` background, etc.) might leak |
| STRUCT004 (typography uses styles/vars) | Likely (warning) | Text size bindings work; line-height pairing is harder |
| STRUCT008 (meaningful names) | Yes | Captured layers are unnamed; warning severity |
| STRUCT010 (variant properties declared) | No | We declare them in consolidation |
| `VAR001` (unresolvable variable) | No | We don't break aliases |

The first few uses of `/adhd:push-component` will produce some violations. Acceptable v1 behavior; designers can iterate. Future versions can tighten the consolidation step.

---

## Edge cases & errors

| Case | Behavior |
|---|---|
| Component file not found | Abort with "Component file not found: <path>" |
| File exports no React component | Abort with "No exported function component found in <path>" |
| Component throws at render with default-placeholder props | Surface the render error; suggest `--variants <prop>` to opt the prop into the variant matrix |
| `__adhd-preview/page.tsx` already exists with non-generated content | Abort to avoid clobbering |
| Dev server unreachable | Abort with "Run `npm run dev` and re-invoke" |
| `generate_figma_design` returns an error | Abort, propagate the error to the user |
| Zero variant frames found in capture | Abort with "Capture produced no recognizable variants" |
| `figma.combineAsVariants` fails (variants have incompatible shapes) | Abort with the underlying Figma error |
| Reverse index has 50,000+ entries (huge palette) | Acceptable; lookup is O(1) per match |
| Preflight finds errors, user picks roll back | Delete captured page, exit non-zero |
| Same component re-pushed (page with same name already exists) | Abort with "Page 'Avatar' already exists. Delete it manually or `/adhd:push-component --replace` in v2." |

---

## Acceptance criteria

1. `/adhd:push-component example/app/components/avatar/index.tsx` produces a new Figma page named `Avatar` containing a Component Set with all variants of Avatar.
2. Variant property values include `size`, `shape`, and `status` (with `undefined` as an explicit value where applicable).
3. The Component Set's variants share a common variant axis layout in Figma (no orphan variants).
4. Raw fills/strokes/padding/itemSpacing/corner-radius values that match a known design-system variable are bound to that variable.
5. After consolidation, the preflight lint runs against the new Component Set and prints a report.
6. If the preflight has zero errors, the push finalizes silently.
7. If the preflight has errors, the user is prompted: keep or roll back. Roll back deletes the captured page from Figma.
8. `__adhd-preview/page.tsx` is created, used for capture, and deleted before the command exits.
9. `__adhd-preview/` is added to `example/.gitignore` (added by Task 1 of the implementation plan).
10. Interactive components (e.g., `<Button onClick={...}>`) are fully supported — required functions/refs/objects get safe placeholders at preview-render time.
11. The command refuses to run if the dev server isn't reachable.
12. The command refuses to run if the variant Cartesian product > 30 unless `--max-variants` is passed (warning, not abort).
13. The reverse-index variable-binding step finds at least 80% of known Tailwind utility classes (color, spacing, radius, text) for a typical component.
14. The same `lint-engine` modules (`structure-checker`, `variable-categorizer`, `report-formatter`) are used by both `/adhd:lint` and `/adhd:push-component`'s preflight step. No duplicate implementations.
15. Re-running `/adhd:lint` on the pushed Component Set produces the same violations as the preflight report (exercising the symmetric pipeline assertion).
16. Union-typed props that don't affect rendering (e.g., `analyticsEvent` callbacks) collapse during deduplication; only visual axes appear in the Figma Component Set's variant property declarations.
