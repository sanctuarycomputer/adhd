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
2. Any string longer than 30 characters assigned to a key literally named `pat`, `token`, or `secret`. (Heuristic: match `(pat|token|secret)\s*:\s*"[^"]{30,}"`.) If the matched value also satisfies `^[A-Z][A-Z0-9_]*$` (i.e., it looks like an env var name), skip this heuristic — it's a long but valid name, not a token.

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
- `figma.url:` → string
- `domains:` (optional) → array of strings
- `cssEntry:` (optional) → string path

Pass these forward as defaults for Phases 1, 2, and 3.

## Phase 1: Domains

> **Tool note:** `AskUserQuestion` accepts 2–4 options and does not support multi-select with 5+ items or free-text input. ADHD has five supported domains, so this phase uses a two-step prompt: a binary `AskUserQuestion` first, then a chat-based subset list when needed.

**Step 1 — All-or-subset choice.** Use `AskUserQuestion`:

```
Question: "Sync all five domains (colors, spacing, typography, radius, shadow), or pick a subset?"
Header: "Domains"
Options:
  - label: "All five (default)", description: "Recommended. The wizard omits the `domains` field so future additions are picked up automatically."
  - label: "Pick a subset", description: "Restrict ADHD to specific domains. You'll be prompted in chat to type the subset as a comma-separated list."
```

Default selection: if the existing `domains` array from Phase 0 is present and is a strict subset, default to "Pick a subset"; otherwise default to "All five".

**Step 2 — Subset entry (only if user picked "Pick a subset").** Drop to a chat prompt:

```
Type the comma-separated subset of domains you want (from: colors, spacing, typography, radius, shadow).

Examples: `colors,spacing` — `colors,spacing,typography` — `radius,shadow`.

Or say "all" to keep the default; "abort" to exit the wizard.
```

Wait for the user's next chat message. Parse it:

- Trim whitespace, lowercase, split on commas.
- If the result is `["all"]`, treat as if the user picked "All five" in Step 1 — proceed accordingly.
- If the input is `"abort"`, exit the wizard.
- Validate each token against the supported set (`colors`, `spacing`, `typography`, `radius`, `shadow`). If ANY token is unrecognized, print which token failed and re-prompt with the same chat message.
- If the parsed subset has length 5, treat as "All five".

**Storage rule:** if the final selection is all five, **do not write a `domains` field** to `adhd.config.ts` — its absence means "all". Only write the array if a strict subset (length 1–4) is selected. Save the selection in memory as `domainsSelection` (an array of 1–5 strings); Phase 4 decides whether to write it.

## Phase 2: Figma URL + reachability

> **Tool note:** `AskUserQuestion` does not support free-text input. The URL itself must be pasted into chat. When an existing URL is available from Phase 0, this phase uses `AskUserQuestion` first (keep / replace / abort), and only drops to chat if the user picks "replace".

**Step 1 — Existing URL handling.** If Phase 0 (Branch A) provided an existing `figma.url`, AND that URL is not a placeholder (does not contain `REPLACE_WITH` or similar template markers), use `AskUserQuestion`:

```
Question: "Use the Figma URL already in your config?"
Header: "Figma URL"
Options:
  - label: "Keep existing", description: "<existing URL>"
  - label: "Enter a different URL", description: "Replace with a new URL via chat."
  - label: "Abort", description: "Stop the wizard. No changes made."
```

On "Keep existing" → skip to Validation step 2 below using the existing value.
On "Enter a different URL" → continue to Step 2.
On "Abort" → exit the wizard.

If Phase 0 did not provide an existing URL, OR the existing value is a placeholder, skip Step 1 and go directly to Step 2.

**Step 2 — URL entry.** Drop to a chat prompt:

```
Paste the URL of your Figma file (must look like https://www.figma.com/design/<key>/<name>).

Or say "abort" to exit the wizard.
```

Wait for the user's next chat message. If it's `"abort"`, exit. Otherwise treat the message as the URL and continue to Validation.

**Validation step 1 — format.** Match the entered value against `^https://www\.figma\.com/design/[^/]+/`. If the format is wrong, print:

```
That doesn't look like a Figma file URL. Expected format:
  https://www.figma.com/design/<key>/<name>

(Tip: open your file in Figma, then copy the URL from the address bar.)
```

