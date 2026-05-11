# /adhd:pull-component — Pull a Figma Component Set Into a React Component Source File

**Goal:** Inverse of `/adhd:push-component`. Given a target — either a path to an existing React component or a Figma URL — read the corresponding Figma Component Set and reconcile its variant properties, lookup-table values, and union members back into the React source file. Update only the design-token surface (lookup tables, union types); never touch the function body, JSX, handlers, or hooks. Symmetric pipeline: pull's pre-flight validates the Figma source using the same lint engine `/adhd:lint` and `/adhd:push-component`'s preflight use, so structural violations on the Figma side block the pull before any code is rewritten.

**Architectural premise:** This skill is invoked from inside Claude Code. The model is already present, can read both sides of the diff in working memory, prompt the user via `AskUserQuestion`, and apply edits via `Edit` tool calls. We use the LLM as the diff/apply engine rather than reinventing brittle TS-compiler-API parsing + golden-file-tested AST surgery in deterministic library code. Library code is reserved for the parts that must be deterministic and testable: the lint engine (already exists, reused) and `adhd.config.ts` mutation (`config-writer`). Everything else is SKILL instructions executed by the model.

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

---

## What lives in code vs. what the SKILL does

| Concern | Where it lives | Why |
|---|---|---|
| Pre-flight lint (variable-binding violations) | `plugins/adhd/lib/lint-engine/` (existing) | Already deterministic and tested. Reused via subprocess call. |
| `adhd.config.ts` mutation (read & add component mappings) | `plugins/adhd/lib/pull-component/config-writer.js` | Schema-level config edits where determinism + idempotency + tests are valuable. Small surface. |
| Parsing the React file's unions/lookup tables | SKILL (Claude reads the source directly) | The LLM handles variation in component shape gracefully. Brittle pattern-matching would over-constrain the convention. |
| Extracting the Figma Component Set's variants + tokens | SKILL via `use_figma` (no lib helper) | One shot of Plugin API code; result lives in `/tmp/`. |
| Computing the diff (which cells differ, which union members added/removed) | SKILL (Claude reads both `/tmp` files and reasons about them) | The diff is the kind of thing the model does intuitively. No brittle comparator needed. |
| Prompting the user per-divergence | SKILL via `AskUserQuestion` | Standard pattern. |
| Applying changes to the React file | SKILL via `Edit` tool calls | Edit preserves whitespace/comments by design. The model knows which lines to change. |
| Writing the component mapping back to `adhd.config.ts` | `lib/pull-component/config-writer.js` via `Bash` from SKILL | Same determinism argument as config reads. |

The lib code shrinks to one module: `config-writer.js`. Everything else is SKILL instructions.

---

## Pipeline

```
Phase 1   Validate config
Phase 2   Resolve target (path | URL | scaffold mode)
Phase 2.5 Pre-flight lint of the Figma Component Set
Phase 3   Read both sides (Claude reads React source; use_figma extracts CS)
Phase 4   Diff (Claude computes inline)
Phase 5   Resolve divergences (prompts via AskUserQuestion)
Phase 6   Drift check (re-fetch Figma; abort if remote changed)
Phase 7   Apply to the React file (Edit tool calls)
Phase 8   Write mapping if scaffold mode (config-writer)
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
| `<figma-url>` with no mapping | **scaffold** | Ask via `AskUserQuestion`: "Where should this component live?" Validate target path doesn't already exist. |

Path lookup and reverse lookup are done by the `config-writer` subcommands (deterministic, testable).

If the URL's file key doesn't match `config.figma.url`, abort: `"URL points at file <X>, but adhd.config.ts is configured for file <Y>."`

If `node-id` resolves to a node that isn't a `COMPONENT_SET` or top-level `COMPONENT`, abort: `"Target node <id> is a <type>. Pull requires a Component Set."`

### Phase 2.5 — Pre-flight lint

Extract the Component Set's structural data via `use_figma`, scoped to the resolved node-id. Save to `/tmp/adhd-pull-component/ctx.json` and `/tmp/adhd-pull-component/vars.json`.

Run the same lint engine `/adhd:lint` uses:

```bash
node plugins/adhd/lib/lint-engine/cli.js \
  --variable-defs /tmp/adhd-pull-component/vars.json \
  --design-context /tmp/adhd-pull-component/ctx.json \
  --globals-css <path> \
  --config adhd.config.ts \
  --target "PullComponent Preflight" \
  --target-url "$FIGMA_URL" \
  --output /tmp/adhd-pull-component/preflight.md
