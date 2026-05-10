# /adhd:export-for-figma + /adhd:config Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing `/adhd:export-for-figma` skill (wraps `adhd:to-dtcg` Procedure A) and simplify `/adhd:config` per the restructure spec — drop the leader prompt, drop the PAT setup phase, drop `figma.pat` from the schema. Make `leader` optional in `/adhd:sync` so configs without it still validate.

**Architecture:** `/adhd:export-for-figma` is a thin user skill that validates `adhd.config.ts`, invokes the existing model-invocable `adhd:to-dtcg` skill (which runs `cli.js` shipped in Plan 1), writes the resulting DTCG JSON to `adhd-export-for-figma.json` at the repo root, and ensures the file is gitignored. `/adhd:config` loses two phases (leader and PAT setup) and renumbers the remaining six. `/adhd:sync` Phase 1.1 changes one bullet: `leader` is now optional and absent defaults to `figma`.

**Tech Stack:** Claude Code skill markdown (no implementation language). All conversion logic lives in `plugins/adhd/lib/to-dtcg/cli.js` from Plan 1. This plan is purely orchestration markdown changes.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` (Components 3 + 6 — the export skill and the config simplification). Mode-encoding example in Section 5 reflects Plan 1.5's format.

---

## File map

**Create:**
- `plugins/adhd/skills/export-for-figma/SKILL.md` — new user-invocable skill, ~120 lines.

**Modify:**
- `plugins/adhd/skills/config/SKILL.md` — drop Phase 1 (leader) and Phase 4 (PAT setup); renumber the remaining phases 0, 2, 3, 5, 6, 7 → 0, 1, 2, 3, 4, 5; remove `figma.pat` references from Phase 0 parse-defaults, Phase 4 (write) template, and reference sections.
- `plugins/adhd/skills/sync/SKILL.md` — Phase 1.1 schema validation: make `leader` optional, defaulting to `figma` when absent.

**Not modified** (Plan 3+ scope):
- The `leader: "code"` abort message in `/adhd:sync` stays as-is. Plan 3 (rename to `/adhd:sync-from-figma`) deletes it.
- The `figma.pat` shape-check bullet in `/adhd:sync` Phase 1.1 stays — backwards compat for any user who hand-wrote `figma.pat` in their config. Plan 3 deletes it.
- Other skills (`adhd:to-dtcg`, validator) are unchanged.

## Validation strategy

Each task is small (skill markdown edits). Validation gates:
1. After each `/adhd:config` edit: `node scripts/validate-skill-frontmatter.js` still passes (3/3 skills valid).
2. After Task 1 (new skill): same plus `/adhd:config`, `/adhd:sync`, `/adhd:to-dtcg`, `/adhd:export-for-figma` all validate (4/4).
3. End-to-end manual walkthrough (Task 6) exercises the user-facing flow against the existing `cli.js` infrastructure.

No automated tests are added by this plan — the skills are markdown orchestration. The underlying converter has 62 unit tests from Plans 1 + 1.5 that continue to pass; this plan doesn't touch `cli.js`.

---

## Task 1: Create `/adhd:export-for-figma` skill

**Files:**
- Create: `plugins/adhd/skills/export-for-figma/SKILL.md`

- [ ] **Step 1: Write the new skill file**

Create `plugins/adhd/skills/export-for-figma/SKILL.md` with this verbatim content:

```markdown
---
description: "Generate a DTCG JSON file from this project's design tokens (Tailwind v4 defaults + custom tokens in globals.css). The user imports the resulting file into Figma via a DTCG-compatible community plugin (TokensBrücke recommended). Reads adhd.config.ts; never talks to Figma directly."
disable-model-invocation: true
allowed-tools: Read Write Bash Skill
---

# ADHD Export for Figma

