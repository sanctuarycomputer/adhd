# /adhd:push-design-system and /adhd:pull-design-system — Direct Figma Token Sync via Remote MCP

**Goal:** Replace the DTCG/TokensBrücke flow with two direct push/pull commands powered by the Figma remote MCP's `use_figma` write tool. Two-way diff with per-attribute conflict prompts; additive (no deletions); structured `AskUserQuestion` UX with explicit batch confirmation.

**Architectural premise:** the Figma remote MCP server (`figma@claude-plugins-official`) exposes `use_figma` — a general-purpose JS execution channel into Figma files, with full read/write access to variables, styles, frames, and structure. This eliminates the need for the DTCG-JSON-plus-TokensBrücke intermediate that earlier plans depended on. Token sync becomes a direct API call in both directions.

**Key simplification:** drop the `leader` field, drop the DTCG library, drop the `to-dtcg` skill. Direction is chosen by which command the user runs. No declarative canonicality. No JSON-on-disk intermediate. Per-attribute conflict resolution at runtime, prompted via the structured `AskUserQuestion` UI.

---

## Final command surface

```
/adhd:config                — setup wizard (existing)
/adhd:push-design-system    — code → Figma (variables + named styles)
/adhd:pull-design-system    — Figma → code (variables + named styles)
/adhd:lint                  — read-only Figma frame validator (existing; small adjustments)
```

Four commands, each with one job.

**Out of scope (v1):**
- Components / variants push/pull
- Code Connect mappings
- Manifest-based three-way merge
- Combined bidirectional sync command
- Modes beyond Light/Dark
- Non-main-branch Figma operations

---

## Conflict-resolution model

Both commands run the same comparison engine; only the write direction differs.

### Compare phase (identical for push and pull)

For each token in the union of code + Figma, classify:

| Code has it? | Figma has it? | Same value? | Status |
|---|---|---|---|
| ✓ | ✓ | yes | `same` (no-op) |
| ✓ | ✓ | no | `conflict` (prompt) |
| ✓ | ✗ | — | `code-only` |
| ✗ | ✓ | — | `figma-only` |

### Write phase

**`/adhd:push-design-system`:**
- `same` → no-op
- `conflict` → prompt (see Prompt UX below)
- `code-only` → auto-create in Figma (no prompt)
- `figma-only` → leave Figma's value alone (additive)

**`/adhd:pull-design-system`** — symmetric:
- `same` → no-op
- `conflict` → prompt
- `figma-only` → auto-create in code (no prompt)
- `code-only` → leave code alone

### Prompt UX

All prompts use `AskUserQuestion` structured menus — no bare-character prompts anywhere in the plugin.

Per-conflict prompt:
```
[1/3] color/brand/surface (Light mode)

  Figma: #faf0c5
  code:  #fae8a0

  ⚪ Keep Figma value (no change)
  ⚪ Use code value (overwrite Figma)
  ⚪ Use Figma's values for all 3 conflicts
  ⚪ Use code's values for all 3 conflicts
```

If the user picks one of the batch options, a follow-up confirm fires:
```
Confirm batch resolution

You're about to use Figma's values for ALL 3 conflicts without
reviewing the remaining 2 individually:

  - color/brand/surface-raised
    Figma: #f5dd87
    code:  #f4d878
  - color/brand/on-surface
    Figma: #5e3d0e
    code:  #5d3c0c

  ⚪ Apply all
  ⚪ Cancel — go back to per-conflict review
```

The full diff is shown in the confirm so the user sees exactly what they're committing to. Cancel returns to the per-conflict loop at the position the user was at.

The non-batch options ("Keep Figma" / "Use code") apply immediately — no extra confirm, since they're scoped to one variable.

If there are zero conflicts, no prompts fire — just a single line: `0 conflicts. Applying X new variables to Figma.`

### Mid-resolution abort

Writes are batched after all prompts are resolved. If the user kills the command (Ctrl-C) during prompts, no writes have happened yet. Aborting is always safe.

### Re-fetch right before writing

Before applying batched writes, the command re-fetches the destination side's current state. If anything changed since the initial compare (someone edited Figma during the prompt phase), the command aborts:

```
✗ Destination drifted during this run. Re-run /adhd:push-design-system
  to see fresh conflicts.
```

Cheap; one MCP call. No write happens until the destination is verified unchanged.

---

## Translation layer

Both commands share a parser/serializer/comparator library at `plugins/adhd/lib/design-system/`. It exposes:

```ts
parseCodeDesignSystem(globalsPath: string): DesignSystem
serializeFigmaDesignSystem(useFigmaResult: any): DesignSystem
compareDesignSystems(code: DesignSystem, figma: DesignSystem):
  { same: Token[], conflict: TokenConflict[], codeOnly: Token[], figmaOnly: Token[] }
```

### Canonical comparable shape

```ts
type Token = {
  domain: 'color' | 'spacing' | 'radius' | 'shadow' | 'typography'
  path: string                              // e.g. "gold/100" or "brand/surface"
  values: { [mode: string]: TokenValue }    // mode = "default" | "light" | "dark"
}

type TokenValue =
  | { type: 'literal', value: string }       // "#faf0c5", "16px", etc.
  | { type: 'alias',   target: string }      // path of another token, e.g. "gold/100"
```

Both sides parse to this shape. The compare engine works on it. Writes translate it back to native form (CSS or Figma Plugin API).

### Code-side parsing (`globals.css`)

```
@theme {
  --color-gold-100: #faf0c5;     → token: gold/100, primitive (default mode)
  --color-gold-900: #3f2909;
}

:root {
  --brand-surface: var(--color-gold-100);    → token: brand/surface, light mode: alias→gold/100
}

@media (prefers-color-scheme: dark) {
  :root {
    --brand-surface: var(--color-gold-900);   → token: brand/surface, dark mode: alias→gold/900
  }
}

@theme inline {
  --color-brand-surface: var(--brand-surface);     → exposure alias for brand/surface
  --color-foreground:    var(--foreground);
}
```

`@theme inline` is Tailwind v4's exposure layer — it makes semantic CSS variables reachable as Tailwind utility classes (`bg-brand-surface`, etc.). It's load-bearing in the codebase: without it, you'd have to write `bg-[var(--brand-surface)]` everywhere. We **preserve it round-trip** but treat it specially:

- **Parse:** the design-system library parses `@theme inline` as a separate `exposure` layer. Each entry is an alias from the prefixed name to the underlying semantic variable.
- **Push:** exposure-only variables are **not** pushed to Figma. They're aliases-of-aliases (`color-brand-surface → brand-surface → gold/100|gold/900`) — pushing them would create redundant variables in Figma that alias other variables in the same collection, with no semantic value beyond the underlying ones. Designers would just see two related variables and wonder which to use.
- **Pull:** when pull adds a new semantic variable to code (e.g., a new `brand/accent` lands from Figma), it also adds the corresponding exposure alias to `@theme inline` if the codebase has an existing exposure pattern. The heuristic: if the file already has any `@theme inline` entries, pull maintains the pattern; if the file has no exposure layer, pull doesn't invent one.
- **Compare:** exposure-only variables don't participate in the conflict diff. They're code-only by design and match nothing on the Figma side. The compare engine filters them out before producing `same` / `conflict` / `code-only` / `figma-only` classifications.

The existing `lib/lint-engine/theme-parser.js` already handles this — it returns `{ primitives, exposure, light, dark }` — and the new `lib/design-system/` library reuses the parser, treating `exposure` as a special metadata layer rather than a token set.

### Figma-side reading (`use_figma`)

```js
// Run inside use_figma
const collections = await figma.variables.getLocalVariableCollectionsAsync();
for (const col of collections) {
  for (const vid of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    for (const mode of col.modes) {
      const value = v.valuesByMode[mode.modeId];
      // value is either {r,g,b} for color or a number for dimension
      // OR {type:"VARIABLE_ALIAS", id:"VariableID:..."} for aliases
    }
  }
}
```

Effect styles and text styles are read via `figma.getLocalEffectStylesAsync()` / `figma.getLocalTextStylesAsync()`.

### Aliases

When a code value is `var(--color-gold-100)`, push converts it to a Figma variable alias pointing at the corresponding `gold/100` variable, not a duplicated hex. Pull does the inverse — Figma aliases become `var(--color-gold-100)` references in `globals.css`.

Aliases are part of value comparison: comparing alias-to-alias works on the resolved target name. Comparing alias-to-hex is a conflict (the user has explicitly broken the alias relationship on one side).

### Mode mapping

| Code form | Figma mode |
|---|---|
| `@theme { --x: ... }` | primitive — same value across all modes |
| `:root { --x: ... }` (default block) | "Light" mode |
| `:root[data-theme="dark"] { ... }` OR `@media (prefers-color-scheme: dark) :root { ... }` | "Dark" mode |

