---
description: "Run the ADHD config wizard. Walks through producing or repairing adhd.config.ts: Figma URL (with reachability test), naming convention, and CSS entry path auto-detect. ADHD always syncs every domain we support — the wizard no longer asks the user to pick."
disable-model-invocation: true
allowed-tools: Read Edit Write Bash AskUserQuestion mcp__plugin_figma_figma__whoami mcp__plugin_figma_figma__get_metadata WebFetch
---

# ADHD Config

You are running the ADHD config wizard. ADHD ("agent-driven harmonious development") keeps design tokens synchronized between this Tailwind v4 codebase and a Figma file. This skill produces a valid `adhd.config.ts`. Authentication to Figma is handled entirely by the official Figma plugin (`figma@claude-plugins-official`) — ADHD never reads or writes credentials.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-config-design.md` — read it if you need detail beyond what this skill provides.

The wizard is **linear**. Each phase prompts at most once, validates, and either proceeds or stops with a clear error. After the wizard completes, the user runs `/adhd:sync --dry-run` separately. The wizard never invokes sync.

## Phase 0: Detect existing config

Resolve the path: `adhd.config.ts` at the repo root. Use `Read` to load it. There are three branches:

**Branch A — File exists and is well-formed.** Treat it as the source of defaults the user can accept by hitting Enter on later prompts. Continue to parse defaults below.

**Branch B — File exists but is malformed** (parse fails, or required keys missing). Print: `Found adhd.config.ts but could not parse it. The wizard will re-create it from scratch; existing values will not be used as defaults.` Continue without defaults.

**Branch C — File does not exist.** Continue without defaults.

### Parse defaults (Branch A only)

For Branch A, extract these fields with targeted regex (the file is a plain TypeScript literal, no imports):
- `figma.url:` → string
- `naming:` (optional) → string (`"kebab-case"`, `"PascalCase"`, `"camelCase"`) or boolean `false`
- `cssEntry:` (optional) → string path

Pass these forward as defaults for Phases 1, 2, and 3.

## Phase 0.5: Verify the official Figma plugin is installed and authenticated

ADHD requires the `figma@claude-plugins-official` Claude Code plugin — every other skill (`/adhd:lint`, `/adhd:push-design-system`, `/adhd:pull-design-system`, `/adhd:push-component`, `/adhd:pull-component`) drives Figma exclusively through it via `mcp__plugin_figma_figma__*`. This phase verifies it's installed and authenticated up front, so users hit setup errors here (when they can act on them) rather than mid-pipeline.

Call `mcp__plugin_figma_figma__whoami`. It's read-only and returns the authenticated Figma user's identity.

Three outcomes:

- **Success** (returns user info): print `✓ Figma plugin connected as <user-handle>.` and continue to Phase 1.

- **Tool unavailable / plugin not installed** (the tool errors out with "not registered", "no MCP server", or similar): abort with this exact message:

  ```
  ✗ The official Figma plugin isn't installed. ADHD uses it for every Figma operation.

  Install it with:

    claude plugin install figma@claude-plugins-official

  Then re-run /adhd:config.
  ```

- **Authentication error** (tool exists but reports not authenticated): abort with this exact message:

  ```
  ✗ The Figma plugin is installed but not authenticated.

  Follow Figma's auth flow per the plugin's documentation
  (typically: open the plugin in Claude Code and complete the OAuth prompt).

  Then re-run /adhd:config.
  ```

Do NOT continue to Phase 1 unless `whoami` succeeded. Authentication failures and missing-plugin failures are both setup-blocking conditions; the wizard cannot validate the Figma URL (Phase 1) without the plugin.

## Phase 1: Figma URL + reachability

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

**Validation step 2 — reachability.** Extract the file key — it's the path segment immediately after `/design/`. Call `mcp__plugin_figma_figma__get_metadata` with that file key. Three failure cases:

- **Authentication error** (the MCP returns "not authenticated" or similar): this should have been caught in Phase 0.5; if it happens here, the plugin lost its auth mid-wizard. Abort with `Figma plugin lost authentication. Re-authenticate via the plugin, then re-run /adhd:config.` Do NOT save the URL.
- **404 / not found:** print `Cannot reach the Figma file at that URL. Verify the URL is correct and that you have access.` Then re-issue the chat prompt from Step 2.
- **Other error** (network, timeout): print the error and re-issue the chat prompt from Step 2.

On success (200 with metadata), save the URL.

This phase **does not** validate that the Figma file has the mandated structure (Primitives / Semantic collections, Light/Dark modes, kebab-case naming). That validation is `/adhd:sync`'s job — running it here would slow the wizard and duplicate logic.

## Phase 2: Naming convention

ADHD's `/adhd:lint` skill validates that components, variant properties, and variant values in the Figma file follow a single naming convention. This phase asks the user which one their file uses (or lets them disable the check). The selection is written to `adhd.config.ts` as the `naming` field.

Use `AskUserQuestion`:

```
Question: "What naming convention does your Figma file use for components, variant properties, and variant values?"
Header: "Naming"
Options:
  - label: "kebab-case (default — recommended for design systems)", description: "Examples: button, primary-button, size=small. /adhd:lint enforces this on all components and variants."
  - label: "PascalCase", description: "Examples: Button, PrimaryButton, Size=Small. /adhd:lint enforces this convention instead."
  - label: "camelCase", description: "Examples: button, primaryButton, size=small. /adhd:lint enforces this convention instead."
  - label: "Disable check (false)", description: "Skip naming-convention validation entirely. Useful if your Figma file mixes conventions or uses something custom."