```

Read the report; locate variable-binding errors (STRUCT003/004/005). Naming and structural-organization warnings (STRUCT008, STRUCT009) appear in the final report but do not block.

**Default behavior (strict):** if any variable-binding errors exist, abort with the helpful error listing each offending layer with its variant path and property:

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

**React side:** in update mode, Claude reads the file directly with `Read` and identifies:
- The exported function component name (declared via `export function <Name>(...)`).
- Exported `type X = "a" | "b" | ...` string-literal unions.
- The component's props interface (`<Name>Props`) — used to map prop names to union references (e.g. `size?: AvatarSize` → axis `size` maps to union `AvatarSize`).
- Top-level `export const TABLE: Record<Union, string> = { ... }` or `Record<Outer, Record<Inner, string>>` lookup tables.

In scaffold mode, there is no local file. Phase 7 will materialize a fresh file using all of Figma's values plus a stub function body.

**Figma side:** the SKILL runs a `use_figma` script that walks the Component Set and, for every variant, captures the resolved Tailwind-equivalent class strings per design-token-bearing property (fill colors, fontSize, padding, radius, etc.). Output shape (saved to `/tmp/adhd-pull-component/figma.json`):

```json
{
  "componentSetId": "<id>",
  "componentName": "Avatar",
  "variantAxes": { "size": ["xs","sm","md","lg","xl"], "shape": ["circle","square"], "status": ["online","away","offline"] },
  "variants": [
    {
      "props": { "size": "lg", "shape": "circle", "status": "away" },
      "tokens": {
        "avatar-body.fill": "bg-zinc-800",
        "initials.fontSize": "text-base",
        "status-dot.fill": "bg-amber-500"
      }
    }
  ]
}
```

The mapping from Figma layer/property → Tailwind class is done by reversing the design-system push pipeline (variable id → variable name → Tailwind class via theme-parser, which `lint-engine` already provides).

The SKILL doesn't need a separate library function for "extract from Figma" — it's one `use_figma` block, encoded in Phase 3 of the SKILL.

### Phase 4 — Diff

Claude reads both `/tmp/adhd-pull-component/local-context.md` (a brief summary written by Claude after reading the React file in Phase 3) and `/tmp/adhd-pull-component/figma.json`, then computes the diff in three buckets:

- **`unionDiff`** — for each Figma `variantAxes` entry whose values don't match the corresponding local union members: which to add, which to remove.
- **`tableDiff`** — for each local lookup table, walk Figma variants; for variants whose props match the table's key axis, compare the Figma resolved token against the local table cell. Record divergences.
- **`unmapped`** — Figma variant axes with no matching local prop/union, OR local tables with an axis that doesn't appear in Figma.

The diff is held in working memory (and optionally written to `/tmp/adhd-pull-component/diff.md` for the user-facing summary in Phase 5).

### Phase 5 — Resolve divergences

Top-of-loop short-circuit via `AskUserQuestion`:

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

**5a — Union changes first.** Per axis, prompt to add the new value (and cascade entries to all `Record<ThatUnion, ...>` tables) or skip. If the user skips an axis, all subsequent table-cell prompts for that axis are also skipped.

**5b — Table cells next.** Per table with changes, show the table + cells with a 3-way prompt (`Apply Figma's values to all N cells` / `Review each one` / `Keep all local values`).

**5c — Unmapped, informational only.** Print a notice; no prompts.

The resolutions live in Claude's working memory; they don't need a `/tmp/resolutions.json` file because the apply step (Phase 7) is also Claude.

### Phase 6 — Drift check

Re-fetch the Figma CS via `use_figma`, hash the variant subtree, compare to the hash captured at Phase 3. If different, abort: `"Figma changed during pull. Re-run /adhd:pull-component."`