You are running the ADHD export-for-figma skill. ADHD ("agent-driven harmonious development") keeps design tokens synchronized between this Tailwind v4 codebase and a Figma file. This skill produces a DTCG (Design Token Community Group) JSON file the user imports into Figma manually via a community plugin.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-restructure-design.md` — Component 3.

The skill is **linear**: validate config → convert tokens → write file → report. It never modifies Figma.

## Phase 1: Validate

### 1.1 Read and validate `adhd.config.ts`

- Use `Read` to load `adhd.config.ts` at the repo root.
- If the file does not exist, abort with:

  ```
  ADHD export-for-figma cannot proceed.

  Reason:    Cannot find adhd.config.ts at the repo root.
  Next step: Run /adhd:config to fix.
  ```

- **PAT-leak preflight.** Before parsing for fields, scan the source text of the file you just read with two regex checks:
  1. `figd_[A-Za-z0-9_-]+` — Figma PAT prefix.
  2. `(pat|token|secret)\s*:\s*"[^"]{30,}"` — long opaque value assigned to a credential-named key. If the matched value also satisfies `^[A-Z][A-Z0-9_]*$` (i.e., it looks like an env var name), skip this heuristic — it's a valid name, not a token.

  On match, abort with:

  ```
  ADHD export-for-figma cannot proceed.

  Reason:    Looks like a Figma PAT is committed to adhd.config.ts. This is a credential leak.
  Next step: Remove it from the config and store it as FIGMA_PAT in either .env.local
             (gitignored) or your shell environment. Then run /adhd:config.
  ```

- Parse the default-exported object with targeted regex (look for `figma:`, `domains:`, `cssEntry:`).
- Validate:
  - `figma.url` matches `^https://www\.figma\.com/design/[^/]+/`. If not, abort with `Run /adhd:config to fix.` (config-fixable).
  - `domains` (if present) is an array containing only `"colors"`, `"spacing"`, `"typography"`, `"radius"`, `"shadow"`. If not, abort with the same `Run /adhd:config to fix.` next-step.
  - `cssEntry` (if present) points to a file that exists.

  Emit errors in the standard format:

  ```
  ADHD export-for-figma cannot proceed.

  Reason:    <one-line specific issue>
  Next step: Run /adhd:config to fix.
  ```

### 1.2 Resolve and check `cssEntry`

- Resolve the CSS path: `config.cssEntry ?? "app/globals.css"`.
- If the resolved file does not exist, abort with:

  ```
  ADHD export-for-figma cannot proceed.

  Reason:    Cannot find CSS entry at <resolved-path>.
  Next step: Run /adhd:config to fix.
  ```

- Read the file's first ~40 lines and confirm `@import "tailwindcss"` is present. If not, warn (don't abort) and continue.

The `figma.url` field is parsed but unused by this skill. Validating it ensures the credential-leak check runs over the full config.

## Phase 2: Convert

Invoke the model-invocable `adhd:to-dtcg` skill with Procedure A (css-to-dtcg). Use the `Skill` tool with skill name `adhd:to-dtcg` and tell it: "Run Procedure A. Input CSS file path: `<resolved-cssEntry>`."

The to-dtcg skill will:
1. Check whether `node_modules/tailwindcss/theme.css` exists.
2. Run `node plugins/adhd/lib/to-dtcg/cli.js --source css --input <cssEntry> --tailwind-theme <theme-or-none>`.
3. Return the DTCG JSON output (stdout).

If the `Skill` invocation surfaces a non-zero exit error from the converter, propagate it as the abort reason:

```
ADHD export-for-figma cannot proceed.

Reason:    Token conversion failed: <stderr from cli.js>
Next step: Inspect the input file and rerun. If the error persists, file an issue.
```

## Phase 3: Write

- Use `Write` to write the DTCG JSON to `adhd-export-for-figma.json` at the repo root.
- The output is already pretty-printed (cli.js emits sorted keys, 2-space indent, trailing newline).
- Check `.gitignore` for `adhd-export-for-figma.json`. If absent, also check for a covering glob (`*.json` and the like). If the file isn't gitignored, append `adhd-export-for-figma.json` to `.gitignore` on its own line.
- Track whether `.gitignore` was modified — Phase 4 reports it.

## Phase 4: Report

Print a summary tailored to what happened:

```
Wrote adhd-export-for-figma.json (<N> tokens: <M> primitives, <K> semantic).

[If .gitignore was modified:]
Added adhd-export-for-figma.json to .gitignore.

Next:
  1. Open your Figma file (<URL from config>).
  2. Install the TokensBrücke community plugin if not already:
     https://www.figma.com/community/plugin/1254538877056388290/tokensbrücke
  3. Run TokensBrücke → Import. Paste the contents of
     adhd-export-for-figma.json. Recommended settings: HEX color mode,
     Use DTCG keys ON, Omit collection names OFF, Include figma metadata OFF.
  4. Verify the variables appear in Figma's Variables panel under
     `color`, `spacing`, and `shadow` collections.

Known import caveats (documented in plugins/adhd/lib/to-dtcg/README.md):
  - Spacing units lost (`1rem` becomes `1px`).
  - Shadow `$type` downgraded to `"string"`.
  - Phantom mode values added to single-value primitives in 2-mode collections.
```

Substitute `<N>`, `<M>`, `<K>`, and `<URL from config>` with actual counts and the URL.

For token counts: `<M>` is the number of leaf entries under non-mode keys (color/spacing/shadow/font/text/fontWeight/leading) that are NOT semantic. `<K>` is the number of entries with `$extensions.mode`. `<N>` = `<M>` + `<K>`.

## Reference: Common errors and fix-up guidance

### "Cannot find adhd.config.ts at the repo root"
Run `/adhd:config` to create one.

