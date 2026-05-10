# /adhd:check and /adhd:sync — Frame-Scoped Design Validation and Token Sync

**Goal:** Add `/adhd:check` (read-only) and refactor `/adhd:sync` (refactored from existing) to operate on a **single Figma frame, component, component set, or page**. Both validate design tokens and frame structure; `/adhd:sync` additionally writes Figma's variable values into `globals.css`. The output format is paste-ready for sharing with designers via Slack, Figma comments, or GitHub issues.

**Architectural premise:** the Figma MCP cannot enumerate all variables in a file — it only returns variables *referenced by* a queried node and its descendants. Rather than fight that limitation, we lean into it: design validation is now scoped to "the component you're about to ship," which is the natural unit of design-system work anyway.

**Precondition:** `/adhd:export-for-figma` is renamed to `/adhd:seed` in a small standalone PR before this spec's implementation begins. This spec assumes the new name throughout.

---

## Architecture

```
/adhd:config            setup wizard                  (shipped)
/adhd:seed              code → DTCG JSON for Figma    (rename of export-for-figma)
/adhd:check             frame/page → violation report (new, read-only)
/adhd:sync              frame/page → globals.css      (refactored, frame-scoped)
/adhd:to-dtcg           model-invocable converter     (shipped)
```

### Shared pipeline

Both commands run the same pipeline; the only difference is the terminal action:

```
input resolution         MCP fetch              local theme dump        diff engine
─────────────────        ────────────────       ─────────────────       ─────────────
current selection        get_metadata           parse globals.css       categorize:
  OR                  →  get_variable_defs   →  → { token: value }   →   - missing
node-id from URL         get_design_context                                - same
                                                                           - conflict
                                                                          + structure
                                                                            violations
```

The pipeline is implemented in `plugins/adhd/lib/check-engine/` and consumed by both skills. The diff engine and report formatter share one source of truth.

---

## Input handling

### Resolving the target node

```
1. Did user pass a Figma URL as argument?
   YES → parse URL → extract { fileKey, nodeId }
   NO  → use MCP's current-selection default (no nodeId arg)

2. Validate fileKey against adhd.config.ts → figma.url
   - If mismatch: abort with "URL points at file <X>, but adhd.config.ts is configured for file <Y>"

3. Call MCP get_metadata(nodeId) to confirm the node exists and learn its type
   - "FRAME" / "COMPONENT" / "COMPONENT_SET" / "CANVAS" (page) — all valid
   - Anything else (TEXT, RECTANGLE, etc.) — abort with "select a frame, component, or page"
```

### Frame vs page: same logic, different scope

`get_variable_defs` and `get_design_context` walk the entire subtree of the target node:

- a single **frame** → returns vars/structure for that frame
- a **component** → returns one variant
- a **component set** → returns all variants
- a **page** (CANVAS) → returns everything on the page

The check/sync logic is identical regardless of node type — we always operate on whatever subtree was returned.

### MCP calls per run

| Call | Returns | Used for |
|---|---|---|
| `get_metadata(nodeId)` | Node type, name, basic shape | Entry-point validation, top-level node info |
| `get_variable_defs(nodeId)` | List of variables referenced in the subtree, with their resolved values | Variable check + sync write source |
| `get_design_context(nodeId)` | Layout structure of the subtree (auto-layout flags, layer hierarchy, instance status, naming) | Structure check |

### Size handling

Large pages can exceed token budgets. v1 strategy: do the call and trust the MCP server. If the response is truncated (detected via response shape), surface a warning: "MCP returned a partial response — consider running on a smaller scope (a frame within the page)." We don't auto-chunk in v1; the workaround (target a smaller frame) is one keystroke for the user.

### Failure modes

| Case | Behavior |
|---|---|
| Nothing selected, no URL | "Pass a Figma URL or select something in Figma desktop." |
| URL points at wrong file | File-key mismatch error |
| Node doesn't exist | MCP error → "Node not found in <fileKey>." |
| Node is wrong type | "Select a frame, component, or page (got: TEXT)." |
| MCP unreachable | "Figma MCP not configured. Run /adhd:config to set up." |

