# ADHD Token Sync (v1) — Design Spec

**Date:** 2026-05-09
**Status:** Approved for implementation planning
**Sub-project:** Token sync layer (foundation for component sync, which is a separate spec)

## Purpose

ADHD ("agent-driven harmonious development") is a Claude Code skill + slash command that keeps a Next.js + Tailwind v4 codebase's design tokens in sync with a Figma file. v1 covers the design-system foundation: colors, spacing, typography, radius, shadows. Component sync is a separate, later sub-project.

This repo serves as both the **reference implementation** (a Next.js app demonstrating ADHD on real components) and the **plugin host** (Claude Code marketplace + plugin source live alongside the example).

## Mental model

**Leader-follower with code-or-Figma election.** One side wins on conflict. Configured globally per-repo via `adhd.config.ts`.

**Three architectural layers** in CSS, mirrored in Figma:
1. **Primitives** — raw palette / scale values (`gold-50` through `gold-950`, spacing scale, font sizes, etc.). No modes.
2. **Semantic roles** — meaning-based aliases pointing at primitives (e.g., `brand-surface → gold-100`). Has Light + Dark modes.
3. **Tailwind exposure** — `@theme inline` block that exposes semantic roles to Tailwind's utility generator. Same in every project — generated from the Semantic layer.

**No npm package, no SDK.** ADHD is a Claude Code plugin (skill + slash command). Consumer repos add ONE file: `adhd.config.ts`.

## File structure (this repo serves both roles)

```
adhd/                              # this repo
├── adhd.config.ts                 # consumer config — also drives the demo
├── app/
│   ├── globals.css                # the file ADHD edits
│   └── ...                        # Next.js reference app (the dogfood)
├── plugins/adhd/                  # canonical plugin source
│   ├── plugin.json                # plugin manifest
│   ├── skills/adhd.md             # workflow skill
│   └── commands/
│       └── adhd-sync.md           # slash command
├── .claude-plugin/
│   └── marketplace.json           # makes this repo a marketplace
└── .claude/settings.json          # local-dev: load ./plugins/adhd
```

Other repos install via:
```
/plugin marketplace add <owner>/adhd
/plugin install adhd
```

Then they only need `adhd.config.ts` to use the workflow.

## `adhd.config.ts` schema

Plain object, no imports — the skill validates the shape on read.

```ts
// adhd.config.ts
const config = {
  // Required. Who wins on conflict.
  leader: "code", // or "figma"

  // Required. The Figma file. Always present — we need it whether we push or pull.
  // Object form to reserve room for future per-side options.
  figma: {
    url: "https://www.figma.com/design/abc123/Project-Tokens",
  },

  // Optional. Omit to sync all supported domains.
  // domains: ["colors", "spacing", "typography", "radius", "shadow"],

  // Optional. Path to the CSS entry file to edit.
  // Defaults to "app/globals.css" (Next.js App Router convention).
  // cssEntry: "src/app/globals.css",
};

export default config;
```

**Field validation:**
- `leader` must be `"code"` or `"figma"` (lowercase)
- `figma.url` must match `https://www.figma.com/design/{key}/...`
- `domains` (if present) must be a subset of the supported list (`colors`, `spacing`, `typography`, `radius`, `shadow`)
- `cssEntry` (if present) must point to an existing `.css` file

A bad shape fails validation with a printed expected schema.

## Mandated Figma file structure (v1)

ADHD is opinionated about the Figma file. Files that don't match fail validation. v2 adds escape-hatch overrides via `adhd.config.ts`.

### Required Variable Collections

**`Primitives`** — no modes. Raw palette / scale values.

Variables follow these naming patterns (kebab-case + slash hierarchy):

| Domain | Pattern | Example |
|---|---|---|
| Colors | `colors/{palette}/{shade}` | `colors/gold/100`, `colors/zinc/950` |
| Spacing | `spacing/{n}` | `spacing/4` |
| Radius | `radius/{name}` | `radius/md` |
| Shadow | `shadow/{name}` | `shadow/lg` |
| Typography | `font/{family-name}`, `text/{size}`, `font-weight/{name}`, `leading/{name}` | `font/sans`, `text/base`, `font-weight/medium`, `leading/tight` |

