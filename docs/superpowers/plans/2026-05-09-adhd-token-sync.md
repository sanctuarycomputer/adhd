# ADHD Token Sync v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin named `adhd` that contributes one skill (invoked as `/adhd:sync`) which syncs design tokens between this Tailwind v4 codebase's `globals.css` and a configured Figma file.

**Architecture:** This repo doubles as a Claude Code marketplace AND the reference implementation (Next.js + Tailwind v4 demo). The plugin lives at `plugins/adhd/`. Skill is invoked via `/adhd:sync` and reads `adhd.config.ts` at the repo root for leader election + Figma file URL. The workflow encoded in `SKILL.md` is the actual product — the agent executes the procedure when invoked. No standalone CLI; no npm package.

**Tech Stack:** Claude Code (plugins, skills, MCP), Tailwind v4 (`@theme`), Figma MCP (`mcp__figma__*` tools), Next.js (host app).

**Reference:** `docs/superpowers/specs/2026-05-09-adhd-token-sync-design.md` — the spec is the authoritative source for workflow semantics.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `plugins/adhd/.claude-plugin/plugin.json` | Create | Plugin manifest. Names plugin `adhd`. |
| `.claude-plugin/marketplace.json` | Create | Marketplace manifest at repo root declaring the adhd plugin. |
| `plugins/adhd/skills/sync/SKILL.md` | Create | The workflow skill. Invoked as `/adhd:sync`. Contains full procedure. |
| `adhd.config.ts` | Create | Consumer config at repo root. Used by skill to know leader + Figma URL. |

No test framework in this repo; verification is via type-check + manual dogfood (`/adhd:sync --dry-run` after `/reload-plugins`).