---

## Variable check algorithm

### Step 1 — Pull frame variables from MCP

`get_variable_defs(nodeId)` returns variables in collection-prefixed form:

```jsonc
{
  "Primitives/color/brand/600": "#5e3aee",
  "Semantic/color/surface/elevated": {
    "Light": "#ffffff",
    "Dark":  "#1a1a1a"
  },
  "Primitives/space/2xl": "32px",
  ...
}
```

### Step 2 — Parse local theme

Walk `globals.css` (path from `adhd.config.ts → cssEntry`, with the same auto-detect fallback `/adhd:config` already uses) and extract:

```
@theme { ... }                         → primitives  (no modes)
@theme inline { ... }                  → tailwind exposure / aliases
:root { ... }                          → semantic Light values
:root[data-theme="dark"] { ... }       → semantic Dark values
```

The existing `lib/to-dtcg/` parser is the source; the new `lib/check-engine/` consumes it and emits a comparable map.

### Step 3 — Token-name normalization

Figma `Primitives/color/brand/600` ↔ CSS `--color-brand-600`. Translation: drop collection prefix (structural metadata, not part of token identity), `/` becomes `-`, lowercase. The existing `to-dtcg` round-trip logic is lifted into a shared `normalizeName(figmaPath)` helper.

### Step 4 — Token-value normalization

| Domain | Normalize to |
|---|---|
| color | lowercase 6-digit hex (or 8-digit if alpha) |
| spacing / radius | px (convert rem → px assuming 16px root) |
| typography | px for size; unitless ratio for line-height |
| shadow | DTCG shadow object (offset/blur/spread/color), then deep-equal |

### Step 5 — Categorize

For each variable in the Figma response:

```
local has it, value matches      → "same"      (no-op)
local has it, value differs      → "conflict"  (sync prompts; check reports)
local missing                    → "missing"   (sync auto-writes; check reports)
```

### Step 6 — Light/Dark handling

Semantic tokens have two values (Light / Dark). Each mode is categorized independently:
- A token can be `same` in Light but `conflict` in Dark — both branches reported.
- Conflict prompts for Light/Dark-bifurcated tokens show both values together so the user sees the full picture before deciding.

### Output

```ts
{ token: string, status: "missing" | "conflict", figma: Value, local: Value | null, mode?: "light" | "dark" }[]
```

This feeds directly into the report formatter and `/adhd:sync`'s prompt loop.

---

## Structure check rules

The MCP `get_design_context` response gives us the layered structure (per-node: type, name, layout mode, fills/strokes/effects, instance status, etc.). From that we evaluate:

### Error severity (block /adhd:sync unless user explicitly bypasses; cause /adhd:check to exit non-zero)

| ID | Rule | What it detects |
|---|---|---|
| `STRUCT001` | Auto-layout required | A frame with children doesn't use auto-layout (`layoutMode: "NONE"`). Children are absolutely positioned. |
| `STRUCT002` | Spacing uses variables | Padding or gap on an auto-layout frame is a raw px value, not a variable reference. |
| `STRUCT003` | Colors use variables | A fill, stroke, or effect color is a raw hex, not a variable reference. |
| `STRUCT004` | Typography uses variables/styles | Text uses raw font-size, line-height, or weight (not a text style or typography variable). |
| `STRUCT005` | Effects use variables/styles | A shadow/blur uses raw values (not a shadow variable or effect style). |
| `STRUCT010` | Variant properties declared | A Component Set has child Components but no variant properties (`variantProperties` is empty on every child). Indicates a "Component Set as folder" anti-pattern; without declared properties, code-gen can't synthesize a prop signature. |

### Warning severity (reported but don't block sync or fail check)

| ID | Rule | What it detects |
|---|---|---|
| `STRUCT006` | No detached instances | Layer was once an instance but has been detached from its master. |
| `STRUCT007` | Component variants in a Component Set | Sibling component-shaped frames with shared name prefixes (`Button/Primary`, `Button/Secondary`) that aren't wrapped in a Component Set. |
| `STRUCT008` | Meaningful layer names | Layer name matches Figma's auto-generated patterns (`Frame 1234`, `Group 47`, `Rectangle 5`). |
| `STRUCT009` | Naming convention | Component name, variant property name, or variant property value doesn't match the configured `naming` convention (default `kebab-case`). |

