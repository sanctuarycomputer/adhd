# /adhd:pull-component — Pull a Figma Component Set Into a React Component Source File

**Goal:** Inverse of `/adhd:push-component`. Given a target — either a path to an existing React component or a Figma URL — read the corresponding Figma Component Set and reconcile its variant properties, lookup-table values, and union members back into the React source file. Update only the design-token surface (lookup tables, union types); never touch the function body, JSX, handlers, or hooks. Symmetric pipeline: pull's pre-flight validates the Figma source using the same lint engine `/adhd:lint` and `/adhd:push-component`'s preflight use, so structural violations on the Figma side block the pull before any code is rewritten.

**Architectural premise:** The React file is its own snapshot. Top-level `export const X: Record<UnionType, string> = { ... }` lookup tables (the convention established by the Avatar reference component) already encode every design-token value the Figma Component Set cares about. We never store a parallel snapshot in the repo — we parse the React file at pull time and diff it directly against Figma. The mapping between a React file and its Figma Component Set lives in `adhd.config.ts` under `components.<path>.figma.url`, populated automatically by `/adhd:push-component` on first push and by `/adhd:pull-component` on first scaffold.

**Precondition:** the design system has been synced to Figma via `/adhd:push-design-system`; all variables the Component Set references exist locally. The target Component Set must pass the lint engine's variable-binding checks (no raw colors, raw fontSize, raw effects on its layers) — designer-side discipline enforced.

---

## Final command surface

```
/adhd:config                                  — setup wizard (existing)
/adhd:push-design-system                      — tokens code → Figma (existing)
/adhd:pull-design-system                      — tokens Figma → code (existing)
/adhd:lint                                    — validate Figma frame/file (existing)
/adhd:push-component <path>                   — push a React component (existing)
/adhd:pull-component <path | figma-url>       — pull a Figma Component Set (NEW)
```

**Out of scope for v1:**
- Pulling JSX structure changes. Pull does not regenerate the function body; renames, prop additions, or layout changes in code remain a manual task.
- Bulk pulls. v1 is one component per invocation.
- Components that don't follow the `Record<Union, string>` lookup-table convention. v1 reports and aborts; the convention is now documented as part of the plugin's expectations.
- Pulling components whose variant axes correspond to props NOT yet declared in the component file. The asymmetric path ("Figma added an axis the developer hasn't reflected in code") is reported, not auto-resolved.

---

## Pipeline

```
Phase 1   Validate config
Phase 2   Resolve target (path | URL | scaffold mode)
Phase 2.5 Pre-flight lint of the Figma Component Set
Phase 3   Read both sides (AST parse React file; extract Figma CS)
Phase 4   Build the diff (unions, table cells, unmapped axes)
Phase 5   Resolve divergences (prompts; batch-confirm affordances)
Phase 6   Drift check (re-fetch Figma; abort if remote changed)
Phase 7   Apply to the React file (AST surgery, single Write call)
Phase 8   Write mapping if scaffold mode
Phase 9   Per-axis commit
Phase 10  Final report
Phase 11  Cleanup
```

### Phase 1 — Validate config

Read `adhd.config.ts`. Require `figma.url` (the file-level URL). If missing: `"Run /adhd:config first to set up ADHD."`

### Phase 2 — Resolve target

Branch on `$ARGUMENTS`:

| Input | Mode | Behavior |
|---|---|---|
| `<path>` matching a `components` entry | **update** | Use the entry's `figma.url` |
| `<path>` with no entry | abort | `"No Figma mapping for <path>. Push it first with /adhd:push-component, or pass a Figma URL to scaffold."` |
| `<figma-url>` matching `components.*.figma.url` | **update** | Reverse-lookup the path |
| `<figma-url>` with no mapping | **scaffold** | Ask via `AskUserQuestion`: "Where should this component live?" Validate target path doesn't already exist (else abort). |

