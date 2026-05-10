# ADHD Restructure: Unidirectional Commands + DTCG Pipeline — Design Spec

**Date:** 2026-05-09
**Status:** Approved for implementation planning
**Supersedes (in part):** `2026-05-09-adhd-token-sync-design.md`, `2026-05-09-adhd-config-design.md`

## Purpose

Restructure ADHD ("agent-driven harmonious development") around three principles surfaced during real use of the v1 wizard:

1. **Direction in the command name, not in the config.** Replace the bidirectional `/adhd:sync` (with a `leader` field deciding flow) with two unidirectional commands plus a check command. Mechanism asymmetry between code→Figma and Figma→code makes the leader-follower abstraction misleading.
2. **DTCG as the canonical token format.** All token-shaped data inside ADHD is represented as DTCG (Design Token Community Group) JSON. The conversion happens once at each boundary; everything internal compares DTCG against DTCG.
3. **Code → Figma via DTCG export, not REST API.** Figma's variable-write REST endpoints are Enterprise-only. By generating DTCG JSON the user imports manually (via Figma's native Schema-2025 import or any DTCG-compatible community plugin), we ship code-side authoring on any Figma plan tier.

The result: four single-purpose user commands, one model-invocable utility skill, and a small zero-dependency Node script that does the actual conversion deterministically.

## Mental model

| Command | Direction | Mechanism | Side effects |
|---|---|---|---|
| `/adhd:config` | — | local file + URL validation via MCP | writes `adhd.config.ts` |
| `/adhd:check` | bidirectional read | MCP read + DTCG compare | none (exit 0 / non-zero) |
| `/adhd:export-for-figma` | code → Figma | Node converter → DTCG file → user imports | writes a DTCG JSON file |
| `/adhd:sync-from-figma` | Figma → code | MCP read + DTCG diff + targeted CSS edits | edits `globals.css` |

Plus one utility skill the user never invokes directly:

| Skill | Caller(s) | Purpose |
|---|---|---|
| `adhd:to-dtcg` (model-invocable) | `export-for-figma`, `check`, `sync-from-figma` | Thin orchestrator that shells out to `plugins/adhd/lib/to-dtcg/cli.js` |

**Conflict resolution** lives in `/adhd:sync-from-figma`'s Phase 5 interactive confirm prompt (existing pattern). No `leader` field, no declarative conflict policy. CI-style unattended use is supported via `--apply` (skip prompt) and `/adhd:check`'s non-zero exit code on drift.

## `adhd.config.ts` schema

```ts
const config = {
  // Required. The Figma file ADHD reads from for /adhd:check and
  // /adhd:sync-from-figma, and that the user imports into for
  // /adhd:export-for-figma.
  figma: {
    url: "https://www.figma.com/design/<key>/<name>",
  },

  // Optional. Subset of domains to operate on. Omit for all five.
  // domains: ["colors", "spacing", "typography", "radius", "shadow"],

  // Optional. Path to the Tailwind CSS entry file.
  // Default: "app/globals.css".
  // cssEntry: "src/app/globals.css",
};

export default config;
```

**Removed from the prior schema:** `leader` (no longer multiplexed), `figma.pat` (no PAT needed in any command).

**PAT-leak preflight** stays as defense-in-depth, applied at the top of every command that reads `adhd.config.ts`. The skill file's regex check (`figd_[A-Za-z0-9_-]+` and `(pat|token|secret)\s*:\s*"[^"]{30,}"` with the env-var-name escape) does not change.

## Component 1: `plugins/adhd/lib/to-dtcg/cli.js`

The deterministic converter. Plain JavaScript, zero npm dependencies, runs on the user's existing Node.js (which they already have for Tailwind v4).

### File layout

```
plugins/adhd/lib/to-dtcg/
├── cli.js                        # entrypoint, ~300 lines
├── __fixtures__/
│   ├── sample-globals.css        # input fixture for css mode
│   ├── sample-figma-response.json # input fixture for figma mode
│   ├── sample.dtcg.json          # expected output (round-trip target)
│   └── tailwind-v4-theme.css     # snapshot of node_modules/tailwindcss/theme.css for stable testing
└── __tests__/
    ├── css.test.js               # uses node:test
    ├── figma.test.js             # uses node:test
    └── round-trip.test.js        # css fixture vs. figma fixture, semantic equality
```