Then re-issue the chat prompt from Step 2 and wait for the user's next message.

**Validation step 2 — reachability.** Extract the file key — it's the path segment immediately after `/design/`. Call `mcp__figma__get_metadata` with that file key. Three failure cases:

- **Authentication error** (the MCP returns "not authenticated" or similar): abort with `Figma MCP is not authenticated. Run the Figma MCP auth flow per Figma's docs, then re-run /adhd:config.` Do NOT save the URL.
- **404 / not found:** print `Cannot reach the Figma file at that URL. Verify the URL is correct and that you have access.` Then re-issue the chat prompt from Step 2.
- **Other error** (network, timeout): print the error and re-issue the chat prompt from Step 2.

On success (200 with metadata), save the URL.

This phase **does not** validate that the Figma file has the mandated structure (Primitives / Semantic collections, Light/Dark modes, kebab-case naming). That validation is `/adhd:sync`'s job — running it here would slow the wizard and duplicate logic.

## Phase 3: cssEntry auto-detect

Try the two conventional Next.js paths, in order. Use `Bash` with `[ -f <path> ] && echo present || echo absent` per path.

1. `app/globals.css`
2. `src/app/globals.css`

Four cases:

- **Only `app/globals.css` exists:** save `cssEntry = "app/globals.css"`. This is the default — do NOT write a `cssEntry` field to the config.
- **Only `src/app/globals.css` exists:** save `cssEntry = "src/app/globals.css"`. Phase 4 writes it explicitly.
- **Both exist:** prefer `app/globals.css` and print `Both app/globals.css and src/app/globals.css exist. Using app/globals.css. Edit adhd.config.ts manually if you want to use the other.` Do NOT write a `cssEntry` field.
- **Neither exists:** drop to a chat prompt (free-text — `AskUserQuestion` does not support free-text input).
  ```
  Where does this project's Tailwind CSS entry file live?

  Type a path relative to the repo root (e.g., `styles/globals.css`), or say "abort" to exit.
  ```
  Wait for the user's next chat message. If it's `"abort"`, exit the wizard. Otherwise validate the path exists via `Bash` with `[ -f <path> ]`. Re-issue the chat prompt on miss. On hit, save the path; if it equals `app/globals.css`, do NOT write a `cssEntry` field.

## Phase 4: Write adhd.config.ts

Compose the config object from in-memory state. Always include `leader` and `figma.url`. Conditionally include the rest:

| Field | Include if |
|---|---|
| `domains` | `domainsSelection` is a strict subset (length 1–4) |
| `cssEntry` | resolved path is NOT `app/globals.css` |

Render the file body using this template (omit lines marked optional when their condition is false):

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

## Phase 5: Report

Print a summary of what was done. Tailor to the actual operations:

```
Config saved to adhd.config.ts.

Figma:   <URL>
Domains: <"all" or comma-separated list>
CSS:     <"app/globals.css (default)" or the explicit path>

<NEXT_STEP>
```

Substitute the actual values in angle brackets. The `<NEXT_STEP>` line is always:

```
Next: run /adhd:export-for-figma to produce the DTCG JSON file you'll
import into Figma via TokensBrücke (or any DTCG-compatible plugin).
Then run /adhd:sync --dry-run to preview your first diff (Figma → code).
```

If running on a healthy config that didn't change, print `Config unchanged.` instead of the saved-to message.

## Reference: Common errors and fix-up guidance

### "Looks like a Figma PAT is committed to adhd.config.ts"
The preflight scan found a string that looks like a Figma personal access token in your config. Tokens never go in `adhd.config.ts` (it's tracked in git). Move the token to `.env.local` (gitignored) or your shell rc, then re-run.

### "Figma MCP is not authenticated"
The Figma MCP needs to be authenticated for the wizard to test reachability. Run the Figma MCP auth flow per Figma MCP documentation, then retry.

### "Cannot reach the Figma file"
The URL is well-formed but Figma returned 404 or no metadata. Confirm the URL is correct (copy from your browser's address bar), and that your authenticated MCP user has access to the file.

## Reference: adhd.config.ts schema

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

The schema is read by `/adhd:config`, `/adhd:sync`, and `/adhd:export-for-figma`. No fields hold credentials — the PAT-leak preflight (Phase 0) actively blocks any commit that puts a token in this file.
