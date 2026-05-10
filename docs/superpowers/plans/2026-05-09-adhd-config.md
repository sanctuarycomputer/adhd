# /adhd:config Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/adhd:config` slash command (linear wizard for `adhd.config.ts` + Figma PAT setup) and wire its outputs into `/adhd:sync`'s schema validation, error routing, and PAT-leak preflight. Establishes the schema and credential foundations that the hybrid Figma writes engine (separate plan) will build on.

**Architecture:** The wizard is a new SKILL.md (`plugins/adhd/skills/config/SKILL.md`) that walks linearly through eight phases: detect → leader → domains → URL → PAT → cssEntry → write → report. The sync skill (`plugins/adhd/skills/sync/SKILL.md`) is edited in place to add the new `figma.pat` schema field, the PAT-leak preflight, the standardized "Reason / Next step" error format, and an updated `leader: "code"` abort message that signals Plan 2 is in flight. Both skills coordinate via `adhd.config.ts` and `.env.local`; the wizard never invokes sync.

**Plan scope note:** the design spec lists "removal of the `leader: "code"` abort" under Plan 1, but the actual hybrid writes engine ships in Plan 2. Removing the abort here would leave `leader: "code"` half-broken (config saves successfully; sync silently does nothing). This plan keeps the abort but rewrites its message to acknowledge that Plan 2 will deliver the apply path. Plan 2 removes it for real.

**Tech Stack:** Claude Code skill markdown — wizard logic is instructions for Claude executing the skill at runtime. Existing tools used: `Read`, `Write`, `Edit`, `Bash`, `AskUserQuestion`, `mcp__figma__get_metadata`, `WebFetch` (for Figma REST API token validation).

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-config-design.md`.

---

## File map

**Create:**
- `plugins/adhd/skills/config/SKILL.md` — the new wizard skill, sole new file. Sections: frontmatter, intro, Phase 0–7, Reference (Common errors, Schema reference).

**Modify:**
- `plugins/adhd/skills/sync/SKILL.md` — Phase 1.1 (PAT-leak preflight; `figma.pat` shape check; updated `leader: "code"` abort wording; new error-output format applied across Phase 1 errors).

**Not modified (intentionally):**
- `plugins/adhd/.claude-plugin/plugin.json` — skills are auto-discovered from `skills/<name>/SKILL.md`.
- `adhd.config.ts` at the repo root — that's the live consumer config; we don't ship a sample.
- The original token-sync design spec — companion spec is already in place.

## Validation strategy

There is no test framework in this repo; skills are validated by running them. The plan finishes with **Task 12: Acceptance walkthrough**, which exercises each acceptance criterion from the spec by setting up known repo state, running the slash command, and asserting on outputs (file contents, `git status`, etc.). That walkthrough is the only "test" gate; earlier tasks gate on the file edit being applied cleanly.

---

## Task 1: Scaffold `/adhd:config` skill

**Files:**
- Create: `plugins/adhd/skills/config/SKILL.md`

- [ ] **Step 1: Create the skill file with frontmatter and section skeleton**

Write the following content:

```markdown
---
description: "Run the ADHD config wizard. Walks through producing or repairing adhd.config.ts: leader (code or figma), Figma URL (with reachability test), domains (multi-select), and optional Figma PAT setup when leader is code (detects FIGMA_PAT in shell or .env*; validates against Figma REST API; writes to .env.local if needed)."
disable-model-invocation: true
allowed-tools: Read Edit Write Bash AskUserQuestion mcp__figma__get_metadata WebFetch
---

# ADHD Config

You are running the ADHD config wizard. ADHD ("agent-driven harmonious development") keeps design tokens synchronized between this Tailwind v4 codebase and a Figma file. This skill produces a valid `adhd.config.ts` and (when `leader: "code"`) wires up a Figma personal access token (PAT) via `.env.local`.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-config-design.md` — read it if you need detail beyond what this skill provides.

The wizard is **linear**. Each phase prompts at most once, validates, and either proceeds or stops with a clear error. After the wizard completes, the user runs `/adhd:sync --dry-run` separately. The wizard never invokes sync.

## Phase 0: Detect existing config + PAT-leak preflight

## Phase 1: Leader

## Phase 2: Domains

## Phase 3: Figma URL + reachability

## Phase 4: PAT setup (only when leader = code)

## Phase 5: cssEntry auto-detect

## Phase 6: Write adhd.config.ts

## Phase 7: Report

## Reference: Common errors and fix-up guidance

## Reference: adhd.config.ts schema
```

- [ ] **Step 2: Reload plugins and verify the command is discoverable**