**Key plugin format facts** (from Claude Code docs research):
- Plugin manifest path: `<plugin>/.claude-plugin/plugin.json` (NOT `plugin.json` at the plugin root).
- Marketplace manifest path: `.claude-plugin/marketplace.json` at the marketplace root (this repo's root).
- Slash commands ARE skills with `disable-model-invocation: true`. Invoked as `/<plugin-name>:<skill-name>` — namespaced.
- Skill location inside plugin: `skills/<skill-name>/SKILL.md` (capital `SKILL.md`, in a directory).
- Local dev loading: `claude --plugin-dir ./plugins/adhd` for one-off; or marketplace-based loading via `extraKnownMarketplaces` in settings.json (out of scope for this plan — we'll document the local invocation).

---

## Task 1: Plugin and marketplace scaffolding

**Files:**
- Create: `plugins/adhd/.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create directories**

```bash
mkdir -p plugins/adhd/.claude-plugin plugins/adhd/skills/sync .claude-plugin
```

- [ ] **Step 2: Write the plugin manifest**

Create `plugins/adhd/.claude-plugin/plugin.json`:

```json
{
  "name": "adhd",
  "description": "Agent-driven harmonious development: sync design tokens between Tailwind v4 and a Figma file.",
  "version": "0.1.0",
  "author": {
    "name": "Hugh Francis"
  }
}
```

- [ ] **Step 3: Write the marketplace manifest**

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "adhd-reference",
  "owner": {
    "name": "Hugh Francis"
  },
  "plugins": [
    {
      "name": "adhd",
      "source": "./plugins/adhd",
      "description": "Sync design tokens between Tailwind v4 and Figma."
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "Add adhd plugin and marketplace manifests"
```

---

## Task 2: Consumer config (`adhd.config.ts`)

Create the config file at the repo root. The skill reads this file to know which Figma file to sync with and who wins on conflict.

**Files:**
- Create: `adhd.config.ts`

- [ ] **Step 1: Write the config**

Create `adhd.config.ts` at the repo root:

```ts
// adhd.config.ts — read by the ADHD skill (/adhd:sync).
// No npm package or import required; the skill validates the shape on read.

const config = {
  // Required. "code" = this repo is canonical (push to Figma).
  //           "figma" = the Figma file is canonical (pull to code).
  leader: "code" as const,

  // Required. The Figma file. Always present.
  // Replace REPLACE_WITH_FIGMA_KEY with your file's key.
  figma: {
    url: "https://www.figma.com/design/REPLACE_WITH_FIGMA_KEY/ADHD-Reference",
  },

  // Optional. Omit to sync all supported domains.
  // domains: ["colors", "spacing", "typography", "radius", "shadow"],

  // Optional. Defaults to "app/globals.css" (Next.js App Router convention).
  // cssEntry: "src/app/globals.css",
};

export default config;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (`as const` on `leader` ensures the literal type is preserved.)

- [ ] **Step 3: Commit**

```bash
git add adhd.config.ts
git commit -m "Add adhd.config.ts with placeholder Figma URL"
```

---

## Task 3: ADHD sync skill — frontmatter + structural skeleton

The skill is the substantive deliverable. To keep this manageable, we split it across two tasks: Task 3 lays the frontmatter + section skeleton; Task 4 fills in the workflow procedure for each phase.

**Files:**
- Create: `plugins/adhd/skills/sync/SKILL.md`

- [ ] **Step 1: Write the skill scaffold**

Create `plugins/adhd/skills/sync/SKILL.md` with this content (frontmatter + section headers only — phase content lands in Task 4):

```markdown
---
description: Sync design tokens between this Tailwind v4 codebase and the configured Figma file. Reads adhd.config.ts at the repo root. Supports --dry-run (read-only diff) and --domains <comma,separated> (limit to specific domains: colors, spacing, typography, radius, shadow).
disable-model-invocation: true
argument-hint: "[--dry-run] [--domains <comma,separated>]"
allowed-tools: Read Edit Write Bash mcp__figma__get_metadata mcp__figma__get_variable_defs mcp__figma__get_design_context
---

# ADHD Sync

You are running the ADHD design-token sync workflow. ADHD ("agent-driven harmonious development") keeps design tokens synchronized between this Tailwind v4 codebase (`globals.css`) and a Figma file via a leader-follower model defined in `adhd.config.ts`.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-token-sync-design.md` — read it if you need detail beyond what this skill provides.

## Argument parsing

Parse `$ARGUMENTS`:
- `--dry-run` flag (boolean) — if present, run phases 1–4 only (validate → read → diff → display) and stop without applying changes.
- `--domains <list>` flag — optional comma-separated subset of supported domains. If absent, use all domains from the config (or all five supported domains if the config doesn't restrict).

## Phase 1: Validate

(filled in Task 4)

## Phase 2: Read code-side tokens

(filled in Task 4)

## Phase 3: Read Figma tokens

(filled in Task 4)

## Phase 4: Compute and display diff

(filled in Task 4)

## Phase 5: Confirm (skip if --dry-run)

(filled in Task 4)

## Phase 6: Apply (skip if --dry-run)

(filled in Task 4)

## Phase 7: Verify (skip if --dry-run)

(filled in Task 4)

## Phase 8: Report

(filled in Task 4)

## Reference: Mandated Figma structure

(filled in Task 4)

## Reference: CSS variable name mappings

(filled in Task 4)

## Reference: Common errors and fix-up guidance

(filled in Task 4)
```

- [ ] **Step 2: Reload plugins to confirm scaffold loads**

In Claude Code:
```
/reload-plugins
```

Confirm the plugin and skill are detected (look for "adhd" in the plugin list and `/adhd:sync` in the slash command list). If `/adhd:sync` does not appear, troubleshoot before proceeding (most likely cause: a typo in plugin.json or marketplace.json paths).

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/sync/SKILL.md
git commit -m "Add /adhd:sync skill scaffold (frontmatter + section headers)"
```

---

## Task 4: Fill in the workflow phases

Replace each `(filled in Task 4)` placeholder in `SKILL.md` with the procedure for that phase. The implementer should read the spec (`docs/superpowers/specs/2026-05-09-adhd-token-sync-design.md`) and translate each section into agent-actionable instructions.

**File:** Modify `plugins/adhd/skills/sync/SKILL.md`

The instructions for each phase are detailed below — write them verbatim into the corresponding section of `SKILL.md`.

- [ ] **Step 1: Phase 1 — Validate**

Replace `## Phase 1: Validate\n\n(filled in Task 4)` with:

```markdown
## Phase 1: Validate

Stop the workflow on any failure here. Print the failure message and the relevant fix-up guidance from the "Common errors" section at the bottom of this skill.

### 1.1 Read and validate `adhd.config.ts`

- Use the `Read` tool on `adhd.config.ts` at the repo root.
- If the file does not exist, abort with: `Cannot find adhd.config.ts at the repo root. Create it using the schema in the ADHD spec.` and print the schema example.
- Parse the default-exported object. Since this is a plain TypeScript literal (no imports), extract the fields with targeted regex (look for `leader:`, `figma:`, `domains:`, `cssEntry:`).
- Validate:
  - `leader` is exactly `"code"` or `"figma"`.
  - `figma.url` matches `^https://www\.figma\.com/design/[^/]+/`.
  - `domains` (if present) is an array containing only `"colors"`, `"spacing"`, `"typography"`, `"radius"`, `"shadow"`.
  - `cssEntry` (if present) points to a file that exists.
- On any field mismatch, print the expected schema and the offending value, then stop.

### 1.2 Resolve and check `globals.css`

- Resolve CSS path: `config.cssEntry ?? "app/globals.css"`.
- If the resolved file does not exist, abort with: `Cannot find CSS entry at <path>. Set cssEntry in adhd.config.ts if your CSS file lives elsewhere.`
- Read the file's first ~40 lines and confirm `@import "tailwindcss"` is present. If not, warn (don't abort) and continue.

### 1.3 Check Figma reachability

- Extract the file key from `config.figma.url`: it is the path segment immediately after `/design/`.
- Call `mcp__figma__get_metadata` with the file key.
- If the call fails with an authentication error, abort with: `Figma MCP is not authenticated. Run the Figma MCP auth flow and retry.`
- If the call returns 404 / not found, abort with: `Cannot reach the Figma file at <url>. Verify the URL and your access permissions.`

### 1.4 Validate Figma file structure

- Call `mcp__figma__get_variable_defs` (or the equivalent variable-listing tool) on the file.
- Confirm:
  - A collection named exactly `Primitives` exists. It must have either no modes or exactly one mode (Figma always has at least one mode per collection; treat the single-mode case as "no modes").
  - A collection named exactly `Semantic` exists with exactly two modes named `Light` and `Dark` (case-sensitive).
  - Every variable name uses kebab-case segments and slash hierarchy (regex check: `^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$`).
  - `Primitives` variables have raw values (color, number, string) — not aliases.
  - `Semantic` variables alias to a `Primitives` variable in BOTH modes — not raw values, not aliases to other semantic variables.
- On any failure, print the specific issue (e.g., `Semantic collection has 3 modes (Light, Dark, HighContrast); v1 supports exactly Light and Dark`) and stop.

### 1.5 Resolve domain selection

- If the `--domains` argument was passed, parse it and use that subset.
- Else if `config.domains` is present, use it.
- Else, use all five supported domains.
- If the user-passed `--domains` includes anything not in `config.domains` (when set), warn the user and use the intersection.
```

- [ ] **Step 2: Phase 2 — Read code-side tokens**

Replace `## Phase 2: Read code-side tokens\n\n(filled in Task 4)` with:

```markdown
## Phase 2: Read code-side tokens

Read the resolved `globals.css` file in full. Parse the canonical block structure to extract ADHD-managed variables.

### 2.1 Extract Primitives

Look for the `@theme {` block (NOT `@theme inline {`). Within it, extract every variable matching ADHD-managed name patterns:
- `--color-{palette}-{shade}` → colors primitive
- `--spacing-{n}` → spacing primitive
- `--radius-{name}` → radius primitive
- `--shadow-{name}` → shadow primitive
- `--font-{family-name}` → typography primitive (font family)
- `--text-{size-name}` → typography primitive (font size)
- `--font-weight-{name}` → typography primitive (font weight)
- `--leading-{name}` → typography primitive (line height)

Skip variables that do not match any pattern — they are user-owned.

### 2.2 Extract Semantic Light values

Look for the top-level `:root {` block (the one NOT inside `@media`). Extract every variable that is NOT prefixed with the ADHD primitive prefixes — i.e., it does NOT start with `--color-`, `--spacing-`, `--radius-`, `--shadow-`, `--font-`, `--text-`, `--leading-`. These are semantic role tokens like `--brand-surface`.

For each, parse its value: it should be `var(--color-{palette}-{shade})` or another ADHD primitive reference. Record the role name → primitive reference.

### 2.3 Extract Semantic Dark values

Look for `@media (prefers-color-scheme: dark)` containing a `:root {` block. Extract semantic role tokens the same way as 2.2; these are the Dark mode values.

### 2.4 Verify Layer 3 (Tailwind exposure)

Look for the `@theme inline {` block. Confirm every semantic role token from 2.2 has a matching `--color-{role}: var(--{role})` line. Note any missing exposures — they will be added during apply.

### 2.5 Build the code-side token map

Produce a structured map:
```
{
  primitives: {
    colors: { "gold-100": "#faf0c5", ... },
    spacing: { "1": "0.25rem", ... },
    typography: { "sans": "...", "base": "1rem", ... },
    radius: { ... },
    shadow: { ... }
  },
  semantic: {
    "brand-surface": { light: "var(--color-gold-100)", dark: "var(--color-gold-900)" },
    ...
  }
}
```

This is the code-side input to the diff.
```

- [ ] **Step 3: Phase 3 — Read Figma tokens**

Replace `## Phase 3: Read Figma tokens\n\n(filled in Task 4)` with:

```markdown
## Phase 3: Read Figma tokens

Use `mcp__figma__get_variable_defs` (or the appropriate tool surfaced by the Figma MCP — check available tools at runtime) to retrieve all variables in the `Primitives` and `Semantic` collections.

### 3.1 Translate Figma names to CSS variable names

Apply this mapping (slash → dash, prepend Tailwind prefix where applicable):

| Figma name | CSS variable name |
|---|---|
| `colors/{palette}/{shade}` | `--color-{palette}-{shade}` |
| `spacing/{n}` | `--spacing-{n}` |
| `radius/{name}` | `--radius-{name}` |
| `shadow/{name}` | `--shadow-{name}` |
| `font/{family-name}` | `--font-{family-name}` |
| `text/{size-name}` | `--text-{size-name}` |
| `font-weight/{name}` | `--font-weight-{name}` |
| `leading/{name}` | `--leading-{name}` |
| `colors/{role-path}` (Semantic) | `--{role-path-with-dashes}` |

For Semantic variables, the alias target (e.g., `colors/gold/100`) translates to a `var(--color-gold-100)` reference.

### 3.2 Build the Figma-side token map

Produce the same structure as Phase 2.5 (`primitives` and `semantic` keys) so the two maps can be diffed directly.

### 3.3 Filter by selected domains

Drop entries from both maps that don't belong to a selected domain (from Phase 1.5).
```

- [ ] **Step 4: Phase 4 — Compute and display diff**

Replace `## Phase 4: Compute and display diff\n\n(filled in Task 4)` with:

```markdown
## Phase 4: Compute and display diff

Compare the two token maps. For each domain, produce three lists:
- **Added**: in leader, not in follower
- **Changed**: in both, values differ (track per-mode for semantic tokens)
- **Removed**: in follower, not in leader

The leader / follower assignment depends on `config.leader`:
- `leader: "code"` → leader = code-side map (Phase 2), follower = Figma-side map (Phase 3)
- `leader: "figma"` → leader = Figma-side map, follower = code-side map

### 4.1 Display summary table

Print a per-domain summary, e.g.:

```
ADHD Sync — leader: code → figma

Domain       Added  Changed  Removed
─────────────────────────────────────
colors          3       2        0
spacing         0       1        0
typography      0       0        0
radius          0       0        0
shadow          0       0        0
─────────────────────────────────────
Total           3       3        0
```

### 4.2 Display per-domain detail (only domains with non-zero diff)

For each domain with changes, print a detailed table showing per-token diffs. Color-code: added=green, changed=yellow, removed=red. For semantic tokens, show per-mode differences explicitly (e.g., `brand-surface | dark only: gold-800 → gold-900`).

### 4.3 If `--dry-run`: stop here

Print: `Dry run complete. No changes applied.` and exit.
```

- [ ] **Step 5: Phase 5 — Confirm**

Replace `## Phase 5: Confirm (skip if --dry-run)\n\n(filled in Task 4)` with:

```markdown
## Phase 5: Confirm (skip if --dry-run)

Use `AskUserQuestion` to prompt the user with a single y/n: "Apply these changes?". Default to "no" if the diff includes any **removals** — those require explicit confirmation because the follower may have legitimate orphans the leader lost track of.

If the user declines, stop with: `Sync cancelled. No changes applied.`

If the user confirms, proceed to Phase 6.
```

- [ ] **Step 6: Phase 6 — Apply**

Replace `## Phase 6: Apply (skip if --dry-run)\n\n(filled in Task 4)` with:

```markdown
## Phase 6: Apply (skip if --dry-run)

Process domain-by-domain so the user sees clear progress. After each domain, commit the changes (code side) so partial failures are recoverable.

### 6.1 If leader = code → push to Figma

For each token in the diff:
- **Added**: create the variable in the appropriate Figma collection (Primitives or Semantic) via the Figma MCP. For Semantic, set both Light and Dark mode values (as aliases to the corresponding Primitives variable).
- **Changed**: update the variable's value (per mode for Semantic).
- **Removed**: only if the user explicitly confirmed in Phase 5. Otherwise skip and warn.

After each domain, print: `✓ <domain> synced to Figma (N changes)`.

### 6.2 If leader = figma → pull to code

For each token in the diff, edit `globals.css` in place:
- **Primitives** (added/changed): write into the `@theme {` block. Insert in alphabetical order within the block. If the block doesn't exist, create it after the `@import "tailwindcss";` line.
- **Semantic Light values**: write into the top-level `:root {` block.
- **Semantic Dark values**: write into the `@media (prefers-color-scheme: dark)` → `:root {` block.
- **Tailwind exposure** (always per Semantic role): write `--color-{role}: var(--{role});` into the `@theme inline {` block.
- **Removed**: only if user explicitly confirmed. Delete the variable line (and its Tailwind exposure if applicable).

After each domain, run `git add app/globals.css` and `git commit -m "ADHD sync: <domain> from Figma (N changes)"` so each domain is its own commit.

### 6.3 Touch nothing outside ADHD-managed patterns

Variables that don't match an ADHD name pattern (e.g., user-written `--my-custom-var`) are NEVER modified or removed. If a user-written variable accidentally matches an ADHD pattern, surface the warning during Phase 1.4 — do not silently overwrite.
```

- [ ] **Step 7: Phase 7 — Verify**

Replace `## Phase 7: Verify (skip if --dry-run)\n\n(filled in Task 4)` with:

```markdown
## Phase 7: Verify (skip if --dry-run)

Re-run Phases 2 and 3 to read both sides afresh. Recompute the diff for the synced domains. Assert it is empty (excluding any explicitly skipped removals).

If the diff is NOT empty, the apply step failed somewhere. Print the post-apply diff and DO NOT claim success. Tell the user: `Sync verification failed for domain(s): <list>. The apply step did not produce the expected result. Review the diff above and re-run.`
```

- [ ] **Step 8: Phase 8 — Report**

Replace `## Phase 8: Report\n\n(filled in Task 4)` with:

```markdown
## Phase 8: Report

Print a final summary:

```
ADHD Sync complete.

Domain       Applied
────────────────────
colors          5
spacing         1
typography      0
radius          0
shadow          0
────────────────────
Total           6

Commits (code side):
  abc1234  ADHD sync: colors from Figma (5 changes)
  def5678  ADHD sync: spacing from Figma (1 changes)

Warnings:
  - 0 user-content collisions
  - 0 orphans skipped
```

Include git commit short-SHAs for code-side changes. If leader = figma, mention that Figma changes are not git-tracked but were applied via MCP.
```

- [ ] **Step 9: Reference sections**

Replace the three `## Reference:` placeholders with:

```markdown
## Reference: Mandated Figma structure

ADHD v1 requires this exact structure in the Figma file. Validation will fail otherwise.

### `Primitives` collection (no modes — or single mode treated as no modes)

Variables follow these naming patterns:

| Domain | Pattern | Example |
|---|---|---|
| Colors | `colors/{palette}/{shade}` | `colors/gold/100` |
| Spacing | `spacing/{n}` | `spacing/4` |
| Radius | `radius/{name}` | `radius/md` |
| Shadow | `shadow/{name}` | `shadow/lg` |
| Typography | `font/{family-name}`, `text/{size}`, `font-weight/{name}`, `leading/{name}` | `font/sans`, `text/base`, `font-weight/medium`, `leading/tight` |

All values are RAW (not aliases). No modes (or one mode treated as no modes).

### `Semantic` collection (exactly two modes: `Light`, `Dark`)

Variables follow `colors/{role-path}` pattern, e.g., `colors/brand/surface`, `colors/background`. ADHD does not mandate the role vocabulary — `surface`/`on-surface` (Material), `bg`/`fg`, `main`/`text` are all valid as long as they're kebab-case + slash hierarchy.

All values are ALIASES to a Primitives variable. Both modes (Light and Dark) must have alias values.

## Reference: CSS variable name mappings

Translation between Figma variable names and CSS variable names:

| Figma | CSS variable | Block in globals.css |
|---|---|---|
| `colors/gold/100` (Primitives) | `--color-gold-100` | `@theme {}` |
| `spacing/4` (Primitives) | `--spacing-4` | `@theme {}` |
| `radius/md` (Primitives) | `--radius-md` | `@theme {}` |
| `shadow/md` (Primitives) | `--shadow-md` | `@theme {}` |
| `font/sans` (Primitives) | `--font-sans` | `@theme {}` |
| `text/base` (Primitives) | `--text-base` | `@theme {}` |
| `font-weight/medium` (Primitives) | `--font-weight-medium` | `@theme {}` |
| `leading/tight` (Primitives) | `--leading-tight` | `@theme {}` |
| `colors/brand/surface` (Semantic) | `--brand-surface` (Light value) | `:root {}` |
| `colors/brand/surface` (Semantic) | `--brand-surface` (Dark value) | `@media (prefers-color-scheme: dark) :root {}` |
| `colors/brand/surface` (Semantic) | `--color-brand-surface: var(--brand-surface)` | `@theme inline {}` (Tailwind exposure) |

## Reference: Common errors and fix-up guidance

### "Cannot find adhd.config.ts at the repo root"
Create `adhd.config.ts` at the repo root with this minimal shape:
```ts
const config = {
  leader: "code" as const,
  figma: { url: "https://www.figma.com/design/<KEY>/<NAME>" },
};
export default config;
```

### "Figma MCP is not authenticated"
The Figma MCP needs OAuth. Run the MCP auth flow per Figma MCP documentation, then retry.

### "Cannot reach the Figma file"
Verify the URL is for a Figma file (not a node selection or a non-Figma URL). Confirm you have read access to the file. If `leader: "code"`, you also need write access.

### "Primitives collection not found" / "Semantic collection not found"
ADHD v1 mandates these exact collection names. Rename your collections in Figma, or create them.

### "Semantic collection has N modes; expected exactly Light and Dark"
ADHD v1 supports only the two-mode Light/Dark model. Remove or rename modes. Multi-mode support is planned for v2.

### "Variable name does not follow kebab-case + slash hierarchy"
Rename the offending variable. Examples of valid names: `colors/gold/100`, `spacing/4`, `colors/brand/surface`. Examples of invalid names: `Colors/Gold/100` (capitalized), `colors gold 100` (spaces), `colors_gold_100` (underscores).

### "Semantic variable has raw value instead of alias"
Edit the variable in Figma to alias a Primitives variable. ADHD requires Semantic to be aliases-only.

### "User-written CSS variable matches an ADHD name pattern"
Rename your CSS variable to avoid collision, OR accept that ADHD will overwrite it on next sync. The collision is in the listed file/line of `globals.css`.
```

- [ ] **Step 10: Reload and verify the skill loads**

In Claude Code:
```
/reload-plugins
```

Then run `/` and confirm `/adhd:sync` appears with the description from the frontmatter.

- [ ] **Step 11: Commit**

```bash
git add plugins/adhd/skills/sync/SKILL.md
git commit -m "Fill in /adhd:sync workflow phases and reference sections"
```

---

## Task 5: Dogfood validation

Manual end-to-end test. Since this repo's `adhd.config.ts` uses a placeholder Figma URL (`REPLACE_WITH_FIGMA_KEY`), the full workflow can only be tested with a real Figma file. The acceptance test for v1 is "the workflow runs through Phase 1 (validate) and produces the expected error when the Figma URL is unreachable."

For a real end-to-end test (optional, requires user to have a properly-structured Figma file), point `adhd.config.ts` at that file before running.

- [ ] **Step 1: Reload plugins**

```
/reload-plugins
```

- [ ] **Step 2: Run dry-run with placeholder URL**

```
/adhd:sync --dry-run
```

Expected behavior:
- Phase 1.1 passes (config exists and parses).
- Phase 1.2 passes (`app/globals.css` exists with Tailwind import).
- Phase 1.3 fails with: `Cannot reach the Figma file at https://www.figma.com/design/REPLACE_WITH_FIGMA_KEY/ADHD-Reference. Verify the URL and your access permissions.`
- Workflow stops with the error message printed.

This confirms the skill loads and executes Phases 1.1 and 1.2 correctly. The Figma-side phases will be tested when a real Figma file is available.

- [ ] **Step 3: (Optional) Test with a real Figma file**

If a properly-structured Figma file is available:
1. Update `adhd.config.ts` with the real URL.
2. Run `/adhd:sync --dry-run`.
3. Observe the diff output.
4. Run `/adhd:sync` (without `--dry-run`) and confirm the apply + verify phases work.

- [ ] **Step 4: Production build still passes**

```bash
npm run build
```

Expected: clean build (the new files don't affect the Next.js app).

- [ ] **Step 5: Final commit (if any docs adjustments)**

If Step 2 surfaced any issues with the skill's error message wording or workflow, fix them in `SKILL.md` and commit before declaring v1 complete.