If the URL's file key doesn't match `config.figma.url`, abort: `"URL points at file <X>, but adhd.config.ts is configured for file <Y>."` (mirrors `/adhd:lint`'s scoped-mode check).

If `node-id` resolves to a node that isn't a `COMPONENT_SET` or top-level `COMPONENT`, abort: `"Target node <id> is a <type>. Pull requires a Component Set."`

### Phase 2.5 — Pre-flight lint of the Figma Component Set

Run the same `lint-engine` modules `/adhd:push-component`'s preflight uses, scoped to the target Component Set:

```js
const designContext = await extractStructuralData(componentSetId);
const variableDefs = await extractVariableDefs(componentSetId);
const violations = checkStructure(designContext, { fileKey, namingConvention: config.naming });
```

Filter violations to *variable-binding errors* (STRUCT003, STRUCT004, STRUCT005). Naming and structural-organization warnings (STRUCT008, STRUCT009) appear in the final report but do not block.

**Default behavior (strict):** if any variable-binding errors exist, abort with:

```
✗ Cannot pull — the Figma Component Set has N unbound values:

  • <variant-path> > <layer-name> — raw <property> <value> (not a variable)
  ...

These need to be bound to design-system variables before we can pull. The designer can:
  1. Bind them in Figma (right-click the layer → "Apply variable")
  2. Or create new variables if these are new design tokens, then run
     /adhd:pull-design-system first to bring those into globals.css, then re-run
     /adhd:pull-component

We don't generate arbitrary Tailwind classes like text-[20px] or h-[80px] in your
code — those would leak the design system the moment they shipped.
```

**Escape (opt-in):** if `--allow-unbound` is passed OR `components.<path>.allowUnboundFigma === true` in config, the abort becomes a confirm-prompt:

```
⚠ The Figma Component Set has N unbound values:
  ...

If you continue, these will land in your code as ARBITRARY Tailwind classes:
  • bg-[#f2f2f5]
  • text-[20px]
  • rounded-[32px]

These have real consequences:
  • They WILL drift over time — Figma changes won't propagate (we have no variable to track them).
  • They break /adhd:push-component (preflight will fail on the round-trip until they're bound).
  • They will be marked with // adhd:off-system comments so they're greppable later.

The right fix is to bind these in Figma. This escape is a pragmatic short-term path.

Continue with arbitrary classes? (y/N)
```

On confirm, off-system entries land in the React file with `// adhd:off-system` comments above each one (see Phase 7).

### Phase 3 — Read both sides

**React side:** read the file with `Read`. AST-parse via the TypeScript compiler API (already a transitive dep through Next.js). Extract:

| AST node | Output |
|---|---|
| `TypeAliasDeclaration` of `UnionTypeNode<LiteralTypeNode<StringLiteral>>` | `{ <unionName>: [<members...>] }` |
| `InterfaceDeclaration` or `TypeAliasDeclaration` named `<Component>Props` | Props mapping (prop name → union type referenced) |
| `VariableStatement` with `VariableDeclaration` typed `Record<Union, string>` | `{ <tableName>: { <key>: <classString>, ... }, axis: <unionName> }` |
| Nested `Record<Outer, Record<Inner, string>>` | Two-level table with outer/inner axes |
| Exported function declaration | Component name (sniff only; not modified) |

What we deliberately ignore: tables typed `Record<Union, T>` where T is not `string`; inline object literals without a `Record<Union, ...>` type annotation; tables defined inside the function body; non-Record arrays (e.g. `PALETTE`).

Save normalized representation to `/tmp/adhd-pull-component/local.json`.

**Figma side:** `use_figma` scoped to the Component Set, walking each variant and extracting per-layer bound variables. Save to `/tmp/adhd-pull-component/figma.json`.

### Phase 4 — Build the diff

Run a comparator producing `/tmp/adhd-pull-component/diff.json` with three buckets:

```json
{
  "unionDiff": [
    { "union": "AvatarSize", "axis": "size", "add": ["xxl"], "remove": [] }
  ],
  "tableDiff": [
    {
      "table": "SIZE_TEXT",
      "axis": "size",
      "cells": [
        { "key": "md", "local": "text-sm", "figma": "text-base" },
        { "key": "xl", "local": "text-lg", "figma": "text-xl" }
      ]
    }
  ],
  "unmapped": [
    { "figmaAxis": "theme", "values": ["light", "dark"], "reason": "no Record<AvatarTheme, ...> table found in source" }
  ]
}
```

The Tailwind-class → design-token resolution reuses `plugins/adhd/lib/lint-engine/variable-categorizer.js` + `theme-parser.js`. Layout-only tokens (`flex`, `items-center`) are ignored when resolving. Size, spacing, color, radius, typography tokens map 1:1 to design system variables.

### Phase 5 — Resolve divergences

Top-of-loop short-circuit:

```
Pull plan:
  • <N> union change(s)
  • <M> table(s) with cell changes
  • <K> unmapped property(ies)

  [1] Apply ALL Figma values
  [2] Keep ALL local values (no-op — exits here)
  [3] Review each
```

If `Review each`:

**5a — Union changes first.** Per axis:

```
Variant axis `size` differs:
  Local (AvatarSize):  xs | sm | md | lg | xl
  Figma:               xs | sm | md | lg | xl | xxl

  [1] Add `xxl` to AvatarSize + new entries in all Record<AvatarSize, ...> tables
  [2] Skip — leave union as-is (table cells for this axis also skipped)
```

Removed-from-Figma case is symmetric:

```
  Local (AvatarSize):  xs | sm | md | lg | xl | xxl
  Figma:               xs | sm | md | lg | xl

  [1] Remove `xxl` from AvatarSize + all Record<AvatarSize, ...> entries
  [2] Skip — keep `xxl` in code (you may have logic that uses it)
```

If the user skips an axis, all subsequent table-cell prompts for that axis are skipped automatically.

**5b — Table cells next.** Per table with changes:

```
SIZE_TEXT (Record<AvatarSize, string>):

  size   local           figma
  ──────────────────────────────────
  xs     text-2xs        text-2xs    ✓
  sm     text-xs         text-xs     ✓
  md     text-sm         text-base   ⚠
  lg     text-base       text-base   ✓
  xl     text-lg         text-xl     ⚠

2 changes.
  [1] Apply Figma's values to all 2 cells
  [2] Review each one
  [3] Keep all local values (skip this table)
```

`Review each` prompts per cell with a binary `[1] Use Figma | [2] Keep local`.

**5c — Unmapped, informational only:**

```
ℹ Figma has 1 variant axis with no matching Record<...> table:

  • theme (Figma values: "light" | "dark")

Pull cannot auto-update unmapped axes. Add `export type AvatarTheme = "light" | "dark"`
and a Record<AvatarTheme, ...> table, then re-run /adhd:pull-component.
```

All resolutions accumulate into `/tmp/adhd-pull-component/resolutions.json`:

```json
{
  "unions": { "AvatarSize": { "add": ["xxl"], "remove": [] } },
  "tables": {
    "SIZE_TEXT": { "md": "text-base", "xl": "text-xl" },
    "STATUS_COLOR": { "away": "bg-amber-600" }
  }
}
```

### Phase 6 — Drift check

Re-fetch the Figma CS, hash the relevant subtree, compare to the hash captured in Phase 3. If different, abort: `"Figma changed during pull. Re-run /adhd:pull-component."`

### Phase 7 — Apply to the React file

AST-surgery using the TypeScript compiler API's text-replacement APIs. Single `Write` tool call writes the fully transformed source — pull is atomic per file.

**Touched:**
- Property values in `Record<Union, string>` table literals — replaced in place, preserving surrounding whitespace, indentation, and comments.
- Union member lists on `TypeAliasDeclaration` of `UnionTypeNode<LiteralTypeNode>` — appended or removed.
- When a union member is added, every `Record<ThatUnion, ...>` table in the file receives a new key:
  - If Figma's bound class resolves cleanly: `xxl: "h-20 w-20"`
  - In `--allow-unbound` mode for unbindable values: `// adhd:off-system — figma has no radius variable for 32px` followed by `xxl: "h-[80px] w-[80px] rounded-[32px]"`
- When a union member is removed, the corresponding key is removed from every table.

**Never touched:**
- Function declarations, function bodies, JSX, hook calls, event handlers, imports (other than no imports are added or removed).
- Lookup tables typed with non-`string` value types.
- Tables defined inside function bodies.

**Formatting preservation:**
- Detect indentation from the first indented line of the file (2-space / 4-space / tab); mirror it for any inserted lines.
- Preserve CRLF / LF line endings.
- Preserve existing comment positions; new `// adhd:off-system` comments are inserted above their associated table entry.

### Phase 8 — Write mapping if scaffold mode

Only runs in scaffold mode. Add `components.<new-path>.figma.url` to `adhd.config.ts` using the same `Edit` tool flow `/adhd:push-component` uses on first push. The added entry matches the parent schema:

```ts
"app/components/avatar/index.tsx": {
  figma: {
    url: "https://www.figma.com/design/<KEY>/?node-id=91-18",
  },
}
```

### Phase 9 — Per-axis commit

Group applied resolutions by variant axis. For each axis touched, one commit:

```bash
git commit -m "ADHD pull: <component>.<axis> (<N> changes)"
```

Multiple axes → multiple commits. Zero applied changes (user picked "Keep all local") → no commit.

### Phase 10 — Final report

```
✓ Pulled Avatar from Figma:
  - 1 variant added (size: xxl)
  - 3 table cells updated (SIZE_TEXT.md, SIZE_TEXT.xl, STATUS_COLOR.away)
  - 2 cells kept local (user chose "keep local")
  - 0 unmapped Figma properties

Component file: app/components/avatar/index.tsx
Figma URL: https://figma.com/design/<KEY>?node-id=91-18
```

### Phase 11 — Cleanup

Always runs (even on abort). `rm -rf /tmp/adhd-pull-component`.

---

## The lookup-table convention

The convention is now part of the plugin's documented expectations. Components designed to work with ADHD's push/pull cycle structure their design tokens as:

```tsx
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "square";

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  shape?: AvatarShape;
}

// 1-axis table
export const SIZE_BOX: Record<AvatarSize, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
};

// 2-axis table
export const SHAPE: Record<AvatarShape, Record<AvatarSize, string>> = {
  circle: { xs: "rounded-full", sm: "rounded-full", md: "rounded-full", lg: "rounded-full", xl: "rounded-full" },
  square: { xs: "rounded-md", sm: "rounded-md", md: "rounded-lg", lg: "rounded-lg", xl: "rounded-lg" },
};

export function Avatar({ name, size = "md", shape = "circle" }: AvatarProps) {
  // function body — pull never touches this
  return <span className={`${SIZE_BOX[size]} ${SHAPE[shape][size]}`}>...</span>;
}
```

Pull recognizes:
- `AvatarSize`, `AvatarShape` as variant-axis unions. The mapping to Figma's `size`, `shape` variant properties is via the props interface — pull walks `AvatarProps`, finds `size: AvatarSize` and `shape: AvatarShape`, and links each prop name to its union.
- `SIZE_BOX`, `SHAPE` as lookup tables keyed by those unions. Tables get linked to a Figma axis through their key type — `Record<AvatarSize, ...>` maps to the `size` axis because `AvatarSize` is referenced from the `size` prop.
- The component function as a sniff-only target — its existence confirms this is a component file, but its body is invariant.

Tables that don't fit the pattern are reported and ignored. The plugin does not attempt to infer design tokens from arbitrary code shapes — that's a recipe for false positives and silent rewrites.

---

## Config schema additions

`adhd.config.ts` gains a `components` field:

```ts
const config = {
  figma: {
    url: "https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/...",
  },
  components: {
    "app/components/avatar/index.tsx": {
      figma: {
        url: "https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/?node-id=91-18",
      },
      // v1: optional
      // allowUnboundFigma: true,

      // v2+ (not implemented in this PR):
      // allowStructWarnings: ["STRUCT008"],
      // syncMode: "auto" | "review",
    },
  },
};

export default config;
```

Schema rules:
- Paths are relative to the directory containing `adhd.config.ts`.
- `components.<path>.figma.url` MUST include `node-id` pointing at a `COMPONENT_SET` or top-level `COMPONENT`.
- The file key in each `components.*.figma.url` MUST match `config.figma.url`'s file key.
- Per-component non-Figma settings live at the same level as `figma` (not inside it).

**Writers of `components.*`:**
- `/adhd:push-component`: writes on first successful push (NEW additive Phase 12.5 added to push-component as part of this PR).
- `/adhd:pull-component`: writes on first successful scaffold-mode pull.

**Readers:**
- `/adhd:pull-component`: path↔URL bidirectional lookup.
- `/adhd:push-component` (in v2): to decide "update existing CS vs create new page." v1 still always creates new, but lays the mapping for future use.
- `/adhd:config`: does NOT manage `components.*`. The wizard remains focused on file-level setup.

---

## Module layout

New library at `plugins/adhd/lib/pull-component/`:

| Module | Responsibility |
|---|---|
| `parse-react.js` | TypeScript compiler API walker; extracts unions, props interface, lookup tables, function-body bounds (for invariant assertion). |
| `class-resolver.js` | Re-exports + wraps `lint-engine/variable-categorizer.js` + `theme-parser.js`. Tokenizes multi-class strings, resolves each to `{domain, path, value}` or marks as "layout-only" (ignored). |
| `differ.js` | Pure function: `(localExtract, figmaExtract) → diff.json`. |
| `apply.js` | Pure function: `(sourceText, resolutions) → newSourceText`. Preserves whitespace, comments, line endings. |
| `config-writer.js` | Add/read `components.<path>.figma.url` in `adhd.config.ts`. Idempotent. |
| `cli.js` | Subcommand surface: `parse`, `extract`, `diff`, `apply`, `config-write`. Same shape as `push-component/cli.js`. |

Skill: `plugins/adhd/skills/pull-component/SKILL.md` — orchestrator with `disable-model-invocation: true`, mirroring `push-component`'s phase-by-phase structure.

---

## Edge cases & errors

| Case | Behavior |
|---|---|
| `adhd.config.ts` missing | Abort: `"Run /adhd:config first to set up ADHD."` |
| Path form, no `components` entry | Abort with mapping-not-found message |
| URL form, no matching mapping, no path arg | Enter scaffold mode (prompt for path) |
| URL points at different file than `config.figma.url` | Abort with file-mismatch error |
| `node-id` resolves to non-Component-Set | Abort with type-mismatch error |
| Pre-flight finds unbound values, no escape flag | Abort with the "you need variables" error |
| Pre-flight passes, local file has zero recognizable tables | Abort: `"<path> has no Record<Union, string> tables to pull into. v1 requires the lookup-table convention."` |
| Local file references a union we couldn't find in the same file | Warn + skip that axis; report at end as unmapped |
| Local has `Record<Union, string>` but Figma has no matching variant axis | Report as "local-only table"; skip. Common during partial-progress. |
| Multiple tables typed `Record<SameUnion, string>` (legit — SIZE_BOX + SIZE_TEXT + SHAPE) | Prompted independently in Phase 5b |
| Tailwind class the resolver can't parse | Treat as "unknown local value"; show verbatim in diff |
| Figma references a variable that doesn't exist locally | Abort: `"Figma references variables not in your design system. Run /adhd:pull-design-system first."` |
| Drift check (Phase 6) detects remote change | Abort: `"Figma changed during pull. Re-run /adhd:pull-component."` |
| AST write fails | Abort with the write error. Atomic per file (no partial state). |
| User aborts mid-prompt (Ctrl-C) | Apply nothing; print `"Aborted. No changes."`; cleanup runs |
| Scaffold mode: target path already exists | Abort: `"<target> already exists. Pass a different path or delete it first."` |
| `--allow-unbound` with clean Figma | Flag has no effect; proceeds normally |
| Component name in file ≠ Figma CS name | Warn but proceed |
| Source uses CRLF / tabs / 2-space / 4-space indentation | Detected from existing file; preserved through apply |

---

## Pre-flight escape hatch behavior

When `--allow-unbound` (CLI) OR `components.<path>.allowUnboundFigma === true` (config) is active AND Figma has unbound values:

1. Show the unbound-values list with what they'll become in code (e.g. `text-[20px]`).
2. Confirm prompt: continue with arbitrary classes? (default: No).
3. On confirm:
   - Apply proceeds, off-system entries get the `// adhd:off-system — <reason>` comment in the file.
   - Final report includes a line: `⚠ N entries are off-system. Bind in Figma to bring them back in-system.`

The `// adhd:off-system` comment is:
- **Greppable:** `git grep "adhd:off-system"` lists all drift sources.
- **Self-healing:** when the value is bound in Figma, the next pull replaces the arbitrary class with the proper one AND removes the comment.
- **Future-aware:** v2 can ship an `OFFSYSTEM_USAGE` lint rule that surfaces these in `/adhd:lint` output as drift hotspots.

**Round-trip consequence (intentional):** off-system code in React fails `/adhd:push-component`'s preflight on the way back. This forces a discussion: bind it in Figma, or define new variables and `/adhd:pull-design-system` them. The escape hatch is not a permanent crutch.

---

## Symmetric-pipeline assertions

| Assertion | Mechanism |
|---|---|
| `class-resolver.js` imports — never duplicates — `lint-engine` Tailwind-resolution logic | Module re-exports from `lint-engine/variable-categorizer.js` + `lint-engine/theme-parser.js`; tested in `__tests__/class-resolver.test.js` |
| Pre-flight uses the same `checkStructure` that `/adhd:lint` and `/adhd:push-component`'s preflight use | Phase 2.5 invokes `lint-engine`'s structure-checker directly; tested by running a known-violation fixture |
| Round-trip stability: push-then-pull produces a no-op diff | Smoke-test acceptance criterion + integration fixture |

---

## Testing strategy

**Layer 1 — Unit tests on each module.** `plugins/adhd/lib/pull-component/__tests__/`:

| Module | Coverage |
|---|---|
| `parse-react.js` | Extract Avatar's unions, props, 5 lookup tables; verify multi-axis tables; assert function-body bounds recorded and never visited |
| `class-resolver.js` | Multi-token strings split; layout tokens ignored; size/color/radius/typography map cleanly; reuses lint-engine code |
| `differ.js` | Pure function: clean (no diff), single cell, added union, removed union, unmapped Figma axis, unmapped local table |
| `apply.js` | Pure function: cell update preserves comments, union append, union remove cascades, no-op resolutions return byte-identical |
| `config-writer.js` | Idempotent on re-add; preserves key order |
| `cli.js` | Each subcommand surface (same pattern as push-component CLI tests) |

**Layer 2 — Integration with real-figma fixtures.** `plugins/adhd/lib/pull-component/__fixtures__/`:

| Fixture | Asserts |
|---|---|
| `avatar-clean.json` | Diff is empty; apply is byte-identical no-op |
| `avatar-cell-change.json` | 1 cell diff; apply rewrites just that line |
| `avatar-added-variant.json` | Union member appended; new key cascades to all SIZE_* tables |
| `avatar-removed-variant.json` | Inverse |
| `avatar-unbound-fill.json` | Pre-flight aborts; error lists the layer path |
| `avatar-unbound-with-flag.json` | With `--allow-unbound`: off-system comment lands in output |

Golden source-text files (`avatar-base.tsx`, `avatar-after-<scenario>.tsx`) committed alongside; tests assert byte-for-byte match after apply.

**Layer 3 — End-to-end smoke test.** Manual, run against the merged-main Avatar source + Figma CS `91:18` in file `PBCAkpPnvGXWrz6H7qfH3V`:

1. Start from merged-main Avatar.
2. `/adhd:pull-component app/components/avatar/index.tsx` → "No changes" (in sync).
3. Make a single Figma edit (rebind one variant's color).
4. Re-run pull → 1-cell diff, prompted, applied, committed.
5. Revert Figma edit, re-run → detects drift in the opposite direction, prompts to revert local.

---

## Acceptance criteria

1. `/adhd:pull-component app/components/avatar/index.tsx` against in-sync Figma produces "No changes" and exits 0.
2. With one cell changed in Figma, pull surfaces the diff, prompts, applies, and commits.
3. With a new variant value in Figma (`size=xxl`), pull prompts to extend the union and cascades the new key through all `Record<AvatarSize, ...>` tables.
4. With a removed variant value in Figma, pull prompts and removes from the union + all tables.
5. URL form: `/adhd:pull-component <figma-url>` reverse-resolves to the path from `components.*.figma.url`.
6. URL form with no matching mapping enters scaffold mode, prompts for target path, writes the new file + the mapping.
7. Pre-flight blocks the pull when Figma has unbound values; the error lists each offending layer with its variant path and property.
8. `--allow-unbound` (or `allowUnboundFigma: true` in config) converts the abort to a confirm-prompt; on confirm, hardcoded arbitrary classes land in the file with `// adhd:off-system` comments.
9. URL points at a different Figma file than `config.figma.url` → abort with the file-mismatch error.
10. Function body, JSX, hooks, handlers, and imports are never modified — verified by golden diff in Layer 2 tests.
11. CRLF line endings, tabs vs spaces, and existing comment positions are preserved through apply.
12. Drift check runs between extract and apply; if Figma changed during the user's deliberation, abort with "Re-run pull-component".
13. Per-axis commit: `git commit -m "ADHD pull: avatar.size (3 changes)"` lands per axis touched; multiple axes → multiple commits; zero changes → zero commits.
14. The `class-resolver` module imports from `lint-engine` — no duplicate Tailwind-to-design-token resolution logic.
15. Re-running `/adhd:pull-component` after `/adhd:push-component` on the same component produces a no-op diff (round-trip stability assertion).
16. Pull adds `components.<path>` to `adhd.config.ts` automatically in scaffold mode, in the `{ figma: { url } }` shape matching the parent config schema.
17. README's command table includes the `/adhd:pull-component` row (enforced by the AGENTS.md "keep README in sync" convention).
18. `/adhd:push-component` writes the same `components.<path>.figma.url` mapping on first push (additive step inserted into push-component's SKILL.md, between Phase 11 "Decide and finalize" and Phase 12 "Final report" — only writes the mapping on the finalize path, never on rollback).