Run: `/reload-plugins` (the user does this; instruct them at the end of the step if needed)

Expected: the reload prints a count that includes the new skill. The slash command `/adhd:config` should now appear when the user types `/`.

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add /adhd:config skill scaffold (frontmatter + section headers)"
```

---

## Task 2: Phase 0 — Detect existing config + PAT-leak preflight

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 0` section)

- [ ] **Step 1: Fill in Phase 0 instructions**

Replace the `## Phase 0: Detect existing config + PAT-leak preflight` heading and (empty) body with:

````markdown
## Phase 0: Detect existing config + PAT-leak preflight

Resolve the path: `adhd.config.ts` at the repo root. Use `Read` to load it. There are three branches:

**Branch A — File exists and is well-formed.** Treat it as the source of defaults the user can accept by hitting Enter on later prompts. Continue to the preflight scan below.

**Branch B — File exists but is malformed** (parse fails, or required keys missing). Print: `Found adhd.config.ts but could not parse it. The wizard will re-create it from scratch; existing values will not be used as defaults.` Continue without defaults.

**Branch C — File does not exist.** Continue without defaults.

### PAT-leak preflight (always runs in Branches A and B)

Before parsing the config for defaults, scan the raw source text of `adhd.config.ts` for anything that looks like a literal Figma PAT. Run two regex checks against the file's text:

1. `figd_[A-Za-z0-9_-]+` — Figma's standard PAT prefix; strongest signal.
2. Any string longer than 24 characters assigned to a key literally named `pat`, `token`, or `secret`. (Heuristic: match `(pat|token|secret)\s*:\s*"[^"]{24,}"`.)

If either matches, **abort the wizard immediately** with this exact message:

```
Looks like a Figma PAT is committed to adhd.config.ts. This is a credential leak.

Remove it from the config and store it as FIGMA_PAT in either:
  • .env.local in the repo root (gitignored), or
  • your shell environment (e.g., export FIGMA_PAT=... in ~/.zshrc).

Then re-run /adhd:config.
```

Do not proceed to Phase 1.

### Parse defaults (Branch A only)

For Branch A, extract these fields with targeted regex (the file is a plain TypeScript literal, no imports):
- `leader:` → string, expected `"code"` or `"figma"`
- `figma.url:` → string
- `figma.pat:` (optional) → string env var name
- `domains:` (optional) → array of strings
- `cssEntry:` (optional) → string path

Pass these forward as defaults for Phases 1, 2, 3, 4, and 5.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 0 to /adhd:config: detect existing config and PAT-leak preflight"
```

---

## Task 3: Phase 1 — Leader prompt

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 1` section)

- [ ] **Step 1: Fill in Phase 1 instructions**

Replace the `## Phase 1: Leader` heading and (empty) body with:

````markdown
## Phase 1: Leader

Use `AskUserQuestion` with a single multiple-choice question:

```
Question: "Which side should win on conflict?"
Header: "Leader"
Options:
  - label: "code", description: "This codebase is canonical. Sync pushes changes to Figma."
  - label: "figma", description: "Figma is canonical. Sync pulls changes into globals.css."
```

Default selection: the existing `leader` value from Phase 0 if present; otherwise no default.

Save the answer as `leader`. The value is one of `"code"` or `"figma"`. Both are fully supported by this wizard. (Note: as of Plan 1 of the implementation, the actual code → Figma apply path in `/adhd:sync` is still being built — Plan 2. The wizard saves `leader: "code"` correctly today; sync will surface a clear "apply path not yet implemented" message until Plan 2 lands.)
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 1 to /adhd:config: leader prompt"
```

---

## Task 4: Phase 2 — Domains multi-select

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 2` section)

- [ ] **Step 1: Fill in Phase 2 instructions**

Replace the `## Phase 2: Domains` heading and (empty) body with:

````markdown
## Phase 2: Domains

Use `AskUserQuestion` with a single multi-select question:

```
Question: "Which token domains should ADHD sync? (Default: all five.)"
Header: "Domains"
multiSelect: true
Options:
  - label: "colors", description: "Color primitives and semantic role aliases."
  - label: "spacing", description: "Spacing scale (--spacing-1, --spacing-4, etc.)."
  - label: "typography", description: "Font families, sizes, weights, line heights."
  - label: "radius", description: "Border-radius scale."
  - label: "shadow", description: "Box-shadow scale."
```

Default selection: the existing `domains` array from Phase 0 if present; otherwise all five selected.

