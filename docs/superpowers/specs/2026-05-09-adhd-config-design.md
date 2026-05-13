# ADHD Config Wizard + Hybrid Figma Writes — Design Spec

**Date:** 2026-05-09
**Status:** Approved for implementation planning
**Companion to:** `2026-05-09-adhd-token-sync-design.md`

## Purpose

Two coupled additions to ADHD ("agent-driven harmonious development"):

1. **`/adhd:config`** — a Claude Code skill (sibling to `/adhd:sync`) that walks users through producing a valid `adhd.config.ts`, and when `leader: "code"`, ensures a working Figma personal access token (PAT) is wired up via `.env.local`.
2. **Hybrid Figma writes** — `/adhd:sync`'s apply phase for `leader: "code"` gains a probe-then-fallback strategy: try MCP variable-write tools first, fall back to Figma's REST API (using the PAT) if the MCP doesn't expose them. This unblocks `leader: "code"`, which the original token-sync spec deferred.

The original spec assumed code → Figma writes were free (via MCP) and pull-only validation logic worked the same way both directions. Investigation showed that MCP exposes only read tools for variables today, and Figma's variable-write REST endpoints are gated to Enterprise plans. The hybrid approach lets us ship `leader: "code"` now (Enterprise required, falling back to MCP automatically when Figma ships writes) without forcing every user onto Enterprise.

## Mental model

`/adhd:config` is the user's **on-ramp**. It's run before sync, manually, whenever the config doesn't exist or has changed. The config skill captures intent and credentials; the sync skill applies them.

`/adhd:sync` does **not** auto-invoke `/adhd:config`. When sync hits a config-fixable problem in Phase 1, it prints a clear `Run /adhd:config to fix.` hint and exits non-zero. Two-step user flow, but the two skills stay decoupled — either can change without coordinating control flow with the other.

## `adhd.config.ts` schema

One additive change to the schema from the token-sync spec: an optional `figma.pat` field that names the env var holding the token.

```ts
const config = {
  leader: "code" as const,           // or "figma"
  figma: {
    url: "https://www.figma.com/design/<key>/<name>",
    // pat?: "FIGMA_PAT"             // optional env var NAME (not the token); default "FIGMA_PAT"
  },
  // domains?: ["colors", "spacing", "typography", "radius", "shadow"]   // omit = all
  // cssEntry?: "src/app/globals.css"                                     // omit = "app/globals.css"
};
export default config;
```

`figma.pat` is the **name** of the env var that holds the token. It is never the token itself. v1 defaults to `"FIGMA_PAT"` when omitted; the wizard does not write the field when using the default. Users on a project that already has, say, `FIGMA_API_TOKEN` exported from their shell rc can set `figma.pat: "FIGMA_API_TOKEN"`, and ADHD honors it everywhere — wizard detection, validation, and the sync REST fallback all read `process.env[config.figma.pat ?? "FIGMA_PAT"]`.

### Schema-level safeguards

Two safeguards reinforce that `figma.pat` stores a *name*, not a *value*:

1. **PAT-leak preflight** — runs at the top of both `/adhd:config` (Phase 0) and `/adhd:sync` (Phase 1). Scans the source text of `adhd.config.ts` for anything that looks like a literal Figma PAT:
   - `figd_[A-Za-z0-9_-]+` (Figma's standard PAT prefix; strongest signal)
   - Any string longer than ~30 chars assigned to a key literally named `pat`, `token`, or `secret`

   On match, abort with:
   ```
   Looks like a Figma PAT is committed to adhd.config.ts. This is a credential leak.
   Remove it from the config and store it as FIGMA_PAT in either:
     • .env.local in the repo root (gitignored), or
     • your shell environment (e.g., export FIGMA_PAT=... in ~/.zshrc).
   Then re-run /adhd:config.
   ```

2. **`figma.pat` shape check** — value must match `^[A-Z][A-Z0-9_]*$` (env var naming convention). On failure, abort with: `figma.pat must be the NAME of an env var (e.g., "FIGMA_PAT"), not the token itself.`

## `/adhd:config` wizard flow

Linear, eight phases. Each phase prints what it's doing, asks at most one question, and either proceeds or stops with a clear error.

### Phase 0 — Detect existing config + preflight

Read `adhd.config.ts` if present. Run the PAT-leak preflight scan on its source text (see schema-level safeguards above). If clean, parse and treat existing values as defaults the user can accept. If the file exists but is malformed, warn and treat as if absent. If absent, proceed clean.

### Phase 1 — Leader

Multiple-choice prompt: `code` (this repo wins on conflict) or `figma` (Figma wins). Default = existing value if present, else `figma`. Both options are fully supported in this spec.

### Phase 2 — Domains

Multi-select over the five supported domains: `colors`, `spacing`, `typography`, `radius`, `shadow`. All five selected by default. If the user keeps all five, **the wizard does not write a `domains` field** — its absence means "all". Only write the array if a strict subset is selected.

### Phase 3 — Figma URL + reachability

Free-text prompt with current value as default. Validate format against `^https://www\.figma\.com/design/[^/]+/`. Then test reachability: extract the file key from the URL, call `mcp__figma__get_metadata`. On 404 / auth error / network error, surface the exact failure and re-prompt — don't save a broken URL. Mandated-structure validation (Primitives / Semantic collections, modes, naming) is **not** done here; sync handles that.

### Phase 4 — PAT setup (only when `leader: "code"`)

Detection cascade. Resolve the env var name from `config.figma.pat ?? "FIGMA_PAT"`.

1. Check `process.env[name]` (current shell).
2. Read `.env.local`, `.env.development.local`, `.env` from the repo root in that order, parse for `<name>=`. First hit wins.
3. If found in either, validate against Figma: `GET https://api.figma.com/v1/files/:key/variables/local` with header `X-FIGMA-TOKEN: <value>`.
   - **200** → token works, user is on Enterprise, has access. Continue.
   - **401** → bad token. Re-prompt for a new value.
   - **403** → wrong plan or wrong scope. Print: `Your token does not have access to the Variables API. This is gated to Figma Enterprise plans with a Full seat. You can:` (a) upgrade your Figma plan, (b) re-enter a different token with access, or (c) cancel and switch leader to "figma" via /adhd:config. Re-prompt or let the user bail.
   - **404** → wrong file key (shouldn't happen — already validated reachability). Re-prompt for URL.
4. If not found anywhere, prompt for a token (free-text, masked if the host supports masking). Append `FIGMA_PAT=<value>` (or `<name>=<value>` if customized) to `.env.local`, creating the file if it doesn't exist. Verify `.env.local` is in `.gitignore`; if not, add it. Re-validate using the cascade.

If `leader: "figma"`, skip this phase entirely.

### Phase 5 — `cssEntry` auto-detect

Try `app/globals.css`, then `src/app/globals.css`. Single hit → save it without prompting. Both exist → prefer `app/globals.css` and warn (`Both app/globals.css and src/app/globals.css exist; using app/globals.css.`). Neither exists → prompt the user for the path.

If the result is the default (`app/globals.css`), do not write the `cssEntry` field.

### Phase 6 — Write `adhd.config.ts`

Compose the config object using only the fields with non-default values:
- Always: `leader`, `figma.url`
- Conditionally: `figma.pat` (only if user customized), `domains` (only if subset), `cssEntry` (only if non-default)

If updating an existing file, print a diff before write and ask for confirmation. If creating, print the full new file content and ask for confirmation.

Also write `.env.local` updates from Phase 4 if applicable.

### Phase 7 — Report

Summary of what was written, where the PAT lives (if applicable), and the next step:
```
Config saved to adhd.config.ts.
PAT loaded from .env.local (FIGMA_PAT).
.env.local is gitignored.

Next: run /adhd:sync --dry-run to see your first diff.
```

## `/adhd:sync` changes

### Phase 1 grows error-routing logic

Every Phase 1 failure routes to one of three "next step" categories. The format is the same for every error:

```
ADHD sync cannot proceed.

Reason:    <specific issue>
Next step: <Run /adhd:config | Run the Figma MCP auth flow | Fix the Figma file>
```

Then exit non-zero.

**Config-fixable (`Run /adhd:config`):**
- `adhd.config.ts` missing
- Schema mismatch: bad `leader`, malformed `figma.url`, bad `figma.pat` shape, unknown domain in `domains`
- PAT-leak preflight failure (uses the special credential-leak text from §schema-level safeguards, not the generic message)
- `cssEntry` (or default `app/globals.css`) doesn't exist
- Figma URL returns 404 from `mcp__figma__get_metadata`
- `leader: "code"` AND **no MCP variable-write tools detected** (Phase 6.1 probe runs early during Phase 1) AND the resolved env var (`config.figma.pat ?? "FIGMA_PAT"`) is missing or fails the 401 / 403 check on `GET /v1/files/:key/variables/local`. If the MCP probe matches, PAT validation is skipped entirely — Path A doesn't need the token.

**Not config-fixable, with specific guidance:**
- Figma MCP not authenticated → `Next step: Run the Figma MCP auth flow per Figma's docs.`
- Figma file structure non-compliant → `Next step: Fix the Figma file. <specific issue>` (e.g., `Semantic collection has 3 modes; v1 supports exactly Light and Dark`)
- 403 Enterprise gate during the REST fallback when leader=code → `Next step: Either switch leader to "figma" (Run /adhd:config) or upgrade to a Figma Enterprise plan with Full seat. Variable-write MCP tools, when Figma ships them, will bypass this gate.`

### Phase 1 removals

The existing `leader: "code"` v1 limitation block in the sync skill (the abort message that says "leader: code requires Figma write tools that are not available in v1") is **removed**. `leader: "code"` is fully supported.

### Phase 6 (apply) — hybrid logic for leader=code

Replaces the current Phase 6.1 stub.

#### 6.1 — Probe

At the top of Phase 6, before any writes, inspect the runtime tool surface for variable-write MCP tools. Search for any tool name matching:
- `mcp__figma__(create|update|set|delete)_variable.*`
- `mcp__figma__set_variable_mode_value`

If at least one matches, use **Path A**. If none, use **Path B**.

We pattern-match rather than naming exact tool names to future-proof: when Figma ships variable-write tools, the probe picks them up automatically. If they ship under unexpected names, the regex is a single-line update.

#### 6.2 — Path A: MCP variable writes

Use the matched MCP tools for all writes. No PAT involved. Tool calls happen in-conversation, the same way reads work today.

For each diff entry:
- **Added Primitive** → MCP create call into the `Primitives` collection with the raw value.
- **Added Semantic** → MCP create call into the `Semantic` collection, with both Light and Dark mode values aliased to the right Primitive.
- **Changed value** → MCP update / set-mode-value call (per affected mode).
- **Removed** (only on explicit confirmation) → MCP delete call.

After each domain, report `✓ <domain> synced to Figma via MCP (N changes)`.

#### 6.3 — Path B: REST API fallback

Pre-conditions verified in Phase 1: the `figma.pat` env var resolves to a token that returned 200 from `GET /v1/files/:key/variables/local` (so we know the user is on Enterprise + has access).

Single batched endpoint: `POST /v1/files/:file_key/variables`. Body shape:

```jsonc
{
  "variableCollections": [ { "action": "CREATE" | "UPDATE" | "DELETE", ... } ],
  "variableModes":       [ { "action": "...", ... } ],
  "variables":           [ { "action": "...", ... } ],
  "variableModeValues":  [ { "variableId": "...", "modeId": "...", "value": ... } ]
}
```

ADHD assembles one batched payload per domain (so each domain still commits / reports atomically). Figma supports temp-IDs for variables created within a single request — ADHD uses that to chain create + set-value in one round trip.

After each domain, report `✓ <domain> synced to Figma via REST (N changes)`.

#### 6.4 — Diff translation rules (both paths)

Same logical operations, different transports.

| Diff entry | Operations |
|---|---|
| Primitive add | 1 variable create + 1 mode-value set in the single Primitives mode |
| Primitive change | 1 mode-value set |
| Primitive remove (on confirm) | 1 variable delete |
| Semantic add | 1 variable create + 2 mode-value sets (Light + Dark, both aliases to a Primitive) |
| Semantic change, one mode differs | 1 mode-value set on the differing mode only |
| Semantic change, both modes differ | 2 mode-value sets |
| Semantic remove (on confirm) | 1 variable delete |

#### 6.5 — Path B error mapping

- **401** mid-run → token revoked / wrong. Surface and stop. `Run /adhd:config` to refresh.
- **403** mid-run → user lost Enterprise access or scope changed. Surface and stop with the Enterprise-gate guidance.
- **429** → rate-limited. Surface retry-after guidance, halt the current domain, leave already-committed domains intact. Re-run resumes from the failed domain.
- **5xx** → transient. Advise re-run.

### Phase 7 (verify) is unchanged in shape

Re-read both sides via Phase 2 and 3 logic, recompute the diff, assert empty for synced domains. Verify always reads via MCP (`mcp__figma__get_variable_defs`), regardless of whether apply went through Path A or Path B — MCP reads are free for everyone, so there's no benefit to using REST for the read side.

## File and skill structure

New skill file: `plugins/adhd/skills/config/SKILL.md`. Mirrors the layout of `plugins/adhd/skills/sync/SKILL.md`. Plugin manifest (`plugins/adhd/.claude-plugin/plugin.json`) does not need changes — skills are auto-discovered.

The sync skill (`plugins/adhd/skills/sync/SKILL.md`) is edited in place to:
- Add the PAT-leak preflight to Phase 1.1
- Replace the `leader: "code"` v1-limitation abort with the new hybrid path probe
- Update Phase 6.1 from stub to Path A / Path B logic
- Update Phase 7 (verify) to handle both paths
- Add the new error-routing format described above

## Authentication

- ADHD does not manage credentials.
- The Figma MCP handles its own OAuth flow for read access.
- Path B (REST writes) requires a Figma PAT with the appropriate scope. PAT scopes are selected at token-creation time in Figma's user settings.
- The token lives in `process.env[config.figma.pat ?? "FIGMA_PAT"]`. The wizard writes it to `.env.local` if needed; the user can also export it from their shell rc.
- The token is **never** stored in `adhd.config.ts`. The preflight scan enforces this on every config read.
- **Replacing an invalid token**: if the wizard's detection cascade finds a value that fails 401 validation, the wizard offers to replace it. If the value lives in a `.env*` file, the wizard rewrites that line. If the value lives in `process.env` (set by the user's shell), the wizard cannot edit shell rc files — it instructs the user to update their shell environment manually and re-run.

## Out of scope (v1)

- **System keychain / credential-store integration** — PAT lives in env or `.env.local` only.
- **OAuth flow inside the wizard** — PAT only. OAuth would require a redirect-receiving server.
- **Token rotation / expiration handling** — Figma PATs don't auto-expire. Revoked tokens fail with 401 and point users to `/adhd:config`.
- **Wizard support for multiple `.env*` filenames as the destination** — wizard always writes to `.env.local`. Reading honors the cascade.
- **Wizard scaffolding the Figma file** — creating `Primitives` / `Semantic` collections is out. Sync's Phase 1 reports structure issues; the user fixes them in Figma manually.
- **Sync auto-redirecting to `/adhd:config`** — explicitly chose print-and-exit.
- **Token scope verification beyond a single-endpoint probe** — `GET /v1/files/:key/variables/local` returning 200 is sufficient. Per-action scope failures surface at apply time as 403s.
- **Custom Figma file structure** — `adhd.config.ts` cannot override mandated collection names, mode names, or naming conventions. Deferred to v2.
- **Path B (REST) fallback for non-Enterprise users** — gracefully impossible. Wizard explains this; sync surfaces 403 with switch-to-figma guidance.
- **Storing the PAT inline in `adhd.config.ts`** — actively prevented by the preflight scan. No escape hatch.
- **CI integration** — manual sync via slash command only in v1, same as the original spec.

## Acceptance criteria

1. **Wizard, fresh repo, `leader: "figma"`** — `/adhd:config` in a repo with no `adhd.config.ts` produces a valid file with `leader`, `figma.url`, no `domains` key, no `figma.pat` key, and `cssEntry` only if non-default. Sync's Phase 1 passes against this file.

2. **Wizard, fresh repo, `leader: "code"`** — same as (1) but also prompts for / detects a PAT, validates via `GET /v1/files/:key/variables/local`, writes `FIGMA_PAT=...` to `.env.local`, and ensures `.env.local` is in `.gitignore`. The config gets no `figma.pat` field (default name in use).

3. **Wizard, update existing config** — running on a healthy config offers each existing value as the default; user changing `leader` from `figma` to `code` triggers Phase 4 PAT setup; the diff of changes is shown before write.

4. **Domains multi-select round-trips correctly** — keeping all five → no `domains` key. Deselecting any → explicit array written; sync respects it on the next run.

5. **Preflight PAT-leak check** — a config containing `pat: "figd_abc123..."` causes both `/adhd:config` and `/adhd:sync` to abort with the credential-leak error. Removing the value lets both proceed.

6. **`figma.pat` shape check** — setting `figma.pat: "actuallyMyToken_figd_..."` (lowercase + token-shaped) triggers the shape error, not a value-leak error.

7. **Wizard refuses to save an unreachable URL** — re-prompts until reachable or the user cancels.

8. **Custom `figma.pat` env var name honored end-to-end** — setting `figma.pat: "FIGMA_API_TOKEN"` in the config makes the wizard's detection cascade and sync's token loading both read `process.env.FIGMA_API_TOKEN`.

9. **Sync error routing** — every config-fixable failure prints the `Run /adhd:config` next step; non-config failures print the appropriate alternative (MCP auth, fix Figma file, switch leader / upgrade plan).

10. **Hybrid Path A — MCP probe** — when variable-write MCP tools are present, sync uses them and ignores the PAT.

11. **Hybrid Path B — REST fallback** — when MCP write tools are absent, sync uses the REST API + PAT against an Enterprise file end-to-end.

12. **Verify phase succeeds via both paths** — after a successful apply, re-read returns an empty diff for the synced domains. Failed verify surfaces the post-apply diff and does not claim success.

13. **`leader: "code"` is no longer aborted in sync's Phase 1** — the existing v1 limitation block is removed.

14. **Existing leader=figma path** — all acceptance criteria 1–10 from `2026-05-09-adhd-token-sync-design.md` continue to pass.

## Implementation note

This spec covers two natural shipping units, expected to land as two `writing-plans` invocations:

1. **Wizard + sync's error-routing changes + PAT-leak preflight + `figma.pat` schema field + removal of the leader=code abort.**
2. **Hybrid Figma writes engine** — MCP probe + REST fallback + diff translation + verify path on both transports.

Either could land first, but (1) before (2) makes more sense: the wizard is the primary entrypoint users will reach for first, and shipping (2) without `/adhd:config` would mean asking users to hand-configure during the rollout.