### Phase 7 — Apply

**Update mode:** for each resolved change, Claude uses the `Edit` tool to update the React source. Specifically:

- **Cell update:** `Edit` the property value in the relevant `Record<...>` table. The model identifies the exact line and replaces only the value string.
- **Union member add:** `Edit` the `type X = ...` declaration to append the new member, then for each `Record<X, ...>` table in the file, `Edit` to insert the new key with its Figma-resolved value. If the value is off-system (escape hatch active), prepend a `// adhd:off-system — <reason>` comment line above the new entry.
- **Union member remove:** `Edit` the `type X = ...` to remove the member, then `Edit` each `Record<X, ...>` table to drop the corresponding key.

The model knows not to touch the function body, JSX, hooks, handlers, or imports — these are explicit invariants in the SKILL prompt.

**Scaffold mode:** Claude composes a fresh component file matching the lookup-table convention:

```tsx
import React from "react";

export type <Component>Size = "<v1>" | "<v2>" | ...;
// ...other axes

export interface <Component>Props {
  // axes from Figma variantAxes, optional
}

export const <COMPONENT>_<TABLE>: Record<<Component>Size, string> = {
  // entries from Figma
};
// ...other tables

export function <Component>(/* props */) {
  return <span />; // adhd: scaffold stub — replace with your implementation
}
```

Written via `Write` to the user-provided target path.

### Phase 8 — Write mapping if scaffold mode

```bash
node plugins/adhd/lib/pull-component/cli.js config-write \
  --config adhd.config.ts \
  --path <new-relative-path> \
  --figma-url <figma-url>
```

In update mode the mapping was used as input but doesn't change, so this step is a no-op.

### Phase 9 — Per-axis commit

Group applied resolutions by variant axis. For each axis touched, one commit:

```bash
git commit -m "ADHD pull: <component>.<axis> (<N> changes)"
```

Multiple axes → multiple commits. Zero applied changes → no commit.

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

Components designed to work with ADHD's push/pull cycle structure their design tokens as:

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

Pull recognizes (via Claude reading the source):
- `AvatarSize`, `AvatarShape` as variant-axis unions. The mapping to Figma's `size`, `shape` variant properties is via the props interface — `size: AvatarSize` and `shape: AvatarShape`.
- `SIZE_BOX`, `SHAPE` as lookup tables keyed by those unions. Tables get linked to a Figma axis through their key type — `Record<AvatarSize, ...>` maps to the `size` axis because `AvatarSize` is referenced from the `size` prop.
- The component function as a sniff-only target — its existence confirms this is a component file, but its body is invariant.