**Storage rule:** if all five domains are selected, **do not write a `domains` field** to `adhd.config.ts` — its absence means "all". Only write the array if a strict subset is selected. Save the user's selection in memory as `domainsSelection` (an array of 1–5 strings); Phase 6 decides whether to write it.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 2 to /adhd:config: domains multi-select"
```

---

## Task 5: Phase 3 — Figma URL + reachability

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 3` section)

- [ ] **Step 1: Fill in Phase 3 instructions**

Replace the `## Phase 3: Figma URL + reachability` heading and (empty) body with:

````markdown
## Phase 3: Figma URL + reachability

Use `AskUserQuestion` with a free-text question (or, if `AskUserQuestion` does not support free text, instruct the user to paste a URL in chat):

```
Question: "Paste the URL of your Figma file (must look like https://www.figma.com/design/<key>/<name>)."
Header: "Figma URL"
```

Default value: the existing `figma.url` from Phase 0 if present; otherwise no default.

**Validation step 1 — format.** Match the entered value against `^https://www\.figma\.com/design/[^/]+/`. If the format is wrong, print:

```
That doesn't look like a Figma file URL. Expected format:
  https://www.figma.com/design/<key>/<name>

(Tip: open your file in Figma, then copy the URL from the address bar.)
```

Re-prompt.

**Validation step 2 — reachability.** Extract the file key — it's the path segment immediately after `/design/`. Call `mcp__figma__get_metadata` with that file key. Three failure cases:

- **Authentication error** (the MCP returns "not authenticated" or similar): abort with `Figma MCP is not authenticated. Run the Figma MCP auth flow per Figma's docs, then re-run /adhd:config.` Do NOT save the URL.
- **404 / not found:** print `Cannot reach the Figma file at that URL. Verify the URL is correct and that you have access. Re-prompt to paste a different URL.` Re-prompt.
- **Other error** (network, timeout): print the error and re-prompt.

On success (200 with metadata), save the URL.

This phase **does not** validate that the Figma file has the mandated structure (Primitives / Semantic collections, Light/Dark modes, kebab-case naming). That validation is `/adhd:sync`'s job — running it here would slow the wizard and duplicate logic.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 3 to /adhd:config: Figma URL + reachability test"
```

---

## Task 6: Phase 4 — PAT setup

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 4` section)

- [ ] **Step 1: Fill in Phase 4 instructions**

Replace the `## Phase 4: PAT setup (only when leader = code)` heading and (empty) body with:

````markdown
## Phase 4: PAT setup (only when leader = code)

Skip this entire phase if `leader === "figma"`.

Resolve the env var name: `envVarName = config.figma.pat ?? "FIGMA_PAT"`. Phase 0 may have given you `config.figma.pat`; if not, use the default.

### Detection cascade

Try each source in order, stopping at the first hit. Track the **source** (shell, file path, or "absent") for use later.