### CLI surface

```
node plugins/adhd/lib/to-dtcg/cli.js --source <css|figma> --input <path> [--tailwind-theme <path>]

  --source css     Read CSS source. Parses @theme {}, :root {}, and
                   @media (prefers-color-scheme: dark) :root {} blocks.
                   Optionally merges with --tailwind-theme defaults.

  --source figma   Read Figma MCP variable-defs JSON. Translates slash
                   hierarchy to dot paths, raw values to typed DTCG
                   tokens, aliases to {ref} syntax, modes to
                   $extensions.com.figma.modes.

  --input <path>   Read input from a file (required).

  --tailwind-theme <path>   (css mode only) Path to Tailwind v4's
                            theme.css for default merging. Default:
                            ./node_modules/tailwindcss/theme.css.
                            Use "none" to skip merging defaults.

Output: DTCG-formatted JSON to stdout. The output is **stable**: keys are sorted alphabetically at every object level, indentation is 2-space, and a trailing newline is emitted. This stability is what makes the byte-equal CI tests viable; both sources, given equivalent inputs, must produce identical JSON.
Exit codes: 0 on success; 1 on parse error; 2 on bad arguments.
```

### Conversion rules

**Slash → dot path:** `colors/gold/100` → `color.gold.100`; `spacing/4` → `spacing.4`; `colors/brand/surface` → `color.brand.surface`.

**Domain → DTCG `$type` table:**

| Namespace prefix | DTCG `$type` | Value format |
|---|---|---|
| `color` | `color` | hex `#rrggbb` or `#rrggbbaa` |
| `spacing` | `dimension` | unit string (`1rem`, `0.25rem`) |
| `radius` | `dimension` | unit string |
| `shadow` | `shadow` | DTCG shadow object `{ offsetX, offsetY, blur, spread, color }` |
| `font` | `fontFamily` | string or array of strings |
| `text` | `dimension` | unit string |
| `fontWeight` | `fontWeight` | number |
| `leading` | `number` | unitless number |

**Aliases:**
- CSS `var(--color-gold-100)` → DTCG `"{color.gold.100}"`
- Figma alias (variable-id reference) → DTCG `"{<resolved-dot-path>}"`

**Modes** (semantic tokens with Light + Dark):
```jsonc
{
  "color": {
    "brand": {
      "surface": {
        "$type": "color",
        "$extensions": {
          "com.figma": {
            "modes": {
              "Light": { "$value": "{color.gold.100}" },
              "Dark":  { "$value": "{color.gold.900}" }
            }
          }
        }
      }
    }
  }
}
```

**OKLCH → hex conversion:**
- Tailwind v4 default colors are OKLCH (`oklch(63.7% 0.237 25.331)`).
- Hand-rolled inline: OKLCH → OKLab → linear sRGB → companded sRGB → hex.
- Math vendored from colorjs.io's MIT-licensed conversion code, kept in a single section of `cli.js`.
- Lossy in the last 1-2 bits per channel for some out-of-sRGB-gamut colors. Acceptable for design tokens.

**CSS parsing strategy:**
- Regex-based, not a full CSS parser.
- Recognize ADHD-managed name patterns within `@theme {}`, `:root {}`, and `@media (prefers-color-scheme: dark) :root {}` blocks.
- Anything outside ADHD-managed patterns is ignored (user-owned CSS).

**Figma MCP-response parsing strategy:**
- Treat the MCP response as a tree of variable definitions, modes, and references.
- Recognize the `Primitives` (no modes) and `Semantic` (Light/Dark modes) collections.
- Reject malformed responses (missing required collections, unexpected mode count) with exit code 1 and a clear stderr message.

### Tests

**CSS fixture test (`css.test.js`):**
```js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

test('css conversion produces expected DTCG', () => {
  const out = execSync(
    'node cli.js --source css --input __fixtures__/sample-globals.css --tailwind-theme __fixtures__/tailwind-v4-theme.css',
    { cwd: import.meta.dirname }
  );
  const expected = JSON.parse(readFileSync('__fixtures__/sample.dtcg.json', 'utf8'));
  assert.deepEqual(JSON.parse(out), expected);
});
```

**Figma fixture test (`figma.test.js`):** parallel structure, source = figma.