**Note on typography pattern:** Figma names use the segments that map cleanly to Tailwind v4's CSS-variable conventions (`--font-sans`, `--text-base`, `--font-weight-medium`, `--leading-tight`). The slashes in Figma become dashes in CSS (`text/base` → `--text-base`). This deviates slightly from a single-prefix-per-domain convention because Tailwind v4 uses different prefixes for different font properties.

**`Semantic`** — exactly two modes, named `Light` and `Dark` (case-sensitive). Role tokens, all values are aliases to Primitives variables.

Variables follow this naming pattern (slash hierarchy with project-defined role vocabulary):

| Pattern | Example role names |
|---|---|
| `colors/{group}/{role}` | `colors/background`, `colors/brand/surface`, `colors/brand/on-surface`, `colors/brand/surface-raised` |

**Note on naming conventions:** ADHD does not mandate the semantic role vocabulary. `surface`/`on-surface` (Material), `bg`/`fg`, `main`/`text` (Bootstrap-style) — any kebab-case noun structure works. ADHD only requires kebab-case + slash hierarchy and that semantic values are aliases to primitives.

### Validation rules

- Both collections (`Primitives`, `Semantic`) must exist
- `Semantic` must have exactly the modes `Light` and `Dark`
- `Primitives` variables must NOT have modes (raw values only)
- `Semantic` variables must alias a Primitives variable (no raw values, no aliases to other semantic variables)
- All variable names follow kebab-case + slash hierarchy with no spaces or special characters

## CSS output — `globals.css` (no separate file, no marker comments)