```

Default selection: if Phase 0 (Branch A) provided an existing `naming` value, default to that option; otherwise default to "kebab-case".

Map the user's answer to a config value and save it in memory as `namingSelection`:

| User picks | `namingSelection` |
|---|---|
| kebab-case | `"kebab-case"` |
| PascalCase | `"PascalCase"` |
| camelCase | `"camelCase"` |
| Disable check (false) | `false` |

**Storage rule:** if the final selection is `"kebab-case"` (the default), **do not write a `naming` field** to `adhd.config.ts` — its absence means kebab-case. Otherwise (PascalCase, camelCase, or `false`), Phase 4 writes it explicitly.

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

Compose the config object from in-memory state. Always include `figma.url`. Conditionally include the rest:

| Field | Include if |
|---|---|
| `naming` | `namingSelection` is anything other than `"kebab-case"` (i.e., `"PascalCase"`, `"camelCase"`, or `false`) |
| `cssEntry` | resolved path is NOT `app/globals.css` |

Render the file body using this template (omit lines marked optional when their condition is false):

```ts
// adhd.config.ts — read by the ADHD skills (/adhd:sync, /adhd:config, /adhd:export-for-figma, /adhd:lint).
// No npm package or import required; the skills validate the shape on read.

const config = {
  figma: {
    url: "<URL>",
  },

  // optional: naming: <NAMING_VALUE>,

  // optional: cssEntry: "<CSS_ENTRY>",
};

export default config;
```

When the `naming` line is included, render `<NAMING_VALUE>` as either a quoted string (`"PascalCase"` or `"camelCase"`) or the bare boolean `false` — never as the string `"false"`.

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

## Phase 5: Report

Print a summary of what was done. Tailor to the actual operations:

```
Config saved to adhd.config.ts.

Figma:   <URL>
Naming:  <"kebab-case (default)", "PascalCase", "camelCase", or "disabled">
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

## Phase 6 (optional): Set up the design-system docs route

Use `AskUserQuestion`:

```
Question: "Set up the design-system docs route now? It's a live, self-generating
documentation page that reads your adhd.config.ts and globals.css. Mini-Storybook
for designers; not indexed by search engines."
Header: "Docs route"
Options:
  - "Yes, install it now"
  - "No, maybe later"
```

On "Yes": execute the phases of `/adhd:install-design-system-docs-route` inline.
See `plugins/adhd/skills/install-design-system-docs-route/SKILL.md` for the
detailed phase list (validate environment → detect existing install → ask install
choices → detect Next.js config → detect collisions → patch next.config.ts →
write files → patch robots.txt → final report).

On "No": print `Run /adhd:install-design-system-docs-route later to set it up.`
Exit normally.

## Reference: Common errors and fix-up guidance

### "The official Figma plugin isn't installed"
ADHD drives Figma exclusively through the `figma@claude-plugins-official` Claude Code plugin. Install it with `claude plugin install figma@claude-plugins-official`, then re-run `/adhd:config`.

### "The Figma plugin is installed but not authenticated"
The plugin is registered but `whoami` returned an auth error. Complete the plugin's OAuth flow (open it in Claude Code; follow the prompt), then re-run `/adhd:config`.

### "Cannot reach the Figma file"
The URL is well-formed but Figma returned 404 or no metadata. Confirm the URL is correct (copy from your browser's address bar), and that your authenticated plugin user has access to the file.

## Reference: adhd.config.ts schema

```ts
const config = {
  figma: {
    url: "https://www.figma.com/design/<key>/<name>",   // required
  },
  naming?: "kebab-case" | "PascalCase" | "camelCase" | false,           // optional; omit = "kebab-case"
  cssEntry?: "src/app/globals.css",                                     // optional; omit = "app/globals.css"
};
export default config;
```

The schema is read by `/adhd:config`, `/adhd:sync`, `/adhd:lint`, and `/adhd:export-for-figma`. No fields hold credentials — authentication is delegated entirely to the `figma@claude-plugins-official` plugin. ADHD always syncs every supported token domain (color, spacing, typography, radius, shadow, plus any others added in the future); there's no per-domain opt-out.