**Round-trip test (`round-trip.test.js`):** asserts that DTCG-from-css and DTCG-from-figma fixtures (crafted to represent the same tokens) deep-equal. Tolerance for OKLCH→hex precision: ±1 LSB on hex channels.

**Fixture refresh workflow:** documented in `plugins/adhd/lib/to-dtcg/README.md`. When Figma's MCP response shape changes, maintainer re-captures `sample-figma-response.json` from a real session.

## Component 2: `adhd:to-dtcg` model-invocable skill

**Path:** `plugins/adhd/skills/to-dtcg/SKILL.md`

**Frontmatter:**
```yaml
description: "Convert design tokens between code (CSS) and Figma (MCP variable defs) representations and a canonical DTCG JSON shape. Used by /adhd:export-for-figma, /adhd:check, and /adhd:sync-from-figma."
disable-model-invocation: false
allowed-tools: Read Write Bash mcp__figma__get_variable_defs
```

**Body:** explains the two procedures and how to invoke them.

### Procedure A: `css-to-dtcg`

Caller passes a CSS file path. The skill:
1. Resolves the Tailwind theme path: `node_modules/tailwindcss/theme.css` (if exists; else "none").
2. Runs:
   ```bash
   node plugins/adhd/lib/to-dtcg/cli.js --source css --input <path> --tailwind-theme <theme-or-none>
   ```
3. Returns stdout as DTCG JSON.
4. On non-zero exit, surfaces stderr and propagates the failure.

### Procedure B: `figma-to-dtcg`

Caller passes a Figma file URL. The skill:
1. Calls `mcp__figma__get_variable_defs` (with file-key extracted from URL or with the URL directly per MCP convention).
2. Writes the raw MCP response JSON to a temp file (`/tmp/adhd-figma-response-<rand>.json`).
3. Runs:
   ```bash
   node plugins/adhd/lib/to-dtcg/cli.js --source figma --input /tmp/adhd-figma-response-<rand>.json
   ```
4. Returns stdout as DTCG JSON.
5. Cleans up the temp file.

The skill body is intentionally thin — orchestration prose, no conversion logic. All conversion lives in `cli.js`.

## Component 3: `/adhd:export-for-figma` user skill

**Path:** `plugins/adhd/skills/export-for-figma/SKILL.md`

**Purpose:** Generate a DTCG JSON file the user imports into Figma. Single-direction, code → Figma. Does not talk to Figma.

**Argument flags:** none in v1. Always writes to a fixed path (rationale: cuts UX surface; user can `git diff` the file to preview re-runs).

**Frontmatter:**
```yaml
description: "Generate a DTCG JSON file from this project's design tokens (Tailwind v4 defaults + custom tokens in globals.css). The user imports the resulting file into Figma via Figma's native variable import or any DTCG-compatible community plugin."
disable-model-invocation: true
allowed-tools: Read Write Bash Skill
```

### Phase 1: Validate

- Read `adhd.config.ts`. Run PAT-leak preflight. Validate schema (just `figma.url`/`domains`/`cssEntry`).
- Resolve `cssEntry`. Verify the file exists.
- (`figma.url` is parsed but unused by this command. We still validate it for the credential-leak check.)

Errors use the standard "Reason / Next step" format.

### Phase 2: Convert

- Invoke `adhd:to-dtcg` Procedure A with the resolved `cssEntry`.
- Receive DTCG JSON.

### Phase 3: Write