### Variable issues — separate ID space

| ID | Rule | What it detects |
|---|---|---|
| `VAR001` | Unresolvable variable reference | MCP returned a variable Figma can't resolve (broken alias chain). |

### Rule output shape

```ts
{
  rule: "STRUCT003",
  severity: "error" | "warning",
  nodeId: "123:456",
  nodePath: "Page 1 > Card / Hover > Header > Avatar Group",
  message: "Fill color #5e3aee is not a variable. Replace with a color variable.",
  deepLink: "https://figma.com/design/<file>?node-id=123-456"
}
```

The `nodePath` (human-readable breadcrumb) and `deepLink` (clickable URL) make the report actionable when shared — designers can navigate to the offending node directly.

### Out of scope for v1 (named here so we don't drift)

- Color contrast / accessibility
- Sizing-mode intentionality (Hug/Fill/Fixed)
- Cross-variant completeness (verifying all `size × state` combinations exist)
- Constraint validation (resize behavior)
- Per-rule severity overrides (beyond the `naming: false` toggle)
- Fix-it mutations to Figma (write path stays one-way, Figma → code)

---

## Sync write path

```
1. Run the full check pipeline (variables + structure)
2. Print structure violations (if any)
   ├── Structure errors present?
   │     prompt: "N structure errors found. Proceed anyway? [y/N]"
   │     "N" → abort
   │     "y" → continue (errors stay in the report file regardless)
   └── Warnings only / none → continue silently
3. Print variable diff summary: "X missing, Y conflicts, Z unchanged"
4. Apply missing variables automatically (no prompt — there's nothing to decide)
   - one consolidated message: "+ Adding 3 missing variables: color/brand/600, space/2xl, radius/pill"
5. For each conflict, prompt:
   color/surface/elevated  (Light)
     local:  #f5f5f5
     figma:  #ffffff
   keep / overwrite / [a]ll-figma / [k]eep-all? [k/o/a/A]
6. Apply chosen writes via lib/to-dtcg/ → globals.css
7. Per-domain commit: "ADHD sync: <domain> (N changes)"
   (existing pattern from current /adhd:sync; one commit per domain edited)
8. Write report file (adhd-check-report.md) with what was applied + what was skipped
```

The `[a]ll-figma` / `[k]eep-all` shortcuts let the user batch-resolve conflicts when they know the answer is uniform. Saves typing through 30 prompts when the answer is consistent.

### Failure mid-write

Writes go through the existing `lib/to-dtcg/` writer. If a write fails partway, the per-domain commit pattern bounds the blast radius — at most one domain is partially applied, and `git diff` shows exactly what landed. Surface the error and let the user `git checkout` to revert. No custom rollback machinery.

---

## Report output

Single markdown file at `adhd-check-report.md` (gitignored), also echoed to the terminal. Same content for both consumers. Designed to be paste-ready into a Figma comment, Slack message, or GitHub issue.

```markdown
# ADHD check report
**Target:** Page 1 / Card / All variants  ([open in Figma](https://figma.com/design/<file>?node-id=123-456))
**Run at:** 2026-05-10 14:23 UTC
**Result:** 7 errors, 3 warnings

## Variable issues (4)

### Missing locally (2)
- `color/brand/600` → `#5e3aee` ([open](deep-link))
- `space/2xl` → `32px` ([open](deep-link))

### Conflicts (2)
- `color/surface/elevated` (Light)
  - local: `#f5f5f5`
  - figma: `#ffffff`
  - [open in Figma](deep-link)
- `radius/pill` — local: `9999px`, figma: `999px` — [open](deep-link)

## Structure issues (6)

### Errors (4)
- **STRUCT001** — Auto-layout required
  Page 1 > Card / Hover > Container — [open](deep-link)