1. **Shell environment.** Run `Bash` with: `printenv "$ENV_VAR_NAME"` (substituting the actual name). If exit code 0 and stdout is non-empty, source = `"shell"`, value = stdout.
2. **`.env*` files in the repo root**, in this order: `.env.local`, `.env.development.local`, `.env`. For each, `Read` the file (skip if it doesn't exist). Parse for a line matching `^<envVarName>=(.+)$` (allow optional surrounding quotes). First match wins; source = the file path; value = the captured value.
3. **Not found anywhere.** source = `"absent"`, no value.

### If a value was found: validate

Use `WebFetch` against `https://api.figma.com/v1/files/<KEY>/variables/local`, where `<KEY>` is the file key from Phase 3. **`WebFetch` does not support custom headers**, so fall back to `Bash` with `curl`:

```bash
curl -sS -o /tmp/adhd-pat-check.json -w "%{http_code}" \
  -H "X-FIGMA-TOKEN: <VALUE>" \
  "https://api.figma.com/v1/files/<KEY>/variables/local"
```

(Substitute `<VALUE>` and `<KEY>` from runtime; treat the value as untrusted shell input — single-quote it.)

Interpret the HTTP status code:

- **200:** token works, user is on Enterprise, has access. Save the env var name (in memory) for Phase 6's decision on whether to write `figma.pat` to the config. Continue to Phase 5.
- **401:** token is invalid. Print `Your Figma PAT was rejected (HTTP 401 — invalid token). Let's enter a fresh one.` and proceed to "Prompt for a new token" below. Note the source: if it was a `.env*` file, the wizard will overwrite that line; if it was the shell, the wizard will ask the user to update their shell rc and re-run.
- **403:** token doesn't have access (wrong plan or scope). Print:
  ```
  Your token does not have access to Figma's Variables API (HTTP 403).

  This API is gated to Figma Enterprise plans with Full seat. Options:
    1. Upgrade your Figma plan and create a new PAT with file_variables:write scope.
    2. Enter a different token that has access.
    3. Cancel and switch leader to "figma" (re-run /adhd:config).
  ```
  Then ask:
  ```
  AskUserQuestion: "What would you like to do?"
  Header: "PAT 403"
  Options:
    - "Enter a different PAT now"
    - "Cancel — I'll fix this and re-run /adhd:config later"
  ```
  On "Enter a different PAT now", proceed to "Prompt for a new token" below. On cancel, abort the wizard.
- **404:** file key wrong (shouldn't happen — Phase 3 already validated reachability). Print `Internal: file key validated in Phase 3 but rejected by REST API. Re-running Phase 3.` and re-run Phase 3.
- **Other (5xx, network, timeout):** print the error and re-prompt.

### Prompt for a new token

If detection found nothing OR validation failed and the user wants to retry:

```
AskUserQuestion: "Paste your Figma personal access token (or 'cancel' to abort)."
Header: "Figma PAT"
```

(Free-text. Mask if the host UI supports masking; otherwise paste-in-chat is acceptable.)

If the user cancels, abort the wizard.

**Where to write:**
- If detection-source was a `.env*` file: rewrite that file in place — find the existing `<envVarName>=...` line and replace its value, preserving surrounding lines.
- If detection-source was the shell: print:
  ```
  The token in your shell environment ($ENV_VAR_NAME) is invalid, and /adhd:config can't safely edit your shell rc files.

  Update your shell environment manually (e.g., edit ~/.zshrc or ~/.bashrc), then re-run /adhd:config.
  ```
  Abort the wizard.
- If detection-source was "absent": append a new line to `.env.local` in the repo root.
  - If `.env.local` doesn't exist, create it.
  - The line is: `<envVarName>=<value>` (no quotes around the value unless it contains spaces — Figma PATs do not).
  - After writing, ensure `.env.local` is in `.gitignore`. Read `.gitignore`; if `.env.local` (or `.env*`) is not present, append `.env.local` on its own line.

After writing, re-run the validation step against the new value. Loop until it returns 200 or the user cancels.

### Save state for Phase 6

Track:
- `envVarName` — the name (e.g., `"FIGMA_PAT"`).
- Whether `envVarName !== "FIGMA_PAT"` — if so, Phase 6 writes `figma.pat: "<envVarName>"` to the config; otherwise it does not.
- Whether `.env.local` was created or modified — Phase 7 reports it.
- Whether `.gitignore` was modified — Phase 7 reports it.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 4 to /adhd:config: PAT detection cascade and validation"
```

---

## Task 7: Phase 5 — cssEntry auto-detect

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 5` section)

- [ ] **Step 1: Fill in Phase 5 instructions**

Replace the `## Phase 5: cssEntry auto-detect` heading and (empty) body with:

````markdown
## Phase 5: cssEntry auto-detect

Try the two conventional Next.js paths, in order. Use `Bash` with `[ -f <path> ] && echo present || echo absent` per path.

1. `app/globals.css`
2. `src/app/globals.css`

Four cases:

- **Only `app/globals.css` exists:** save `cssEntry = "app/globals.css"`. This is the default — do NOT write a `cssEntry` field to the config.
- **Only `src/app/globals.css` exists:** save `cssEntry = "src/app/globals.css"`. Phase 6 writes it explicitly.
- **Both exist:** prefer `app/globals.css` and print `Both app/globals.css and src/app/globals.css exist. Using app/globals.css. Edit adhd.config.ts manually if you want to use the other.` Do NOT write a `cssEntry` field.
- **Neither exists:** prompt the user.
  ```
  AskUserQuestion: "Where does this project's Tailwind CSS entry file live?"
  Header: "CSS entry"
  ```
  (Free-text path relative to the repo root.) Validate that the path exists with `[ -f <path> ]`. Re-prompt on miss. On hit, save the path; if it equals `app/globals.css`, do NOT write a `cssEntry` field.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 5 to /adhd:config: cssEntry auto-detect"
```

---

## Task 8: Phase 6 — Write adhd.config.ts

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 6` section)

- [ ] **Step 1: Fill in Phase 6 instructions**

Replace the `## Phase 6: Write adhd.config.ts` heading and (empty) body with:

````markdown
## Phase 6: Write adhd.config.ts

Compose the config object from in-memory state. Always include `leader` and `figma.url`. Conditionally include the rest:

| Field | Include if |
|---|---|
| `figma.pat` | `envVarName !== "FIGMA_PAT"` |
| `domains` | `domainsSelection` is a strict subset (length 1–4) |
| `cssEntry` | resolved path is NOT `app/globals.css` |