- Write the JSON to `adhd-export-for-figma.json` at the repo root.
- Pretty-print with 2-space indentation. Sort keys alphabetically within each object level for stable diffs.
- If `adhd-export-for-figma.json` is not in `.gitignore`, append it on its own line. (It's a generated artifact; users should regenerate, not commit, unless they specifically want to.)

### Phase 4: Report

```
Wrote adhd-export-for-figma.json (N tokens: M primitives, K semantic).
[If .gitignore was modified:]
Added adhd-export-for-figma.json to .gitignore.

Next:
  1. Open your Figma file (<URL from config>).
  2. Import variables — either via Figma's native "Import variables"
     (right-click a collection mode, available on Schema-2025-enabled
     accounts), or via a DTCG-compatible community plugin like
     "Variables JSON Import" or "Tokens Studio for Figma".
  3. Run /adhd:check to verify code and Figma agree.
```

## Component 4: `/adhd:check` user skill

**Path:** `plugins/adhd/skills/check/SKILL.md`

**Purpose:** Read-only direction-neutral diff between code and Figma. Reports drift; suggests remediation; never mutates.

**Argument flags:**
- `--domains <comma,separated>` — restrict the diff to a subset.

**Frontmatter:**
```yaml
description: "Check whether this project's design tokens (in globals.css) and the configured Figma file are in sync. Reports any drift; suggests /adhd:export-for-figma or /adhd:sync-from-figma to resolve. Read-only; no mutations."
disable-model-invocation: true
argument-hint: "[--domains <comma,separated>]"
allowed-tools: Read Bash AskUserQuestion Skill mcp__figma__get_metadata mcp__figma__get_variable_defs
```

### Phase 1: Validate

Same as `/adhd:export-for-figma`'s Phase 1, plus:
- Verify Figma reachability via `mcp__figma__get_metadata`.
- Validate Figma file structure (Primitives + Semantic collections, Light/Dark modes, kebab-case naming).

### Phase 2: Read code-side via DTCG

- Invoke `adhd:to-dtcg` Procedure A on the resolved `cssEntry`. Receive DTCG.

### Phase 3: Read Figma-side via DTCG

- Invoke `adhd:to-dtcg` Procedure B with `config.figma.url`. Receive DTCG.

### Phase 4: Compute diff

- Flatten both DTCG trees to maps keyed by dot-path.
- For each path:
  - In both → compare `$value`s. For tokens with modes, compare `$extensions.com.figma.modes.{Light,Dark}.$value` separately.
  - In code only → flag as `code-only`.
  - In Figma only → flag as `figma-only`.
- Filter by `config.domains` if set.

**Note on Tailwind defaults:** the code-side DTCG includes the full Tailwind v4 default palette (merged in by `adhd:to-dtcg` Procedure A). On a freshly-bootstrapped project where Figma hasn't been seeded yet, `/adhd:check` will list every Tailwind-default token as "code-only". This is correct: it surfaces exactly what needs to be exported. The user runs `/adhd:export-for-figma`, imports, then re-runs `/adhd:check`; the diff should drop to zero.

### Phase 5: Report and exit

**Empty diff:**
```
Code and Figma are in sync (N tokens checked across <domains>).
```
Exit 0.

**Non-empty diff:**
```
ADHD: out of sync.

In code, not in Figma:
  spacing/8        (--spacing-8 = 2rem)

In Figma, not in code:
  colors/brand/accent

Differing values:
  colors/gold/50   code: #fdf9eb   Figma: #fdf9ea

To resolve, pick a direction:
  /adhd:export-for-figma   push code state to Figma (overwrites Figma)
  /adhd:sync-from-figma    pull Figma state into code (overwrites code)

Then run /adhd:check again.
```
Exit non-zero (suggest exit code 1 for drift; reserve other codes for actual errors).

## Component 5: `/adhd:sync-from-figma` user skill (renamed from `/adhd:sync`)

**Path:** `plugins/adhd/skills/sync-from-figma/SKILL.md`. The old `plugins/adhd/skills/sync/SKILL.md` is deleted.

**Purpose:** Pull Figma variables into `globals.css`. Single-direction, Figma → code. The simpler half of the old `/adhd:sync` (which used to multiplex both directions via `leader`).

**Argument flags:**
- `--dry-run` — Phases 1–4 only; never mutate.
- `--domains <comma,separated>` — subset.
- `--apply` — skip the Phase 5 interactive confirm. Useful for unattended runs (CI, scripts). Explicit opt-in.

**Frontmatter:**
```yaml
description: "Pull design tokens from the configured Figma file into this project's globals.css. Reads the Figma file via MCP, converts to DTCG, diffs against globals.css, prompts for confirmation, then applies changes per domain with one git commit per domain."
disable-model-invocation: true
argument-hint: "[--dry-run] [--domains <comma,separated>] [--apply]"
allowed-tools: Read Edit Bash AskUserQuestion Skill mcp__figma__get_metadata mcp__figma__get_variable_defs
```

### Phase 1: Validate

Same as `/adhd:check` Phase 1 (config + PAT-leak preflight + Figma reachability + Figma structure).

### Phase 2: Read code-side via DTCG

Invoke `adhd:to-dtcg` Procedure A on `cssEntry`. Receive DTCG.

### Phase 3: Read Figma-side via DTCG

Invoke `adhd:to-dtcg` Procedure B with `config.figma.url`. Receive DTCG.

### Phase 4: Compute diff

Same flattening + per-path compare as `/adhd:check` Phase 4. Filter by `--domains` if set, else `config.domains`, else all.

### Phase 5: Display + confirm

Print the diff (summary table + per-domain detail).

If `--dry-run`: print `Dry run complete. No changes applied.` and exit 0.

If `--apply`: skip the prompt. Proceed to Phase 6.

Otherwise:
- `AskUserQuestion`:
  ```
  Question: "Apply these changes to globals.css?"
  Header: "Apply"
  Options:
    - "Yes — apply"
    - "No — abort"
    - "Show diff again"
  ```
- "No" → exit cleanly.
- "Show diff again" → reprint the diff and re-ask.
- "Yes" → proceed to Phase 6.

**Removals default to skip:** any token that would disappear from code (because Figma no longer has it) requires an additional confirmation. The first prompt covers add/change; if the diff includes removals, a follow-up prompt asks specifically about them. Default selection biased toward "skip removals."

### Phase 6: Apply (DTCG → CSS edits)

Walk the diff entries. For each:

| Diff entry | CSS edit |
|---|---|
| Primitive add | Insert `--<name>: <value>;` into `@theme {}` (alphabetical within block). Create the block if absent. |
| Primitive change | Replace value in `@theme {}` for matching variable name. |
| Primitive remove (confirmed) | Delete the matching `--<name>: ...;` line from `@theme {}`. |
| Semantic add | Insert into `:root {}` (Light value), `@media (prefers-color-scheme: dark) :root {}` (Dark value), AND `@theme inline {}` (`--color-<role>: var(--<role>)`). |
| Semantic change, single mode | Replace only the affected mode's line. |
| Semantic change, both modes | Replace both. |
| Semantic remove (confirmed) | Delete from all three blocks. |

Process domain-by-domain. After each domain:
```bash
git add <cssEntry>
git commit -m "ADHD sync-from-figma: <domain> (N changes)"
```

### Phase 7: Verify

Re-invoke `adhd:to-dtcg` on both sides. Recompute the diff. Assert empty for synced domains (excluding intentionally-skipped removals).

If non-empty: print the post-apply diff and report:
```
Sync verification failed for domain(s): <list>.
The apply step did not produce the expected result. Review the diff
above. The CSS edits committed so far are intact; no automatic rollback.
```

### Phase 8: Report

Per-domain change counts, commit short-SHAs, warnings.

### Removed from the old `/adhd:sync`

- The `leader: "code"` apply path (was a Plan-2-forthcoming abort stub).
- The `figma.pat` shape check.
- All references to `leader` in error messages.
- The "currently unreachable" parenthetical in the old report section.

## Component 6: `/adhd:config` user skill (simplified)

**Path:** `plugins/adhd/skills/config/SKILL.md` (existing file, edited in place).

**Wizard phase list shrinks from 8 to 6:**

| Phase | Purpose |
|---|---|
| 0 | Detect existing config + PAT-leak preflight (kept) |
| 1 | Domains (kept; renumbered from 2) |
| 2 | Figma URL + reachability (kept; renumbered from 3) |
| 3 | `cssEntry` auto-detect (kept; renumbered from 5) |
| 4 | Write `adhd.config.ts` (kept; renumbered from 6) |
| 5 | Report (kept; renumbered from 7) |

### Deleted phases

- Old Phase 1 (leader prompt) — gone.
- Old Phase 4 (PAT detection cascade + curl validation + `.env.local` write + `.gitignore` update) — gone in its entirety.

### Schema-related deletions

- `figma.pat` shape check in Phase 0 — gone.
- `figma.pat` mention in the rendered template in Phase 4 (write).
- The conditional `<NEXT_STEP>` for `leader: "code"` in Phase 5 (report).

### Reference-section deletions

- "Your Figma PAT was rejected (HTTP 401)" entry — gone.
- "Your token does not have access to Figma's Variables API (HTTP 403)" entry — gone.
- "figma.pat must be the NAME of an env var" entry — gone.
- "Looks like a Figma PAT is committed to adhd.config.ts" entry — kept (preflight stays).
- Schema reference example shrinks to the new shape.

### New Phase 5 (Report)

```
Config saved to adhd.config.ts.

Figma:   <URL>
Domains: <"all" or comma-separated list>
CSS:     <"app/globals.css (default)" or the explicit path>

Next: run /adhd:check to see whether code and Figma are in sync.
```

## Component 7: GitHub Actions CI

**Path:** `.github/workflows/ci.yml`

Two jobs, both on push to any branch and on pull requests targeting `main`.

### Job 1: `to-dtcg-tests`

```yaml
runs-on: ubuntu-latest
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: '20' }
  - name: Run to-dtcg unit tests
    run: node --test plugins/adhd/lib/to-dtcg/__tests__/
```

No npm install needed (zero-deps converter). No Anthropic API tokens. Sub-30-second runtime.

### Job 2: `hygiene`

```yaml
runs-on: ubuntu-latest
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: '20' }
  - run: npm ci
  - run: npm run lint
  - run: npm run build
  - name: Validate skill frontmatter
    run: node scripts/validate-skill-frontmatter.js
```

`scripts/validate-skill-frontmatter.js` is a small (~50-line) helper:
- Walks `plugins/adhd/skills/*/SKILL.md`.
- Parses YAML frontmatter.
- Asserts required keys (`description`, `disable-model-invocation`, `allowed-tools`).
- Asserts `description` is a single-line string.
- Asserts every section header listed in the skill body has at least the prescribed structure (a lightweight check, not a full spec validator).

### Out of CI scope

- **Live Figma calls.** No MCP setup, no Figma PAT secrets, no Anthropic API calls.
- **End-to-end skill execution.** We do not invoke Claude in CI. Skills are validated by structure + by their underlying scripts; behavior is manually smoke-tested at release time.

### Fixture-refresh workflow

Documented in `plugins/adhd/lib/to-dtcg/README.md`:
- When Figma's MCP `get_variable_defs` response shape changes, the maintainer recaptures the response from a real Claude Code session and replaces `__fixtures__/sample-figma-response.json`.
- When Tailwind v4 ships breaking changes to `theme.css`, the maintainer updates `__fixtures__/tailwind-v4-theme.css` and (if needed) the parser in `cli.js`.
- Tests will fail on stale fixtures, surfacing the need to refresh.

## Authentication

- ADHD does not manage credentials. Same as before.
- The Figma MCP handles its own auth for read access (`/adhd:check` and `/adhd:sync-from-figma` use it).
- **No PAT, no `.env.local`, no shell-environment integration in any command.** All write paths to Figma go through DTCG JSON + manual user import.
- The PAT-leak preflight stays as a defense-in-depth guard against accidental commits.

## Out of scope (v1)

- **Automated push to Figma.** All code → Figma flow is `/adhd:export-for-figma` + manual user import.
- **Figma Enterprise tier support.** Variable-write REST API would lift this; we don't use it.
- **Building or shipping our own Figma plugin.** Users use Figma's native import or any community DTCG plugin.
- **DTCG export of arbitrary CSS** (non-ADHD-managed variables).
- **Round-trip equivalence guarantee for OKLCH ↔ hex.** Tolerance applies; documented.
- **Token deletion on `/adhd:sync-from-figma`** without explicit confirmation.
- **CI integration templates / docs.** `--apply` and `/adhd:check`'s exit code provide hooks; we don't ship workflow examples.
- **Conflict-policy field in `adhd.config.ts`.** Phase 5 confirm is the resolution mechanism.
- **Multiple Figma files per repo.** Single `figma.url` only.
- **Custom DTCG `$extensions` namespaces beyond `com.figma`.**
- **Migration tooling for old leader-based configs.** New schema is a strict subset; release notes mention the deletion.
- **Live Figma in CI.** Fixture-based tests only; manual smoke at release time.
- **Anthropic API calls in CI.** No skill-invocation tests; deterministic Node tests only.

## Acceptance criteria

1. **`adhd:to-dtcg` cli.js, css mode:** running `node cli.js --source css --input __fixtures__/sample-globals.css` produces JSON byte-equal to `__fixtures__/sample.dtcg.json` (CI gate).

2. **`adhd:to-dtcg` cli.js, figma mode:** running `node cli.js --source figma --input __fixtures__/sample-figma-response.json` produces JSON byte-equal to `__fixtures__/sample.dtcg.json` (round-trip; CI gate).

3. **`adhd:to-dtcg` cli.js handles OKLCH:** Tailwind v4's `oklch(63.7% 0.237 25.331)` (red-500) converts to a hex value within ±1 LSB of `#fb2c36` per channel. (Note: Tailwind v3's red-500 was the literal `#ef4444`; v4 redefined the palette in OKLCH and the sRGB equivalents shifted slightly. `#fb2c36` is what the Ottosson conversion pipeline produces.)