Push creates collections with appropriate mode structure: single-mode for primitives, Light/Dark for semantic. Pull writes back to whichever code form is already there; if both are absent, default to `@media (prefers-color-scheme: dark)` (the form Tailwind/Next.js conventions favor).

### Effect styles & text styles

Named styles, single-mode (no Light/Dark for typography in our globals.css yet). Translated as Figma `EffectStyle` and `TextStyle` objects respectively, named from the token path.

---

## Collection conventions in Figma

Push creates these collections on first run if missing; subsequent runs add/update variables in the existing collections.

| Collection | Modes | Variables |
|---|---|---|
| `color` | Light, Dark | gold/50–950 (primitives), brand/surface, brand/on-surface, etc. (semantic) |
| `spacing` | single (default) | space/4, space/8, etc. |
| `radius` | single (default) | radius/sm, radius/full, etc. |
| `shadow` | single (default) | shadow/2xs, shadow/md, etc. |
| `typography` | single (default) | font/family, font/size/sm, font/weight/medium |

Mode structure adapts to the codebase: if globals.css has Light+Dark for color, the color collection has both modes. If a codebase later introduces dark-mode spacing, push extends the spacing collection's modes accordingly.

### Variable scopes

Push sets explicit scopes per domain — important because Figma's default `ALL_SCOPES` pollutes every property picker:

| Domain | Scopes |
|---|---|
| color | `FRAME_FILL`, `SHAPE_FILL`, `TEXT_FILL`, `STROKE_COLOR` |
| spacing | `GAP`, `WIDTH_HEIGHT` |
| radius | `CORNER_RADIUS` |
| typography (font-size variables) | `FONT_SIZE` |
| shadow | not directly bindable; lives as effect styles instead |

### Naming convention in Figma

Variable names match the CSS variable name minus the domain prefix:

| CSS var | Figma collection / variable |
|---|---|
| `--color-gold-100` | collection `color` / variable `gold/100` |
| `--brand-surface` | collection `color` / variable `brand/surface` |
| `--radius-sm` | collection `radius` / variable `sm` |

The collection name is the implicit domain prefix; we don't include it again in the variable path.

---

## /adhd:lint expansion: whole-file lint mode

`/adhd:lint` previously required a Figma URL or current selection (a single frame, component, component set, or page). With the remote MCP's `use_figma`, the lint command can enumerate the entire file in one shot. Two modes:

- **Whole-file lint** (default, no argument) — `/adhd:lint` with no URL enumerates every page, finds every `COMPONENT_SET`, top-level `COMPONENT`, and top-level `FRAME` on each page, runs the structural rules across them, and produces a unified report.
- **Scoped lint** — `/adhd:lint <figma-url>` keeps existing behavior: scope to the URL's node and its subtree.

The whole-file pipeline is one `use_figma` call that walks `figma.root.children` (pages), iterates each page's top-level lintable nodes, serializes each subtree to the canonical structural shape, and returns the array. The lint engine consumes that array (one entry per top-level node), produces a violation list per node, and the report formatter groups violations by page → top-level node:

```
# ADHD lint report
**Target:** Whole file (3 pages, 12 top-level nodes)
**Run at:** 2026-05-10 14:23 UTC
**Result:** 2 errors, 5 warnings

## Page: Components
### avatar (COMPONENT_SET)  3 violations
  - **STRUCT003** Fill is a raw color; use a color variable. → avatar/size=md > inner — [open](deep-link)
  - ...
### button (COMPONENT_SET)  ✓ no violations

## Page: Marketing
### Landing (FRAME)  1 violation
  - ...
```

**Performance:** large files can have hundreds of nodes. v1 strategy: do it in one pass, trust `use_figma`'s response budget. If responses are truncated, surface a warning suggesting a scoped run on a specific page. We don't auto-paginate or stream in v1 — the workaround is a one-keystroke change for the user.

**Skip rules:** v1 lints everything on every page. We don't filter by page-name conventions ("Drafts", "Scratchpad") in v1 — too prescriptive, users can scope to a specific page if they have throwaway content.

**File-level rules:** the whole-file mode unlocks a class of lint rule we couldn't do before — rules that compare across components. v1 stays focused on per-node structural rules (STRUCT001–010), but a future v2 could add:
- Duplicate detection (two components with the same content but different names)
- Token-domain coverage (every domain has at least one variable used somewhere in the file)
- Orphaned components (defined but never instanced)

These are out of scope here but are now feasible — flagged as future work.

---