Render the file body using this template (omit lines marked optional when their condition is false):

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

When omitting an optional field, also drop the corresponding `// optional:` placeholder comment — the file should not carry hints about fields that aren't present.

### Show the change before writing

- **Creating from scratch** (Phase 0 was Branch B or C): print the full new file content fenced as `ts`. Then ask:
  ```
  AskUserQuestion: "Write this content to adhd.config.ts?"
  Header: "Confirm write"
  Options: ["Yes — write it", "No — abort"]
  ```
- **Updating an existing file** (Phase 0 was Branch A): produce a unified diff between the existing file and the new content (use `Bash` with `diff -u <existing> <new>` via temp file, or compute manually). Print the diff fenced as `diff`. Then ask the same confirm question.

On "No", abort. On "Yes", `Write` the file.

### .env.local / .gitignore

Phase 4 may have already written `.env.local` and updated `.gitignore`. Don't re-do those writes here; this phase touches only `adhd.config.ts`.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 6 to /adhd:config: write adhd.config.ts (with diff confirm)"
```

---

## Task 9: Phase 7 — Report

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the `## Phase 7` section)

- [ ] **Step 1: Fill in Phase 7 instructions**

Replace the `## Phase 7: Report` heading and (empty) body with:

````markdown
## Phase 7: Report

Print a summary of what was done. Tailor to the actual operations:

```
Config saved to adhd.config.ts.

Leader: <LEADER>
Figma:  <URL>
Domains: <"all" or comma-separated list>
CSS:    <"app/globals.css (default)" or the explicit path>
PAT:    <"loaded from <source>" or "n/a (leader=figma)">

[If .env.local was created or modified:]
Wrote FIGMA_PAT to .env.local.
[If .gitignore was modified:]
Added .env.local to .gitignore.

Next: run /adhd:sync --dry-run to preview your first diff.
```

Substitute the actual values in angle brackets. If running on a healthy config that didn't change, print `Config unchanged.` instead of the saved-to message.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add Phase 7 to /adhd:config: final report"
```

---

## Task 10: Reference sections

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md` (the two `## Reference` sections)

- [ ] **Step 1: Fill in the Common errors and Schema reference sections**

Replace the two empty Reference headings with:

````markdown
## Reference: Common errors and fix-up guidance