4. **`/adhd:config` produces a valid config** with `figma.url` plus optional `domains`/`cssEntry`. The output never contains `leader` or `figma.pat`. `/adhd:check` Phase 1 passes against the produced config.

5. **`/adhd:export-for-figma`** against the demo repo writes `adhd-export-for-figma.json` containing all Tailwind v4 default primitives + the user's custom primitives + the user's semantic roles with Light/Dark modes. The file parses as DTCG. Re-running produces identical output. `.gitignore` is updated on first run.

6. **`/adhd:export-for-figma` output imports successfully** via at least one DTCG-compatible Figma plugin (manual smoke; not in CI).

7. **`/adhd:check` against an in-sync state** prints the in-sync message and exits 0.

8. **`/adhd:check` against a divergent state** prints the per-domain diff with both remediation pointers and exits with code 1.

9. **`/adhd:check --domains colors`** restricts the diff to colors only.

10. **`/adhd:sync-from-figma`** with no diff prints "no changes" and exits without prompting.

11. **`/adhd:sync-from-figma`** with a diff prompts via Phase 5; "No" leaves `globals.css` unchanged.

12. **`/adhd:sync-from-figma`** "Yes" applies edits in DTCG-translated form: primitives → `@theme {}`, semantic Light/Dark → the right `:root` blocks, Tailwind exposure → `@theme inline {}`. Per-domain commits land. Phase 7 verify passes.