The convention is documented in the README and in the SKILL prompt. Files that don't follow it are reported and the pull is aborted — the SKILL prompt tells Claude exactly what to look for so that "doesn't follow the convention" is a clear, reproducible determination.

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
- `/adhd:push-component`: writes on first successful push (NEW additive step inserted into push-component's SKILL.md between Phase 11 "Decide and finalize" and Phase 12 "Final report" — only writes on the finalize path, never on rollback).
- `/adhd:pull-component`: writes on first successful scaffold-mode pull.

**Readers:**
- `/adhd:pull-component`: path↔URL bidirectional lookup.
- `/adhd:push-component` (in v2): to decide "update existing CS vs create new page." v1 still always creates new, but lays the mapping for future use.
- `/adhd:config`: does NOT manage `components.*`. The wizard remains focused on file-level setup.

---

## Module layout

Library at `plugins/adhd/lib/pull-component/`:

| File | Responsibility |
|---|---|
| `config-writer.js` | Read & idempotently add `components.<path>.figma.url` in `adhd.config.ts`. Also `reverseLookupPath(source, figmaUrl)`. |
| `cli.js` | Single subcommand: `config-write --config <path> --path <rel> --figma-url <url>` plus `config-read --config <path> --path <rel>` and `config-reverse --config <path> --figma-url <url>`. |
| `__tests__/config-writer.test.js` | Unit tests for the three functions (idempotent add, append-to-existing, reverse lookup). |
| `__tests__/cli.test.js` | CLI surface tests. |
| `README.md` | One-paragraph module readme. |

Skill: `plugins/adhd/skills/pull-component/SKILL.md` — orchestrator with `disable-model-invocation: true`. Contains all the LLM-driven phases (read React, extract Figma, diff, prompt, apply via Edit). The SKILL prompt is detailed enough that Claude can execute it deterministically — every behavior the user can rely on is explicitly described, not left to the model's intuition.

There is no `parse-react.js`, `differ.js`, or `apply.js`. The model handles those phases.

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
| Pre-flight passes, local file has no recognizable convention (no exported function + props + at least one `Record<Union, string>` table) | Abort: `"<path> doesn't follow the lookup-table convention. v1 requires it."` |
| Local file references a union that's not defined in the same file | Warn + skip that axis; report at end as unmapped |
| Local table indexed by a union not present as a prop type | Report as "local-only table"; skip. Common during partial-progress. |
| Multiple tables typed `Record<SameUnion, string>` (legit — e.g. SIZE_BOX + SIZE_TEXT) | Diff/prompt independently per table |
| Figma references a variable that doesn't exist locally | Abort: `"Figma references variables not in your design system. Run /adhd:pull-design-system first."` |
| Drift check (Phase 6) detects remote change | Abort: `"Figma changed during pull. Re-run /adhd:pull-component."` |
| `Edit` tool call fails (e.g. expected text not found) | Surface the underlying error; the SKILL aborts the pull. No partial state because Edit failures don't write. |
| User aborts mid-prompt (Ctrl-C) | Apply nothing; print `"Aborted. No changes."`; cleanup runs |
| Scaffold mode: target path already exists | Abort: `"<target> already exists. Pass a different path or delete it first."` |
| `--allow-unbound` with clean Figma | Flag has no effect; proceeds normally |
| Component name in file ≠ Figma CS name | Warn but proceed |

---

## Pre-flight escape hatch behavior

When `--allow-unbound` (CLI) OR `components.<path>.allowUnboundFigma === true` (config) is active AND Figma has unbound values:

1. Show the unbound-values list with what they'll become in code (e.g. `text-[20px]`).
2. Confirm prompt: continue with arbitrary classes? (default: No).
3. On confirm:
   - Apply proceeds; off-system entries get the `// adhd:off-system — <reason>` comment in the file (via the same Edit-tool path Claude uses for in-system entries).
   - Final report includes a line: `⚠ N entries are off-system. Bind in Figma to bring them back in-system.`

The `// adhd:off-system` comment is:
- **Greppable:** `git grep "adhd:off-system"` lists all drift sources.
- **Self-healing:** when the value is bound in Figma, the next pull replaces the arbitrary class with the proper one and removes the comment (the model is explicitly told to do this in the SKILL prompt).
- **Future-aware:** v2 can ship an `OFFSYSTEM_USAGE` lint rule that surfaces these in `/adhd:lint` output.

**Round-trip consequence (intentional):** off-system code in React fails `/adhd:push-component`'s preflight on the way back. This forces a discussion: bind it in Figma, or define new variables and `/adhd:pull-design-system` them. The escape hatch is not a permanent crutch.

---

## Symmetric-pipeline assertions

| Assertion | Mechanism |
|---|---|
| Pre-flight uses the same `checkStructure` that `/adhd:lint` and `/adhd:push-component` preflight use | Phase 2.5 invokes `lint-engine`'s CLI as a subprocess; same code path |
| `adhd.config.ts` mapping is read & written by both push and pull through the same `config-writer.js` module | Push-component's new mapping-write step invokes the same CLI subcommand pull uses |
| Round-trip stability: push-then-pull produces a no-op diff for clean components | Verified via the manual smoke test acceptance criterion (the model can't be unit-tested for byte-identity, but the round-trip property is testable end-to-end) |

---

## Testing strategy

The model-driven nature of Phases 3–7 changes the test pyramid. We test the deterministic bits with traditional unit tests; we test the LLM bits via reproducible end-to-end fixtures and manual smoke tests, not golden-byte diffs.

**Layer 1 — Unit tests on deterministic lib code:**

| Module | Coverage |
|---|---|
| `config-writer.js` `addComponentMapping` | Adds entry when missing; idempotent on re-add; appends to existing components; updates URL if different |
| `config-writer.js` `readComponentMapping` | Returns `{ figma: { url } }` or `null` |
| `config-writer.js` `reverseLookupPath` | Returns the relative path or `null` |
| `cli.js` config subcommands | Each surface returns exit 0 on success; exit 2 on usage error |

**Layer 2 — SKILL-driven behavior (verified by reading the SKILL prompt itself):**

The SKILL.md is the contract for what the model does. The plan includes a **SKILL prompt review** task — a fresh subagent reads the spec + the SKILL.md and asks: "Is every phase described concretely enough that any Claude Code agent would execute it the same way? Are the invariants (function body untouched, off-system comment format, abort conditions) stated explicitly?" Findings are addressed before merge.

**Layer 3 — End-to-end smoke test (manual):**

1. Start from a clean local Avatar source. `/adhd:pull-component app/components/avatar/index.tsx` → "No changes" and exits 0.
2. Make a small Figma edit (rebind one variant's color in the Avatar CS, `91:18`).
3. Re-run pull → 1-cell diff, prompted, applied, committed. Verify the function body is untouched and the change lands in the correct lookup table.
4. Revert the Figma edit, re-run → detects drift the other way, prompts to revert local.
5. Test the escape hatch: deliberately unbind one Figma value, run `/adhd:pull-component --allow-unbound`, verify off-system comment lands and the rest of the file is preserved.

Documented in the spec as a manual acceptance check, not automated CI.

---

## Acceptance criteria

1. `/adhd:pull-component app/components/avatar/index.tsx` against in-sync Figma produces "No changes" and exits 0.
2. With one cell changed in Figma, pull surfaces the diff, prompts, applies (via Edit tool), and commits.
3. With a new variant value in Figma (`size=xxl`), pull prompts to extend the union and cascades the new key through all `Record<AvatarSize, ...>` tables.
4. With a removed variant value in Figma, pull prompts and removes from the union + all tables.
5. URL form: `/adhd:pull-component <figma-url>` reverse-resolves to the path from `components.*.figma.url` via `config-writer`.
6. URL form with no matching mapping enters scaffold mode, prompts for target path, writes the new file via `Write`, and adds the mapping via `config-writer`.
7. Pre-flight blocks the pull when Figma has unbound values; the error lists each offending layer with its variant path and property.
8. `--allow-unbound` (or `allowUnboundFigma: true` in config) converts the abort to a confirm-prompt; on confirm, hardcoded arbitrary classes land in the file with `// adhd:off-system` comments.
9. URL points at a different Figma file than `config.figma.url` → abort with the file-mismatch error.
10. Function body, JSX, hooks, handlers, and imports are never modified — the SKILL prompt explicitly states this invariant and Claude is responsible for honoring it.
11. The SKILL prompt names the lookup-table convention precisely enough that Claude can detect "doesn't follow the convention" reproducibly.
12. Drift check runs between extract and apply; if Figma changed during the user's deliberation, abort with "Re-run pull-component".
13. Per-axis commit: `git commit -m "ADHD pull: avatar.size (3 changes)"` lands per axis touched; multiple axes → multiple commits; zero changes → zero commits.
14. Pre-flight invokes `lint-engine/cli.js` as a subprocess — no duplicate structural-lint logic. (`class-resolver.js` and similar bridges are NOT introduced; the SKILL handles class-to-token resolution by reading globals.css and resolving as needed.)
15. Re-running `/adhd:pull-component` after `/adhd:push-component` on the same component produces a no-op diff (round-trip stability assertion via manual smoke test).
16. Pull adds `components.<path>` to `adhd.config.ts` automatically in scaffold mode, in the `{ figma: { url } }` shape matching the parent config schema.
17. README's command table includes the `/adhd:pull-component` row (enforced by the AGENTS.md "keep README in sync" convention).
18. `/adhd:push-component` writes the same `components.<path>.figma.url` mapping on first push (additive step inserted into push-component's SKILL.md between Phase 11 and Phase 12 — only writes on the finalize path, never on rollback).
