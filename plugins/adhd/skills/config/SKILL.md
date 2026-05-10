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