## /adhd:lint integration (drift check at code-gen time)

`/adhd:lint` already does the variable-existence check (`missing` status). Two small adjustments support the push/pull architecture:

### 1. Sharper error on missing tokens

When `/adhd:lint` finds a Figma frame referencing a variable not in `globals.css`, the report says:

```
✗ Frame uses tokens not defined in your design system:
  - color/brand/accent  (Figma defines this; your globals.css doesn't)
  - radius/lg

  → Run /adhd:pull-design-system to import the missing tokens, then re-run /adhd:lint.
```

This is the drift check at code-gen time — lint catches the case where Figma has tokens that haven't been pulled into code, and tells the user exactly what to do.

### 2. Conflict-aware reporting

When a token exists on both sides but with different values, the lint report adds:

```
⚠ Variable conflicts (will be flagged on next push or pull):
  - color/brand/surface (Light)
    Figma: #faf0c5
    code:  #fae8a0

  → Run /adhd:pull-design-system or /adhd:push-design-system to resolve.
```

These are warnings, not errors — `/adhd:lint` still passes structural validation. The conflict block is informational, surfacing drift before the user tries to code-gen against an out-of-sync design system.

---

## Migration from current state

| Current | New | Action |
|---|---|---|
| `plugins/adhd/skills/to-dtcg/` | — | Delete |
| `plugins/adhd/lib/to-dtcg/` | — | Delete |
| `plugins/adhd/skills/export-for-figma/` | — | Delete |
| `plugins/adhd/skills/sync/` | `skills/pull-design-system/` | Rename + rewrite to use `use_figma` extraction |
| (new) | `skills/push-design-system/` | Create |
| `plugins/adhd/skills/lint/` | (same) | Update error messages per Lint Integration |
| `plugins/adhd/lib/lint-engine/` | (same) | Keep; share parsing helpers with `lib/design-system/` |
| (new) | `plugins/adhd/lib/design-system/` | Create — parser/serializer/comparator |
| CI: `lib unit tests` job | (same job, new contents) | Drop to-dtcg test step; add design-system test step |

User-facing churn is small: two new commands, one rename, two deletions, one keeps-its-name.

The `adhd.config.ts` schema is unchanged — already minimal post Plan 2 (`figma.url`, optional `naming`, optional `cssEntry`, optional `domains`). The `naming` field stays (controls `/adhd:lint`'s STRUCT009 rule).

---

## Acceptance criteria

1. `/adhd:push-design-system` invoked on a clean Figma file creates all variables from `globals.css` with proper Light/Dark modes for the color collection, scoped per domain.
2. `/adhd:push-design-system` invoked when Figma already has the variables produces no prompts, no writes, exits cleanly.
3. `/adhd:push-design-system` with a single value conflict shows a 4-option `AskUserQuestion` menu; choosing "Keep Figma value" applies no change to that variable.
4. Choosing "Use Figma's values for all N conflicts" triggers a confirm dialog showing the full pending diff before applying.
5. Cancel from the batch confirm returns to the per-conflict loop at the right position.
6. `/adhd:pull-design-system` is symmetric: same prompt flow, opposite direction.
7. Aliases round-trip: `--brand-surface: var(--color-gold-100)` becomes a Figma variable alias and back without value drift.
8. The drift case (Figma changed during the prompt phase) is detected and aborts before writing.
9. `/adhd:lint` against a frame that references a variable not in `globals.css` errors with "Run /adhd:pull-design-system first" and exits non-zero.
10. Deleting a variable in `globals.css` does NOT cause `/adhd:push-design-system` to delete it from Figma — additive policy.
11. `lib/to-dtcg/` and `skills/to-dtcg/` and `skills/export-for-figma/` are gone from the repo. CI no longer runs to-dtcg tests.
12. `/adhd:lint` invoked with no argument lints the entire Figma file: enumerates every page, finds every Component Set / top-level Component / top-level Frame, produces one unified report grouped by page → top-level node.
13. `/adhd:lint <url>` continues to scope to one node and its subtree.
14. `@theme inline` exposure aliases are NOT pushed to Figma as separate variables (no redundant aliases-of-aliases in the Figma graph).
15. When `/adhd:pull-design-system` adds a new semantic variable to code AND the codebase already has an `@theme inline` block, pull also adds the corresponding exposure alias to that block. If the codebase has no exposure layer, pull does not invent one.
16. Exposure-only variables don't participate in conflict prompts — they're code-only metadata, filtered out of the compare engine's output.