- **STRUCT003** — Colors use variables
  Page 1 > Card / Hover > Header > Avatar Group — fill `#5e3aee` is not a variable. [open](deep-link)
- ...

### Warnings (2)
- **STRUCT008** — Meaningful layer names
  Page 1 > Card / Hover > Frame 47 — auto-named. [open](deep-link)
- ...
```

Deep-links are real Figma URLs (`https://figma.com/design/<fileKey>?node-id=<nodeId>`). Clicking one in a Figma comment jumps to the offending node.

### Exit codes

- `/adhd:check` — `0` if no errors (warnings allowed), `1` otherwise.
- `/adhd:sync` — `0` on user-confirmed completion, `1` on user-aborted.

### Why not auto-post comments to Figma

The Figma MCP doesn't expose comment write APIs. Posting comments would require Figma's REST API and a Figma PAT, which we explicitly removed in Plan 2. Paste-ready markdown is the v1 substitute. We can revisit auto-posting in a future spec if the manual-paste workflow proves insufficient.

---

## Config additions

One new optional field in `adhd.config.ts`:

```ts
const config = {
  figma: { url: "https://figma.com/design/..." },
  // existing optional: domains, cssEntry
  naming: "kebab-case",  // NEW: "kebab-case" | "PascalCase" | "camelCase" | false; default "kebab-case"
};
```

The `naming` field controls only **STRUCT009** (naming convention check). `false` disables that one rule entirely. All other structure rules are non-configurable in v1 — if usage shows we need per-rule disable knobs, we can add a `disabledRules: ["STRUCT008"]` field in v2.

`/adhd:config` gets one new question ("What naming convention does your Figma file use?") with the four options. Defaults to `kebab-case` if user just hits enter.

---

## Edge cases

| Case | Behavior |
|---|---|
| MCP returns empty variable list | "Frame doesn't reference any design tokens — is this intentional?" — non-fatal, continues with structure check only |
| MCP returns a broken alias variable | Reported as `VAR001 — Unresolvable variable reference` (error) |
| `globals.css` doesn't exist or fails to parse | Hard error — same handling as existing `/adhd:sync` |
| User passes a node-id from a different file than `adhd.config.ts` | File-key mismatch error |
| Network/MCP unreachable | "Figma MCP unreachable. Check that Figma desktop is running and run /adhd:config to verify setup." |
| Page contains 100+ variants (large response) | Trust MCP; surface truncation warning if response indicates partial data |
| Same variable referenced from multiple sites in the subtree | Deduped by name — one violation per unique variable, not per use site |

---

## Out of scope for v1

- `--apply` non-interactive flag for `/adhd:sync` (relies on prompts; v2 if CI use emerges)
- Auto-posting violations as Figma comments (requires PAT, deferred)
- Fix-it mutations to Figma (write path stays one-way, Figma → code)
- Per-rule severity overrides (beyond the `naming: false` toggle)
- Color contrast / accessibility checks
- Sizing-mode intentionality
- Cross-variant completeness
- Constraint validation
- React component code generation (the eventual goal that this spec is the precursor for)

---

## Acceptance criteria

1. `/adhd:check` invoked with a Figma URL pointing at a frame produces a markdown report listing all variable and structure violations, with deep-links per node.
2. `/adhd:check` invoked with no argument uses the current Figma selection.
3. `/adhd:check` exits `0` when only warnings are present, `1` when any errors are present.
4. `/adhd:sync` shows the full violation list, prompts to proceed if structure errors exist, then runs the variable diff.
5. `/adhd:sync` auto-writes missing variables and per-conflict prompts (with `[a]ll-figma` / `[k]eep-all` batch shortcuts).
6. `/adhd:sync` commits one commit per modified domain.
7. Both commands write `adhd-check-report.md` (gitignored) containing the paste-ready markdown.
8. `naming: false` in `adhd.config.ts` disables STRUCT009.
9. File-key mismatch between argument URL and configured `figma.url` is rejected before any MCP call.
10. Empty variable list, broken alias, missing `globals.css`, MCP unreachable — all handled with explicit messages from the table above.