13. **`/adhd:sync-from-figma --apply`** skips the prompt; otherwise behaves identically.

14. **`/adhd:sync-from-figma --dry-run`** prints the diff and exits without mutations or commits.

15. **Removals from `/adhd:sync-from-figma`** default to skip; require explicit second confirmation.

16. **PAT-leak preflight** catches a `figd_...`-shaped value in `adhd.config.ts` and aborts every ADHD command (`config`, `check`, `export-for-figma`, `sync-from-figma`) with the credential-leak message.

17. **GitHub Actions CI** runs both jobs (`to-dtcg-tests` and `hygiene`) on every push and PR. Both pass on `main`.

18. **Skill frontmatter validator** catches malformed YAML, missing required keys, or non-single-line `description` in any plugin SKILL.md.

19. **Existing demo app** (the avatar component, the `globals.css` setup) continues to render correctly after all restructure work; no regressions in the Next.js build or lint.

## Implementation note

This restructure ships as **four shipping units**, in order:

1. **`plugins/adhd/lib/to-dtcg/`** — `cli.js` + tests + fixtures + GitHub Actions CI workflow + skill-frontmatter validator script. Lays the foundation. The model-invocable `adhd:to-dtcg` skill ships in the same unit (it's a thin wrapper over `cli.js`).

2. **`/adhd:export-for-figma`** + **the deletions in `/adhd:config`**. Once unit 1 lands, unit 2 makes the code → Figma direction usable end-to-end. The wizard simplification is bundled here because it touches the same schema decisions.

3. **`/adhd:sync` rename to `/adhd:sync-from-figma`** + **DTCG-canonical Phases 2/3/4** + **leader=code path deletion** + **figma.pat shape-check deletion**. Brings the existing pull path under the new architecture.

4. **`/adhd:check`** — depends on `adhd:to-dtcg` and on `/adhd:sync-from-figma`'s DTCG-canonical Phase 2/3 logic. Lands last because it reuses both.

Each unit is its own `writing-plans` invocation. Total work: substantially deletion-heavy (walking back parts of three commits from the prior wizard implementation) plus the new converter, the new export skill, and the new check skill.