### "Looks like a Figma PAT is committed to adhd.config.ts"
The preflight scan found a string that looks like a Figma personal access token in your config. Tokens never go in `adhd.config.ts` (it's tracked in git). Move the token to `.env.local` (gitignored) or your shell rc, then re-run.

### "Cannot find CSS entry at <path>"
The `cssEntry` field in your config (or the default `app/globals.css`) doesn't exist on disk. Run `/adhd:config` and confirm the auto-detection picks the right path. For a custom path, set `cssEntry` explicitly in `adhd.config.ts`.

### "Token conversion failed"
The underlying `cli.js` couldn't produce DTCG. Check the stderr output for specifics — commonly an unparseable shadow, OKLCH, or alias in `globals.css`. Fix the offending CSS and rerun.

## Reference: What the export contains

The output `adhd-export-for-figma.json` has top-level namespaces by domain:

- `color` — color primitives (e.g., `color.gold.100`) AND semantic colors with mode aliases (e.g., `color.brand.surface`).
- `spacing` — dimension primitives (e.g., `spacing.4`).
- `radius` — dimension primitives.
- `shadow` — shadow primitives (CSS shadow strings).
- `font`, `text`, `fontWeight`, `leading` — typography primitives.

Tailwind v4 default tokens are merged in. User-defined tokens in `@theme {}` override defaults. Semantic tokens use `$extensions.mode.{light,dark}` encoding alongside a top-level `$value` (the Light/default value).

See `plugins/adhd/lib/to-dtcg/README.md` for the canonical format reference.
```

That is the complete file content for the new skill.

- [ ] **Step 2: Verify the skill is discoverable**

The user runs `/reload-plugins` to pick up the new skill. As the implementer (subagent), you can't do this — instead, run the frontmatter validator to confirm the file parses:

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
```

Expected output: `4/4 skills valid.` (config, sync, to-dtcg, and the new export-for-figma all pass).

- [ ] **Step 3: Commit**

```bash
cd /Users/hhff/Documents/Code/adhd
git add plugins/adhd/skills/export-for-figma/SKILL.md
git commit -m "Add /adhd:export-for-figma skill (wraps adhd:to-dtcg for code → Figma DTCG export)"
```

---

## Task 2: `/adhd:config` — drop Phase 1 (leader prompt) and Phase 4 (PAT setup)

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md`

> **Note for the implementer:** the wizard's current phase numbering (Phase 0–7) reflects Plan 1's structure. This task DELETES two phases. The next task (Task 3) renumbers the remaining ones. Do these in order so renumbering happens against a clean phase set.

- [ ] **Step 1: Read the current state of the wizard**

```bash
cd /Users/hhff/Documents/Code/adhd
wc -l plugins/adhd/skills/config/SKILL.md
```

Expected: ~340 lines. Use `Read` to see the current structure if you need orientation.

- [ ] **Step 2: Delete the entire Phase 1 (leader prompt)**

In `plugins/adhd/skills/config/SKILL.md`, find the `## Phase 1: Leader` heading and the prose under it (which uses `AskUserQuestion` with code/figma options and notes Plan 2's status). Delete from `## Phase 1: Leader` (inclusive) up to but not including `## Phase 2: Domains`.

Use `Edit` with:
- `old_string`: the entire block starting with `## Phase 1: Leader\n\nUse \`AskUserQuestion\`` and ending with the last paragraph of Phase 1 (before `## Phase 2: Domains`).
- `new_string`: empty string.

This collapses Phase 0 directly into Phase 2 (which becomes the new Phase 1 in Task 3).

- [ ] **Step 3: Delete the entire Phase 4 (PAT setup)**

Find `## Phase 4: PAT setup (only when leader = code)`. Delete from this heading (inclusive) up to but not including `## Phase 5: cssEntry auto-detect`.

This removes:
- The detection cascade (shell, .env*, etc.)
- The HTTP validation logic (200/401/403)
- The "Prompt for a new token" section
- The "Where to write" branches
- The "Save state for Phase 6" tracking

After this edit, `## Phase 3: Figma URL + reachability` is immediately followed by `## Phase 5: cssEntry auto-detect`.

- [ ] **Step 4: Run skill frontmatter validator**

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
```

Expected: 4/4 valid (frontmatter unchanged; only body content removed).

- [ ] **Step 5: Commit**

```bash
cd /Users/hhff/Documents/Code/adhd
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Remove Phase 1 (leader prompt) and Phase 4 (PAT setup) from /adhd:config"
```

---

## Task 3: `/adhd:config` — renumber phases and clean Phase 0 parse-defaults

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md`

After Task 2, the file has phase headings: 0, 2, 3, 5, 6, 7. Renumber to 0, 1, 2, 3, 4, 5. Also clean up Phase 0's parse-defaults to drop `figma.pat`.

- [ ] **Step 1: Update Phase 0's parse-defaults list**

In Phase 0, find this bulleted list (under `### Parse defaults (Branch A only)`):

```
- `leader:` → string, expected `"code"` or `"figma"`
- `figma.url:` → string
- `figma.pat:` (optional) → string env var name
- `domains:` (optional) → array of strings
- `cssEntry:` (optional) → string path
```

Replace with (drop `leader` AND drop `figma.pat`):

```
- `figma.url:` → string
- `domains:` (optional) → array of strings
- `cssEntry:` (optional) → string path
```

Then find the next sentence about defaults (likely `Pass these forward as defaults for Phases 1, 2, 3, 4, and 5.`) and update phase numbers if needed (it should still say Phases 1, 2, 3, 4 since modes shifted).

The line should become: `Pass these forward as defaults for Phases 1, 2, and 3.` (only the three phases that have user-facing prompts: domains, URL, cssEntry).

- [ ] **Step 2: Renumber `## Phase 2: Domains` → `## Phase 1: Domains`**

Use `Edit` to replace `## Phase 2: Domains` with `## Phase 1: Domains`.

- [ ] **Step 3: Renumber `## Phase 3: Figma URL + reachability` → `## Phase 2: Figma URL + reachability`**

Use `Edit` to replace `## Phase 3: Figma URL + reachability` with `## Phase 2: Figma URL + reachability`.

- [ ] **Step 4: Renumber `## Phase 5: cssEntry auto-detect` → `## Phase 3: cssEntry auto-detect`**

Use `Edit` to replace `## Phase 5: cssEntry auto-detect` with `## Phase 3: cssEntry auto-detect`.

- [ ] **Step 5: Renumber `## Phase 6: Write adhd.config.ts` → `## Phase 4: Write adhd.config.ts`**

Use `Edit` to replace `## Phase 6: Write adhd.config.ts` with `## Phase 4: Write adhd.config.ts`.

- [ ] **Step 6: Renumber `## Phase 7: Report` → `## Phase 5: Report`**

Use `Edit` to replace `## Phase 7: Report` with `## Phase 5: Report`.

- [ ] **Step 7: Update internal phase references**

Search the file for stale phase number references (e.g., "Phase 6 decides", "passed to Phase 7"). Likely found in:
- Phase 1 (Domains): "Phase 6 decides whether to write it" → "Phase 4 decides whether to write it".
- Phase 2 (URL): "Default value: the existing `figma.url` from Phase 0" — fine, Phase 0 is unchanged.
- Phase 3 (cssEntry): no internal references typically.
- Phase 4 (Write) body: references to "Phase 0", "Phase 1", "Phase 2", "Phase 3" — all unchanged or already-correct.

Use `grep -n "Phase [0-9]" plugins/adhd/skills/config/SKILL.md` to spot stale references. Update each to the new numbering scheme:
- Old Phase 2 → New Phase 1 (domains)
- Old Phase 3 → New Phase 2 (URL)
- Old Phase 5 → New Phase 3 (cssEntry)
- Old Phase 6 → New Phase 4 (write)
- Old Phase 7 → New Phase 5 (report)

- [ ] **Step 8: Validator + commit**

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Renumber /adhd:config phases (0,1,2,3,4,5); drop figma.pat from parse defaults"
```

---

## Task 4: `/adhd:config` — Phase 4 (Write) template + Phase 5 (Report) cleanup

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md`

After Tasks 2-3, the wizard structure is clean. Now scrub `figma.pat` and `leader: "code"` from the write template and report sections.

- [ ] **Step 1: Update Phase 4 (Write) field-inclusion table**

In Phase 4, find the table:

```
| Field | Include if |
|---|---|
| `figma.pat` | `envVarName !== "FIGMA_PAT"` |
| `domains` | `domainsSelection` is a strict subset (length 1–4) |
| `cssEntry` | resolved path is NOT `app/globals.css` |
```

Replace with (drop `figma.pat` row):

```
| Field | Include if |
|---|---|
| `domains` | `domainsSelection` is a strict subset (length 1–4) |
| `cssEntry` | resolved path is NOT `app/globals.css` |
```

- [ ] **Step 2: Update Phase 4 (Write) TS template**

Find the rendered template:

```ts
// adhd.config.ts — read by the ADHD skills (/adhd:sync, /adhd:config).
// No npm package or import required; the skills validate the shape on read.

const config = {
  leader: "<LEADER>" as const,

  figma: {
    url: "<URL>",
    // optional: pat: "<ENV_VAR_NAME>",
  },

  // optional: domains: [<COMMA_QUOTED_LIST>],

  // optional: cssEntry: "<CSS_ENTRY>",
};

export default config;
```

Replace with (drop `leader` line and the `pat:` optional comment):

```ts
// adhd.config.ts — read by the ADHD skills (/adhd:sync, /adhd:config, /adhd:export-for-figma).
// No npm package or import required; the skills validate the shape on read.

const config = {
  figma: {
    url: "<URL>",
  },

  // optional: domains: [<COMMA_QUOTED_LIST>],

  // optional: cssEntry: "<CSS_ENTRY>",
};

export default config;
```

Also find the prose immediately after the template:

> When omitting an optional field, also drop the corresponding `// optional:` placeholder comment — the file should not carry hints about fields that aren't present.

Keep this prose as-is (the rule still applies for `domains` and `cssEntry`).

- [ ] **Step 3: Update Phase 5 (Report) — drop conditional next-step branching**

Find the Phase 5 (Report) section. It currently has a `<NEXT_STEP>` placeholder with two cases — `leader: "figma"` (run `/adhd:sync --dry-run`) and `leader: "code"` (Plan 2 forthcoming message). Replace the entire conditional block with a single unconditional next-step that points at `/adhd:export-for-figma`.

The current structure (find this block):

```
Substitute the actual values in angle brackets. The `<NEXT_STEP>` line depends on the saved `leader`:

- **`leader: "figma"`** — print: `Next: run /adhd:sync --dry-run to preview your first diff.`
- **`leader: "code"`** — print:
  ```
  Next: leader = "code" apply path is being implemented in Plan 2.
        /adhd:sync will report this and stop until Plan 2 ships.
        Once it does, run /adhd:sync --dry-run to preview your first diff.
  ```

If running on a healthy config that didn't change, print `Config unchanged.` instead of the saved-to message.
```

Replace with:

```
Substitute the actual values in angle brackets. The `<NEXT_STEP>` line is always:

```
Next: run /adhd:export-for-figma to produce the DTCG JSON file you'll
import into Figma via TokensBrücke (or any DTCG-compatible plugin).
Then run /adhd:sync --dry-run to preview your first diff (Figma → code).
```

If running on a healthy config that didn't change, print `Config unchanged.` instead of the saved-to message.
```

Also find the report template itself, currently:

```
Config saved to adhd.config.ts.

Leader: <LEADER>
Figma:  <URL>
Domains: <"all" or comma-separated list>
CSS:    <"app/globals.css (default)" or the explicit path>
PAT:    <"loaded from <source>" or "n/a (leader=figma)">
```

Replace with (drop Leader and PAT lines):

```
Config saved to adhd.config.ts.

Figma:   <URL>
Domains: <"all" or comma-separated list>
CSS:     <"app/globals.css (default)" or the explicit path>
```

Also find lines about `.env.local` writes:

```
[If .env.local was created or modified:]
Wrote <envVarName> to .env.local.
[If .gitignore was modified:]
Added .env.local to .gitignore.
```

Delete both. The wizard no longer touches `.env.local`. (If `.gitignore` was modified for `adhd-export-for-figma.json` instead, that's the export skill's report — not this wizard's.)

- [ ] **Step 4: Validator + commit**

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Drop figma.pat and leader from /adhd:config Phase 4 (write) template and Phase 5 (report)"
```

---

## Task 5: `/adhd:config` — Reference sections cleanup

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md`

Drop the now-obsolete reference entries and update the schema reference.

- [ ] **Step 1: Drop the three PAT-related reference entries**

In the `## Reference: Common errors and fix-up guidance` section, find and DELETE these three subsections (entire `###` heading + body for each):

1. `### "Your Figma PAT was rejected (HTTP 401)"`
2. `### "Your token does not have access to Figma's Variables API (HTTP 403)"`
3. `### "figma.pat must be the NAME of an env var"`

Keep these other subsections (they're still relevant):
- `### "Looks like a Figma PAT is committed to adhd.config.ts"` — preflight stays.
- `### "Figma MCP is not authenticated"` — still applies for the URL reachability check in Phase 2.
- `### "Cannot reach the Figma file"` — still applies.

- [ ] **Step 2: Update the schema reference**

Find the `## Reference: adhd.config.ts schema` section and the TS code block. Currently:

```ts
const config = {
  leader: "code" | "figma",       // required
  figma: {
    url: "https://www.figma.com/design/<key>/<name>",   // required
    pat?: "FIGMA_PAT",            // optional env var NAME (default "FIGMA_PAT" if omitted)
  },
  domains?: ["colors", "spacing", "typography", "radius", "shadow"],   // optional; omit = all
  cssEntry?: "src/app/globals.css",                                     // optional; omit = "app/globals.css"
};
export default config;
```

Replace with:

```ts
const config = {
  figma: {
    url: "https://www.figma.com/design/<key>/<name>",   // required
  },
  domains?: ["colors", "spacing", "typography", "radius", "shadow"],   // optional; omit = all
  cssEntry?: "src/app/globals.css",                                     // optional; omit = "app/globals.css"
};
export default config;
```

Also find the explanatory paragraph below the code block (currently mentions `figma.pat` env var lookup). Replace with:

```
The schema is read by `/adhd:config`, `/adhd:sync`, and `/adhd:export-for-figma`. No fields hold credentials — the PAT-leak preflight (Phase 0) actively blocks any commit that puts a token in this file.
```

- [ ] **Step 3: Validator + commit**

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Drop PAT-related reference entries from /adhd:config; simplify schema reference"
```

---

## Task 6: `/adhd:sync` — make `leader` optional

**Files:**
- Modify: `plugins/adhd/skills/sync/SKILL.md`

The wizard now writes configs WITHOUT a `leader` field. Sync's Phase 1.1 currently REQUIRES `leader`. Make it optional, defaulting to `figma` when absent.

- [ ] **Step 1: Find the validate bullet for `leader`**

In `plugins/adhd/skills/sync/SKILL.md` Phase 1.1, the validate block has a bullet about `leader`. It currently looks like:

```
  - `leader` is exactly `"code"` or `"figma"`.
```

Replace with:

```
  - `leader` (if present) is exactly `"code"` or `"figma"`. Absent is treated as `"figma"`.
```

- [ ] **Step 2: Find the leader=code abort guard**

Phase 1.1 has a section starting with `**\`leader: "code"\` apply path**` that triggers the Plan-2-forthcoming abort when `config.leader === "code"`. This block stays — backwards compat for users with old configs that still have `leader: "code"`.

The check works fine because if `leader` is absent, `config.leader === "code"` is false, and the abort doesn't fire. No edit needed here.

- [ ] **Step 3: Skim for other places `leader` is referenced**

Use `grep -n "leader" plugins/adhd/skills/sync/SKILL.md` to find all `leader` references. Confirm each one is either:
- Backwards-compat for old configs with `leader: "code"` — keep as-is (Plan 3 will delete these).
- Documentation/prose that describes the leader concept — keep, Plan 3 deletes.

You shouldn't need to change anything else. The single bullet edit in Step 1 is the whole change.

- [ ] **Step 4: Validator + commit**

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
git add plugins/adhd/skills/sync/SKILL.md
git commit -m "Make leader field optional in /adhd:sync schema validation (defaults to figma)"
```

---

## Task 7: Manual e2e walkthrough

This task is the final validation gate. Each scenario maps to acceptance criteria in the spec.

- [ ] **Step 1: Run `/reload-plugins`**

The user must run this in a Claude Code session to pick up the new skill (`/adhd:export-for-figma`). The implementer (subagent) cannot trigger this — note it as a manual step in the report.

- [ ] **Step 2: Scenario A — `/adhd:config` produces a clean schema**

Setup:
```bash
mv adhd.config.ts adhd.config.ts.bak
```

Run `/adhd:config`. Walk through:
- Phase 0: preflight passes (no existing config to scan).
- Phase 1: domains prompt.
- Phase 2: Figma URL prompt + reachability test.
- Phase 3: cssEntry auto-detect.
- Phase 4: write (no leader prompt was asked, no PAT prompt was asked).
- Phase 5: report.

Verify the resulting `adhd.config.ts`:

```bash
cat adhd.config.ts
```

Expected output should NOT contain `leader:` or `figma.pat:`. It should contain `figma.url` and optionally `domains`/`cssEntry`.

Restore the previous config:
```bash
rm adhd.config.ts
mv adhd.config.ts.bak adhd.config.ts
```

- [ ] **Step 3: Scenario B — `/adhd:export-for-figma` writes a valid DTCG file**

Run `/adhd:export-for-figma`. Verify:
- Phase 1 validation passes against the existing `adhd.config.ts`.
- Phase 2 invokes `adhd:to-dtcg` and produces DTCG output.
- Phase 3 writes `adhd-export-for-figma.json` at the repo root.
- `.gitignore` is checked; if `adhd-export-for-figma.json` not present and not covered by a glob, the file is appended.
- Phase 4 prints the report with TokensBrücke recommendation.

Verify:
```bash
ls -la adhd-export-for-figma.json
head -10 adhd-export-for-figma.json
grep "adhd-export-for-figma" .gitignore || echo "Not in .gitignore (might be covered by a glob)"
```

Expected: file exists, starts with `{`, gitignore mentions it (or you confirm a glob covers it).

- [ ] **Step 4: Scenario C — `/adhd:sync` accepts config without leader**

Verify `/adhd:sync --dry-run` runs against the new config. The wizard wrote no `leader` field. Sync should validate this as a config without leader (defaulting to `figma`).

```
/adhd:sync --dry-run
```

Expected: Phase 1 passes (no "leader required" error), proceeds through normal validate → read → diff → display flow. The diff may be non-empty if Figma has variables, or empty if not.

- [ ] **Step 5: Scenario D — Backwards compat with leader=code**

Setup: hand-edit `adhd.config.ts` to add `leader: "code" as const,` to the config object.

Run `/adhd:sync --dry-run`. Expected: aborts with the standard leader=code Plan-2-forthcoming message (unchanged behavior — the abort guard still fires).

Restore the config (remove the `leader: "code"` line).

- [ ] **Step 6: Scenario E — Frontmatter validator passes**

```bash
cd /Users/hhff/Documents/Code/adhd
node scripts/validate-skill-frontmatter.js
```

Expected: `4/4 skills valid.` (config, sync, to-dtcg, export-for-figma).

- [ ] **Step 7: Scenario F — Underlying tests still pass**

```bash
cd /Users/hhff/Documents/Code/adhd
node --test plugins/adhd/lib/to-dtcg/__tests__/
```

Expected: 62/62 pass (Plan 1.5's count). This task didn't touch `cli.js`; tests should be unaffected.

- [ ] **Step 8: Final report**

Print:

```
Plan 2 (export-for-figma + config simplification) complete.

Files changed:
  plugins/adhd/skills/export-for-figma/SKILL.md   (NEW)
  plugins/adhd/skills/config/SKILL.md             (modified — wizard simplified)
  plugins/adhd/skills/sync/SKILL.md               (modified — leader made optional)

Acceptance criteria covered (from spec):
  AC: /adhd:config produces a config with no leader/figma.pat fields — VERIFIED in Scenario A
  AC: /adhd:export-for-figma writes adhd-export-for-figma.json — VERIFIED in Scenario B
  AC: .gitignore is updated to exclude the export file — VERIFIED in Scenario B
  AC: /adhd:sync accepts configs without leader — VERIFIED in Scenario C
  AC: /adhd:sync still aborts on leader: "code" (backwards compat) — VERIFIED in Scenario D
  AC: All skills validate — VERIFIED in Scenario E
  AC: Underlying converter tests still pass — VERIFIED in Scenario F

Next steps:
  - Push to GitHub; verify CI runs green.
  - Plan 3: rename /adhd:sync to /adhd:sync-from-figma, delete leader entirely from sync's Phase 1, remove the figma.pat shape check, update mode-extension Phase 1.1.
  - Plan 4: build /adhd:check (bidirectional read).

  Note: Plans 3 and 4 need a re-brainstorm pass before plan-writing because Plan 1.5 surfaced that the Figma MCP doesn't expose raw variable data. The original spec assumed it did. Likely options for Plans 3-4: consume TokensBrücke export as input, or add an Enterprise REST API path, or wait for Figma to ship a richer MCP tool.
```

- [ ] **Step 9: Final commit (if any documentation changes happened during the walkthrough)**

If you fixed any wording or referenced behavior issues, commit them. If everything passed cleanly, this step is a no-op:

```bash
cd /Users/hhff/Documents/Code/adhd
git status
# If anything is modified, git add + commit. Otherwise, no action.
```

---

## Self-review

**Spec coverage:** every Plan 2 requirement from `2026-05-09-adhd-restructure-design.md` Component 3 (`/adhd:export-for-figma`) and Component 6 (`/adhd:config` simplification) maps to a task. The leader-optional change in `/adhd:sync` is a small additive scope item to keep the wizard's output consumable; it's not strictly in Plan 2's spec scope but is necessary to avoid a broken intermediate state.

**Placeholder scan:** every step has concrete code or text. Phase 4's report has placeholders like `<N>`, `<M>`, `<K>`, `<URL from config>` — those are runtime-substituted by Claude when executing the skill, not plan-time TODOs.

**Type / signature consistency:** the export skill calls `adhd:to-dtcg` Procedure A (matches Plan 1's skill design). The cli.js arguments (`--source css --input <path> --tailwind-theme <theme-or-none>`) match Plan 1's surface. The fixture-refresh paths in the export's reference section match `plugins/adhd/lib/to-dtcg/README.md` from Plan 1.5.

**Phase numbering consistency:** Tasks 2-3 delete + renumber. Tasks 4-5 reference the new numbering (Phase 4 = Write, Phase 5 = Report). The internal-references step in Task 3 catches any stray phase numbers in prose.

**Backwards compat:** existing configs with `leader: "figma"` or `leader: "code"` still work after this plan. Old configs with `figma.pat` aren't broken either (the field is just ignored; sync's shape-check guard stays).