### "Looks like a Figma PAT is committed to adhd.config.ts"
The preflight scan found a string that looks like a Figma personal access token in your config. Tokens never go in `adhd.config.ts` (it's tracked in git). Move the token to `.env.local` (gitignored) or your shell rc, then re-run.

### "Figma MCP is not authenticated"
The Figma MCP needs to be authenticated for the wizard to test reachability. Run the Figma MCP auth flow per Figma MCP documentation, then retry.

### "Cannot reach the Figma file"
The URL is well-formed but Figma returned 404 or no metadata. Confirm the URL is correct (copy from your browser's address bar), and that your authenticated MCP user has access to the file.

### "Your Figma PAT was rejected (HTTP 401)"
The token in `process.env.FIGMA_PAT` (or the customized env var) is invalid. The wizard will prompt for a fresh one. If the token came from your shell environment, the wizard cannot edit your shell rc — you'll need to update it manually.

### "Your token does not have access to Figma's Variables API (HTTP 403)"
Figma's variable read/write REST endpoints are gated to Enterprise plans with Full seat. Options: upgrade your Figma plan, generate a new token with `file_variables:write` scope, or switch `leader` to `"figma"` and use only the read-side MCP path.

### "figma.pat must be the NAME of an env var"
You set `figma.pat` to a value that doesn't look like an env var name (kebab-case, lowercase letters, or longer than ~30 chars). Set it to a name like `FIGMA_PAT` or `MY_TEAM_FIGMA_TOKEN`, and put the actual token value in `.env.local` or your shell.

## Reference: adhd.config.ts schema

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

`figma.pat` stores the **name** of the environment variable holding the token. The token value lives in `process.env[<name>]`, populated by your shell or by `.env.local` / `.env.development.local` / `.env` (loaded in that priority order).

The wizard never writes the token itself to `adhd.config.ts`. The PAT-leak preflight (Phase 0) actively blocks any commit that does.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "Add reference sections to /adhd:config: common errors + schema"
```

---

## Task 11: Sync skill edits

**Files:**
- Modify: `plugins/adhd/skills/sync/SKILL.md`

- [ ] **Step 1: Add PAT-leak preflight to Phase 1.1**

Find the section `### 1.1 Read and validate adhd.config.ts` in `plugins/adhd/skills/sync/SKILL.md`. Before the existing line `Use the Read tool on adhd.config.ts at the repo root.`, insert the preflight scan:

```markdown
- **PAT-leak preflight (runs first).** Before parsing for fields, scan the source text of `adhd.config.ts` with two regex checks:
  1. `figd_[A-Za-z0-9_-]+` — Figma PAT prefix.
  2. `(pat|token|secret)\s*:\s*"[^"]{24,}"` — long opaque value assigned to a credential-named key.

  On match, abort with the credential-leak message:

  ```
  ADHD sync cannot proceed.

  Reason:    Looks like a Figma PAT is committed to adhd.config.ts. This is a credential leak.
  Next step: Remove it from the config and store it as FIGMA_PAT in either .env.local
             (gitignored) or your shell environment. Then run /adhd:config.
  ```
```

- [ ] **Step 2: Add `figma.pat` shape check to schema validation in 1.1**

In the same `### 1.1` section, find the bulleted validate block (the one that lists `leader is exactly...`, `figma.url matches...`, etc.). Add a new bullet for `figma.pat`:

```markdown
  - `figma.pat` (if present) matches `^[A-Z][A-Z0-9_]*$`. If it contains lowercase letters, special chars beyond underscore, or is longer than ~30 chars, abort with: `figma.pat must be the NAME of an env var (e.g., "FIGMA_PAT"), not the token itself. Set figma.pat to a name and put the token in .env.local or your shell environment.`
```

- [ ] **Step 3: Update the `leader: "code"` abort message**

Find the existing block that starts `**v1 limitation — leader: "code" is not yet supported.**` in the 1.1 section. Replace the entire block with:

```markdown
**`leader: "code"` apply path** — the code → Figma push apply phase is being implemented in a separate plan (`docs/superpowers/plans/2026-05-09-adhd-config-hybrid-writes.md`, forthcoming). Until that plan lands, abort with:

```
ADHD sync cannot proceed.

Reason:    leader: "code" is configured, but the apply path is still being built (Plan 2 of the
           ADHD config + hybrid-writes spec). Phase 1 validation has succeeded — your config and
           PAT are correct.
Next step: For now, switch leader to "figma" via /adhd:config to use the pull-from-Figma path.
           Or wait for Plan 2 to ship the code→Figma writes engine.
```
```

- [ ] **Step 4: Restructure existing Phase 1 errors to the "Reason / Next step" format**

Walk through Phase 1 (sections 1.1, 1.2, 1.3, 1.4, 1.5) and rewrite each abort message to use this format:

```
ADHD sync cannot proceed.

Reason:    <one-line specific issue>
Next step: <one of: Run /adhd:config to fix. | Run the Figma MCP auth flow. | Fix the Figma file: <issue>.>
```

Routing rules (mirrors the spec):

- `adhd.config.ts` missing → `Next step: Run /adhd:config to fix.`
- Schema mismatch (any field) → `Run /adhd:config to fix.`
- `figma.pat` shape failure → `Run /adhd:config to fix.`
- `cssEntry` (or default `app/globals.css`) missing → `Run /adhd:config to fix.`
- Figma URL 404 → `Run /adhd:config to fix.`
- Figma MCP not authenticated → `Run the Figma MCP auth flow per Figma's docs.`
- Figma file structure non-compliant → `Fix the Figma file: <specific issue>.`
- `leader: "code"` (the new abort) → uses the dedicated message from Step 3.

Do not change the validation LOGIC — only the output formatting. Each existing abort line becomes the `Reason:` line; each existing fix-up hint becomes the `Next step:` line.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/skills/sync/SKILL.md
git commit -m "Update /adhd:sync Phase 1: PAT-leak preflight, figma.pat check, leader=code message, error format"
```

---

## Task 12: Acceptance walkthrough

This is the final validation gate. Each scenario corresponds to one or more acceptance criteria in `docs/superpowers/specs/2026-05-09-adhd-config-design.md`. Execute each scenario in order; if any fails, fix the underlying skill markdown and re-run the failing scenario before proceeding.

For each scenario, **before running**, ensure the working tree is clean (no uncommitted changes), then perform the listed setup. After verifying expected behavior, restore baseline state for the next scenario.

- [ ] **Step 1: Scenario 1 — fresh repo, leader=figma (AC 1)**

Setup:
```bash
git stash --include-untracked   # park any working changes
rm -f adhd.config.ts             # ensure no config exists
```

Run `/adhd:config`. Inputs: leader=`figma`, all five domains selected, paste a real Figma URL you have access to.

Expected outcome:
- Wizard completes through Phase 7.
- New `adhd.config.ts` exists.
- File contains `leader: "figma"` and `figma.url: "..."`.
- File does NOT contain `domains`, `cssEntry`, or `figma.pat` keys.
- No `.env.local` was created.

Verify: `cat adhd.config.ts` and `ls .env.local 2>&1` (the latter should print "No such file").

Then run `/adhd:sync --dry-run`. Phase 1 should pass; Phase 4 displays a diff (or "no changes").

Cleanup:
```bash
rm adhd.config.ts
git stash pop
```

- [ ] **Step 2: Scenario 2 — fresh repo, leader=code, PAT in shell (AC 2)**

Setup:
```bash
git stash --include-untracked
rm -f adhd.config.ts
rm -f .env.local
export FIGMA_PAT=<a real Enterprise PAT you have>
```

Run `/adhd:config`. Inputs: leader=`code`, all domains, valid URL.

Expected outcome:
- Wizard detects `FIGMA_PAT` from the shell.
- Validation against `https://api.figma.com/v1/files/<key>/variables/local` returns 200.
- `adhd.config.ts` is written with `leader: "code"` and `figma.url`. No `figma.pat` field (default name in use).
- `.env.local` is NOT created.

Verify: `cat adhd.config.ts`, `[ ! -f .env.local ] && echo "no .env.local"`.

Cleanup:
```bash
rm adhd.config.ts
unset FIGMA_PAT
git stash pop
```

- [ ] **Step 3: Scenario 3 — fresh repo, leader=code, PAT prompted (AC 2 part 2)**

Setup:
```bash
git stash --include-untracked
rm -f adhd.config.ts .env.local
unset FIGMA_PAT
```

Run `/adhd:config`. Inputs: leader=`code`, all domains, valid URL, paste a real PAT when prompted.

Expected outcome:
- Wizard detects nothing in Phase 4's cascade.
- Wizard prompts for a PAT.
- After paste, validation hits 200.
- `.env.local` is created at the repo root containing `FIGMA_PAT=<value>`.
- `.gitignore` contains `.env.local` (added if it wasn't already).
- `adhd.config.ts` written with no `figma.pat` field.

Verify:
```bash
cat .env.local                  # should show FIGMA_PAT=...
grep -E '^\.env\.local' .gitignore   # should match
cat adhd.config.ts
```

Cleanup:
```bash
rm adhd.config.ts .env.local
git checkout .gitignore         # revert any wizard-added line
git stash pop
```

- [ ] **Step 4: Scenario 4 — update existing config (AC 3)**

Setup: leave Scenario 1's `adhd.config.ts` in place (or recreate it as in Scenario 1 with leader=`figma`).

Run `/adhd:config` again. Inputs: change leader to `code`, deselect `shadow` from domains, keep URL. PAT setup runs (paste a PAT or rely on shell env).

Expected outcome:
- Phase 0 detects existing config, treats values as defaults.
- Phase 6 prints a unified diff before writing.
- Final config has `leader: "code"`, `domains: ["colors", "spacing", "typography", "radius"]`, same URL.

Verify: `cat adhd.config.ts`.

Cleanup:
```bash
rm adhd.config.ts
[ -f .env.local ] && rm .env.local
git checkout .gitignore 2>/dev/null
```

- [ ] **Step 5: Scenario 5 — domains subset round-trip (AC 4)**

Setup:
```bash
rm -f adhd.config.ts
```

Run `/adhd:config`. Inputs: leader=`figma`, deselect `radius` and `shadow`, valid URL.

Expected outcome: `adhd.config.ts` contains `domains: ["colors", "spacing", "typography"]`.

Then run `/adhd:sync --dry-run`. Sync should respect the subset (only diffs colors/spacing/typography).

Cleanup: `rm adhd.config.ts`.

- [ ] **Step 6: Scenario 6 — PAT-leak preflight (AC 5)**

Setup: write a deliberately bad config:
```bash
cat > adhd.config.ts <<'EOF'
const config = {
  leader: "code" as const,
  figma: {
    url: "https://www.figma.com/design/abc/Test",
    pat: "figd-EXAMPLE-PAT-REDACTED",
  },
};
export default config;
EOF
```

Run `/adhd:config`. Expected outcome:
- Wizard aborts in Phase 0 with the credential-leak message (the multi-line one referencing `.env.local` and shell rc).
- `adhd.config.ts` is unchanged.

Then run `/adhd:sync --dry-run`. Expected: same abort, in the new "Reason / Next step" format.

Cleanup: `rm adhd.config.ts`.

- [ ] **Step 7: Scenario 7 — `figma.pat` shape check (AC 6)**

Setup:
```bash
cat > adhd.config.ts <<'EOF'
const config = {
  leader: "figma" as const,
  figma: {
    url: "https://www.figma.com/design/abc/Test",
    pat: "actuallyMyToken_figd_definitelyNotAName",
  },
};
export default config;
EOF
```

Run `/adhd:sync --dry-run`. Expected outcome:
- Sync's Phase 1.1 fires the shape check (NOT the leak preflight, because the value doesn't match the leak regex — it lacks the `figd_` prefix as a standalone match).
  - Note: if the test value happens to contain `figd_`, the leak preflight will fire first. That's also acceptable behavior — the leak check is the stronger guard. Just confirm one of the two messages appears.
- `adhd.config.ts` is unchanged.

Cleanup: `rm adhd.config.ts`.

- [ ] **Step 8: Scenario 8 — unreachable URL (AC 7)**

Setup: `rm -f adhd.config.ts`.

Run `/adhd:config`. Inputs: leader=`figma`, paste an obviously bad URL like `https://www.figma.com/design/notARealKey/Nope`.

Expected outcome:
- Phase 3 calls `mcp__figma__get_metadata`, which returns 404 / not found.
- Wizard prints the "cannot reach" error and re-prompts for the URL.
- Re-prompting with a real URL completes the wizard normally.

Cleanup: `rm adhd.config.ts`.

- [ ] **Step 9: Scenario 9 — custom `figma.pat` env var name (AC 8)**

Setup: write a config that uses a custom env var name:
```bash
cat > adhd.config.ts <<'EOF'
const config = {
  leader: "code" as const,
  figma: {
    url: "<a real URL>",
    pat: "FIGMA_API_TOKEN",
  },
};
export default config;
EOF
export FIGMA_API_TOKEN=<a real Enterprise PAT>
```

Run `/adhd:config` (it'll detect the existing config and re-run; you can accept all defaults to no-op). Then run `/adhd:sync --dry-run`.

Expected outcome:
- Wizard's PAT detection in Phase 4 reads `process.env.FIGMA_API_TOKEN`, NOT `process.env.FIGMA_PAT`.
- Sync's leader=code abort fires (Plan 2 message), confirming the PAT was accepted as part of validation.
- If you `unset FIGMA_API_TOKEN` and re-run sync, you get a missing-PAT abort that names `FIGMA_API_TOKEN` (not `FIGMA_PAT`).

Cleanup:
```bash
rm adhd.config.ts
unset FIGMA_API_TOKEN
```

- [ ] **Step 10: Scenario 10 — sync error routing format (AC 9)**

For each of these abort triggers, set up state and run `/adhd:sync --dry-run`. Confirm output uses the format:

```
ADHD sync cannot proceed.

Reason:    <something>
Next step: <something>
```

Triggers:
1. No `adhd.config.ts` → `Next step: Run /adhd:config to fix.`
2. Bad `leader` value (e.g., `leader: "frodo"`) → `Run /adhd:config to fix.`
3. Bad URL format → `Run /adhd:config to fix.`
4. `cssEntry: "no/such/file.css"` → `Run /adhd:config to fix.`
5. Figma file structure problem (point at a Figma file with a `Semantic` collection that has 3 modes, if you have one; otherwise mock by editing `mcp__figma__get_variable_defs` results — skip if not feasible) → `Fix the Figma file: <issue>.`

Cleanup after each: restore baseline.

- [ ] **Step 11: Final review and commit if any markdown was tweaked**

If you fixed any skill markdown during this walkthrough, the changes are already committed under earlier task commits. If you fixed nothing, this step is a no-op.

Print: `Acceptance walkthrough complete. /adhd:config wizard ready for use; /adhd:sync routes config-fixable errors to it. leader=code remains aborted with a Plan 2 forthcoming message.`

---

## Self-review

**Spec coverage:** every acceptance criterion 1–9 from the spec has a corresponding scenario in Task 12. AC 10–14 are Plan 2 territory and intentionally not covered here — the abort message in sync (Task 11 Step 3) is the placeholder.

**Placeholder scan:** no TBD/TODO/"add appropriate handling" remain. Each task contains the exact text to write.

**Type / signature consistency:** the wizard saves `envVarName` (Phase 4) → consumed by Phase 6 (decides whether to write `figma.pat`) → consumed by Phase 7 (reports). Field names match: `figma.pat` in the schema ↔ `figma.pat` in sync's validation ↔ `figma.pat` in error messages.

**File / commit count sanity:** 12 tasks, 23 commits expected (each task has one commit; Task 11 has one commit covering all sub-edits). One file created, one file modified.