ADHD edits `globals.css` directly. It identifies *its* variables by name pattern + the canonical block where they live. User-written CSS (anything that doesn't match an ADHD pattern) is left untouched.

**Canonical block structure:**

```css
@import "tailwindcss";

/* Layer 1: Primitives */
@theme {
  --color-gold-50: #fdf9eb;
  /* ...all primitive variables across synced domains... */
  --spacing-1: 0.25rem;
  --font-sans: "Geist Sans", system-ui;
  --text-base: 1rem;
  --font-weight-medium: 500;
  --leading-tight: 1.25;
  --radius-md: 0.5rem;
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  /* ... */
}

/* Layer 2: Semantic roles — Light values */
:root {
  --brand-surface: var(--color-gold-100);
  /* ... */
}

/* Layer 2b: Semantic roles — Dark overrides */
@media (prefers-color-scheme: dark) {
  :root {
    --brand-surface: var(--color-gold-900);
    /* ... */
  }
}

/* Layer 3: Tailwind exposure */
@theme inline {
  --color-brand-surface: var(--brand-surface);
  /* ... */
}

/* User-owned content from here down — ADHD never touches */
body { ... }
@keyframes shimmer { ... }
```

**ADHD edits in place by:**
- Parsing `globals.css` with targeted regex against the canonical block structure
- For each ADHD-managed variable name, updating the value in the right block
- Adding new variables to the appropriate block; creating the block if missing
- Never modifying CSS that doesn't match an ADHD name pattern

**ADHD-managed name patterns:**
- Primitives: `--color-{palette}-{shade}`, `--spacing-{n}`, `--radius-{name}`, `--shadow-{name}`, `--font-{family-name}`, `--text-{size-name}`, `--font-weight-{name}`, `--leading-{name}`
- Semantic roles (in `:root` and `@media dark`): `--{role-path-with-dashes}` (e.g., `--brand-surface` from `colors/brand/surface`)
- Tailwind exposure (in `@theme inline`): `--color-{role-path-with-dashes}` aliasing the corresponding semantic role

**Drift on user content:** if a user writes a variable that accidentally matches an ADHD name pattern (e.g., user-written `--color-gold-100`), validation surfaces this as a warning. The user must rename their variable or accept that ADHD will overwrite it on next sync.

## Token name mapping (Figma ↔ CSS)

| Figma name | CSS variable | Notes |
|---|---|---|
| `colors/gold/100` (Primitives) | `--color-gold-100` | In `@theme` |
| `spacing/4` (Primitives) | `--spacing-4` | In `@theme` |
| `radius/md` (Primitives) | `--radius-md` | In `@theme` |
| `shadow/md` (Primitives) | `--shadow-md` | In `@theme` |
| `font/sans` (Primitives) | `--font-sans` | In `@theme` |
| `text/base` (Primitives) | `--text-base` | In `@theme` |
| `font-weight/medium` (Primitives) | `--font-weight-medium` | In `@theme` |
| `leading/tight` (Primitives) | `--leading-tight` | In `@theme` |
| `colors/brand/surface` (Semantic) | `--brand-surface` (in `:root` and `@media dark`) AND `--color-brand-surface: var(--brand-surface)` (in `@theme inline`) | Three writes per Semantic variable — Light value, Dark value, Tailwind exposure |

The Tailwind utility names that result (`bg-gold-100`, `text-brand-surface`, `p-4`, etc.) are derived by Tailwind v4 from the `--color-*`, `--spacing-*`, `--font-*` prefixes. ADHD does not generate utility class names — Tailwind does that automatically once the variables are present.

## Slash command — `/adhd-sync`

Single command, single flag.

### Modes

- `/adhd-sync` — full workflow: validate → diff → confirm → apply → verify → report
- `/adhd-sync --dry-run` — read-only: validate → diff → display → stop
- `/adhd-sync --domains colors,spacing` — limit to specific domains; combines with `--dry-run`

### Workflow

1. **Validate**
   - `adhd.config.ts` parses cleanly and matches the schema
   - `globals.css` exists at the resolved path (default `app/globals.css`, or `cssEntry` from config)
   - Figma file is reachable; URL is well-formed; permissions are sufficient (read for `leader=figma`; read+write for `leader=code`)
   - Figma file matches mandated structure (Primitives + Semantic collections, mode names, naming conventions, alias rules)
   - Failure here stops the run with actionable fix-up guidance (which collection is missing, which variable is malformed, etc.)

2. **Read both sides**
   - Code side: parse current values from `globals.css`
   - Figma side: query variables from `Primitives` + `Semantic` collections via Figma MCP

3. **Compute diff per domain**
   - Each domain produces three lists: added (in leader, not in follower), changed (in both, different values), removed (in follower, not in leader)
   - Mode-aware: differences in only Light or only Dark are surfaced separately

4. **Display diff**
   - Summary table first: one row per domain showing counts (e.g., `colors: +3 / ~2 / -0`)
   - For each domain with non-zero diff, expand into a detailed table showing per-token changes
   - Color-coded: added green, changed yellow, removed red

5. **Confirm** (skipped on `--dry-run`)
   - Single y/n prompt for the whole diff
   - For tokens that would be **removed** from the follower: default to "skip" — user must explicitly confirm to remove (orphans are usually intentional)

6. **Apply** (skipped on `--dry-run`)
   - Process domain-by-domain so user sees clear progress
   - If `leader = figma`: edit `globals.css` in place — update values, insert new variables into the right block, leave user-written content untouched
   - If `leader = code`: write changes to Figma via MCP — update variable values, create new variables in the right collection
   - Each domain commits atomically on the code side (one git commit per domain) so partial failures are recoverable

7. **Verify** (skipped on `--dry-run`)
   - Re-read both sides; assert they match for synced domains
   - If verification fails, surface the post-apply diff and don't claim success

8. **Report**
   - Summary of what changed per domain
   - Git commit references on the code side
   - Any warnings (orphans skipped, user-content collisions, etc.)

### Diff semantics — exhaustive table

| Case | Code-leader → push to Figma | Figma-leader → pull to code |
|---|---|---|
| In leader, missing in follower | Add variable to Figma in the right collection | Add variable to `globals.css` in the right block |
| In both, values differ | Update Figma to leader value | Update `globals.css` to leader value |
| In follower, missing in leader | **Warn**. Default skip. User must explicitly confirm to remove. | Same |
| Mode mismatch (Light value differs but Dark matches, or vice versa) | Update only the differing mode | Update only the differing mode block |
| Token has invalid alias chain in Figma (alias → nonexistent target) | Validation failure (in step 1) | Same |
| User-written CSS variable matches an ADHD name pattern | Validation warning; user must rename or accept overwrite | Same |

## Authentication

- ADHD does not manage credentials
- Figma MCP handles its own OAuth flow
- If MCP isn't authenticated, validation fails with "run MCP auth flow" guidance

## Scaffolding new projects

For consumers starting from scratch (no existing tokens on either side), the first `/adhd-sync` will show a 100% additive diff. The user confirms, and ADHD populates the follower. There is no special "first-run" mode — the confirm gate is the safety mechanism in all cases.

If the Figma file lacks the required collections (Primitives, Semantic), validation fails. Future enhancement: an `--init-figma` flag that scaffolds empty collections in Figma when leader is code, before the first sync.

## Out of scope (v1)

- **Component sync** — the next sub-project (Figma components → React components)
- **Token deletion** — warn-only, never auto-delete (user can manually remove from leader, then sync)
- **Multiple Figma files per repo** — single source of truth per repo
- **Custom mode names beyond `Light` / `Dark`** — high-contrast, multi-brand themes deferred to v2
- **Multiple themes / brand families** — would require a `themes` axis on Semantic; defer
- **Motion tokens** — durations, easing curves; defer to v2
- **Gradient tokens, color filters, blend modes** — defer
- **Platform-specific tokens** (iOS-only, Android-only)
- **Conflict resolution UI** — leader always wins; user promotes loser-side values manually if desired
- **CI integration** — manual sync via slash command only in v1
- **Token diffing across git history** — `git log` / `git diff` is the right tool
- **Auto-init of Figma collections** — `--init-figma` is a v2 enhancement
- **Per-component token scoping** — all tokens are global in v1
- **Sync via file watcher / live mode** — on-demand only

## Acceptance criteria

1. A consumer repo can install the ADHD plugin and add `adhd.config.ts` (with `leader` and `figma.url`) and run `/adhd-sync` successfully.
2. `/adhd-sync --dry-run` displays a per-domain summary table and (where non-zero) per-token detail tables, then exits without modifying anything.
3. `/adhd-sync` produces the same display, prompts for confirmation, then applies leader-wins and verifies on success.
4. With `leader = "figma"`, `globals.css` is updated in place — only ADHD-managed variables are touched, user-written CSS is preserved.
5. With `leader = "code"`, Figma variables are updated/created via MCP — user-written variables in non-ADHD collections are preserved.
6. Validation fails with actionable guidance when the Figma file's structure or naming is non-compliant.
7. Mode-aware diffing: a Semantic variable whose Light value matches but Dark differs is surfaced as a Dark-only change, and only the dark block is updated on apply.
8. Removed-from-leader tokens default to "skip" and require explicit confirmation to apply removal on the follower.
9. The reference implementation repo (this one) successfully syncs its own tokens via the plugin (the dogfood test).
10. The plugin can be installed by another repo via `/plugin marketplace add <owner>/adhd && /plugin install adhd`.

## Open architectural decisions (deferred to plan / implementation)

- Exact regex patterns for parsing `globals.css` blocks (will iterate during implementation)
- Specific Figma MCP tool sequencing (e.g., which `mcp__figma__*` calls are needed in which order — depends on tool capabilities, validated during implementation)
- Slash command file syntax for Claude Code (matches Claude Code's command schema, finalized during plan)
- Whether to use `prettier` to format the resulting `globals.css` after edits (probably yes — TBD in plan)
