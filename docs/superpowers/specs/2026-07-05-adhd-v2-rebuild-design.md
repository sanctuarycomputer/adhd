# ADHD v2 — Ground-Up Rebuild

**Date:** 2026-07-05
**Status:** Approved design, pre-implementation
**Supersedes:** the v1 plugin (all six skills and all four libs under `plugins/adhd/`)

## 1. Why a rebuild

Two independent audits of v1 (correctness + efficiency) converged on the same diagnosis: the bugs are not incidental, they are architectural.

**Systemic problem 1 — the LLM is used as plumbing.** Every v1 skill makes the model hand-author Figma serializer scripts from prose, compose JSON via Bash heredocs, substitute `__ACTIONS__`/`__VAR_INDEX__` placeholders into script strings, "hash JSON in working memory," and shuttle 250-line scripts through context into MCP calls. pull-component fetches the same Component Set three times per run; push/pull-design-system run the full paginated extraction twice (once for real, once for a byte-diff drift check) — 30–40 tool calls per run. None of this glue is testable, which is why the same areas kept regressing (lint false positives, consolidation assumptions, extraction truncation).

**Systemic problem 2 — the deterministic code is triplicated and self-contradictory.** oklch→rgb exists three times, yet the color comparator uses none of them (so on Tailwind v4's all-oklch default palette, every color token reads as a phantom conflict). Three copy-pasted CSS brace-scanners; globals.css parsed by two different engines. Three value-normalizers that subtly disagree. Worst: the two halves assume incompatible Figma file structures — lint-engine expects `Primitives`/`Semantic` collections (what the README mandates); design-system's parser only understands per-domain collections.

Plus outright breakage: `require('adhd.config.ts')` on finalize paths (Node cannot require `.ts`), lint crashes on numeric Figma values, shadow-parser silently converts unknown colors to opaque black, config wizard points users at two deleted commands.

v1 is unreleased, so there is no compatibility burden. It is treated as a prototype whose *product design* (lint rules, token architecture, lookup-table contract) and *hard-won Figma knowledge* (see §9) carry forward, and whose implementation does not.

## 2. Decisions log

| Decision | Choice |
|---|---|
| Strategy | Ground-up v2 rebuild; v1 kept on main as reference until parity |
| Command surface | Three commands: `/adhd:config`, `/adhd:lint`, `/adhd:sync` (replaces six) |
| Sync model | Read-only lint + interactive sync with three-way merge; `--push`/`--pull` force direction |
| Component first-push | Keep browser-capture via `generate_figma_design`; harden consolidation into tested code |
| Dependencies | Real deps (postcss, culori, TypeScript compiler API), esbuild-bundled to committed `dist/` — consumers install nothing |
| Config format | `adhd.config.json` with `$schema` (kills the `.ts`-parsing bug class) |
| Figma structure | One mandated model everywhere: `Primitives` (no modes) + `Semantic` (Light/Dark). Not configurable. |
| Authority model | Two-way transport, no fixed authority; the lock-file merge base attributes each change to a side |

## 3. What the research says (July 2026)

Key findings that shaped this design (full report in the brainstorm transcript):

- **Figma↔code drift diffing is the #1 wished-for automation** in design-system surveys two years running, and no shipping tool does it. `/adhd:lint` is the product, not a supporting feature.
- Only **6% of teams have code→design automation** (29% design→code). The consensus is "one-way authority, two-way transport" — practitioners reject symmetric authority, not bidirectional plumbing.
- **Silent loss is the ecosystem's disease**: Tokens Studio silently skips tokens on export and its pull can destroy local work; Code Connect breaks silently on prop renames. An explicit "cannot sync" report is a differentiator.
- **Renames/deletions are the recognized hard part**; Figma's own reference GitHub Action admits deletions don't propagate. Nobody has rename detection.
- **DTCG became stable (2025.10)** and Figma natively imports/exports DTCG JSON on all paid plans. The Variables REST API remains Enterprise-only; adhd's plugin-API-via-MCP transport is the right non-Enterprise path.
- Figma variables remain **COLOR/FLOAT/STRING/BOOLEAN only**; composites (typography, shadows) live in styles. Styles are writable via the plugin API (not REST).
- The `Record<Union, string>` lookup-table contract is effectively a **Code Connect-lite that works on Pro plans** and is machine-verified rather than silently stale.

## 4. Architecture

```
plugins/adhd/
  skills/            # 3 thin SKILL.md wrappers: config, lint, sync
  src/               # TypeScript, real deps
    core/
      color.ts       # culori: oklch/hex/rgb parse + normalize + compare
      css.ts         # postcss: globals.css read/write (@theme, :root, dark blocks)
      naming.ts      # THE css-var ↔ figma-path mapping (single implementation)
      tokens.ts      # domain model: token = { domain, path, valuePerMode }
      config.ts      # adhd.config.json read/write + JSON schema
      lock.ts        # adhd.lock.json read/write (see §5)
      snapshot.ts    # canonical serialized state of one side + content hash
    figma/           # every use_figma script is compiled, tested source
      extract.ts             # variables + styles extractor (cursor-chunked)
      serialize-component.ts # component-set serializer (fixed shape, SVG export)
      write.ts               # variable/style write actions
      consolidate.ts         # capture → Component Set consolidation
    rules/           # STRUCT001–010 + token rules; pure functions over snapshots
    pipelines/       # lint, sync-plan, sync-apply, capture, scaffold
    component/       # TS compiler API: props/unions/lookup-table read + write
  dist/              # committed esbuild bundle: adhd.js + figma script constants
  test/
    fixtures/        # v1's figma-real/* ported
    recordings/      # recorded real MCP responses (see §10)
```

### The interaction model

The model never authors, edits, or template-substitutes a script, and never composes JSON. Every Figma touch follows one protocol:

1. The CLI emits the exact script payload: `adhd figma-script <name> [args]` prints it from the compiled constants.
2. The model relays it verbatim to `use_figma` and saves the response to a file in the session workdir.
3. The CLI consumes the file: `adhd <verb> --figma-response <file>`.

**Chunking** (the ~25 KB MCP response cap): a cursor protocol inside the script. Responses carry `{ done: false, cursor }`; the CLI emits the next script with the cursor baked in. A deterministic loop, no hand substitution.

**Drift checks**: the extract script computes a content hash of the canonical serialization Figma-side. A drift check is one tiny call comparing hashes — never a re-extraction.

**Workdir**: all intermediate files live in a per-run directory passed by the skill (the session scratchpad), never hardcoded `/tmp` paths.

### Model responsibilities (the full list)

Conversation in the config wizard; relaying CLI-emitted scripts to MCP tools and saving responses; rendering AskUserQuestion prompts from `plan.json` and recording answers to `resolutions.json`; writing prose summaries; optionally fleshing out scaffolded layout-component bodies afterward (an ordinary coding task, outside the sync contract). Everything else is CLI.

## 5. Data model

**`adhd.config.json`** (committed):

```json
{
  "figma": { "url": "https://www.figma.com/design/<KEY>/<NAME>" },
  "naming": "kebab-case",
  "cssEntry": "app/globals.css"
}
```

Small, hand-editable, machine-writable with `JSON.parse`/`stringify`. The CLI validates it against a bundled JSON schema and prints field-level errors; a `$schema` key is optional (no machine-specific paths are ever written into the config). Component mappings do NOT live here (they are sync state, not user intent) — they live in the lock.

**`adhd.lock.json`** (committed, machine-owned):

- `baseSnapshot` — the full canonical token snapshot (values per mode) from the last completed sync. This is the merge base; a hash alone cannot attribute a change to a side.
- `figmaIds` — variable ID ↔ token path, style ID ↔ style name. Survives renames on the Figma side (a rename is *definite* when the ID persists with a new name).
- `components` — component-set node ID ↔ file path ↔ prop/axis map.
- `lastSync` — timestamp + Figma-side content hash.

No lock (first run) ⇒ lint/sync degrade to two-way diff and heuristic rename detection, and say so.

**Snapshot** — one canonical shape for "the state of a side": tokens (domain, path, value per mode, alias target if any), styles (shells + bound primitives), components (axes, per-variant per-layer token bindings, layer types). Both the Figma extractor and the code parser produce this shape; every rule and diff is a pure function over it.

## 6. Command semantics

### `/adhd:lint [path | figma-url] [--check] [--offline]`

Read-only. One extract (or none with `--offline`), one report:

- **Structure rules**: STRUCT001–010 ported from v1 with all accumulated false-positive exemptions intact.
- **Drift, three classes**: *value drift* (same token, different value per mode); *existence drift* (each side missing tokens the other has); *structural drift* (alias in Figma vs literal in code, scope mismatches, Figma variant values without a union member in the code lookup table and vice versa).
- **Rename detection, two confidence levels**: *definite* (lock ID persists under a new name) and *probable* (no lock: same value + similar name) — reported as renames, not delete+add pairs.
- **Off-system value detection in code**: Tailwind arbitrary values (`bg-[#8b5cf6]`, `text-[13px]`) and inline-style hex literals, cross-referenced against exact or near-matching tokens. Scoped to these greppable patterns to avoid false-positive noise.
- **"Cannot sync" section**: everything unsyncable (composite style shells pending §6-sync support, %-line-heights, gradients) listed with the reason. Nothing is ever silently skipped — this is a hard product rule.
- `--check`: nonzero exit for CI. `--offline`: diff code against `adhd.lock.json`'s committed `baseSnapshot` instead of live Figma (CI-friendly; no MCP auth needed) — catches hand-edited tokens that bypassed sync. Report format doubles as a PR body.

### `/adhd:sync [scope] [--push | --pull] [--pr] [--allow-unbound]`

Same snapshot machinery, then:

1. **Three-way diff** against `baseSnapshot`: each divergence is attributed — changed-in-code, changed-in-Figma, or conflict (both).
2. **Plan**: one-sided changes are fast-forwards, applied automatically after a plan preview. Prompts happen only for conflicts, deletions, and renames. `--push`/`--pull` force a direction wholesale (still never auto-deleting).
3. **Deletions are always explicit choices.** Accepted renames can optionally run a codemod over class/var usages in the codebase.
4. **Apply**: code side via `css.ts` + the component table writer (CLI edits, not model `Edit` calls); Figma side via one emitted write script. Lock updated last, atomically — a failed apply leaves the lock at the old base so the next run re-diffs honestly.
5. **Composites**: typography/shadow style shells are push-only in v2.0 (a scope choice — the plugin API can write styles; pull support may come later). The primitive variables bound into shells sync two-way. Lint states this per item.
6. **Code syntax**: every pushed variable gets its WEB code syntax set to the CSS var name — the sanctioned naming bridge; improves Figma Dev Mode output generally.
7. `--pr`: branch, commit per logical group, PR with the lint report as body (requires `gh`; degrades to committed branch + instructions without it).

**Component flows inside sync**: a mapped component's table/union drift is ordinary sync material (three-way, same prompts). An unmapped code component with `--push` triggers the capture pipeline (§7). An unmapped Figma Component Set (URL scope) triggers scaffold (§7).

### `/adhd:config`

Wizard: verifies the official Figma plugin is installed + authenticated; captures the Figma URL and tests reachability; auto-detects `cssEntry`; writes `adhd.config.json`. Offers to scaffold the mandated `Primitives`/`Semantic` collection structure into an empty Figma file (v1's wizard never validated structure — a top audit finding). The structure convention is fixed, not configurable — a deliberate rejection of per-collection mapping config, which is how v1 grew two incompatible models.

**`adhd export --dtcg`** (CLI subcommand, no skill): writes a DTCG-format `tokens/` mirror for interop with style-dictionary/Terrazzo pipelines. Pure function over the snapshot; carries no load-bearing role inside adhd itself.

## 7. Component pipeline

**Contract (unchanged from v1, now machine-enforced):** components expose string-literal unions, a props interface, and `Record<Union, string>` lookup tables; the function body is invariant under sync. Parsing and table rewriting use the TypeScript compiler API — no regex parsing of TS.

**First push** (`sync <path> --push`, no mapping): CLI parses the component → builds the variant matrix (Cartesian cap with coverage-first selection, ported) → generates the preview route → `adhd dev ensure` owns the dev-server lifecycle (probe/start/wait/PID in one command; `adhd dev cleanup` its counterpart) → model calls `generate_figma_design` → CLI emits the consolidation script (compiled from `figma/consolidate.ts`, fixture-tested) → model runs it via `use_figma` → preflight = lint scoped to the new node → mapping recorded in the lock.

**Scaffold** (Figma URL, no mapping): the serializer script makes the vector-vs-layout call and exports SVG for vector variants. The CLI generates the file: unions + props + tables always; inlined-SVG body for vector components; stub body for layout components. The model may then implement the layout body as normal development work.

## 8. Error handling principles

- Every CLI subcommand exits nonzero with a structured error and fix-up guidance (v1's "Common errors" tables move into CLI output; skills just surface them).
- No silent loss, ever: anything skipped, unsyncable, or capped is itemized in the report.
- Aborts are safe by construction: the lock only advances after a completed apply; Figma writes happen in one script invocation; partial code applies are prevented by writing all edits from one plan.
- Skills contain no recovery logic — a failed step surfaces the CLI's message and stops.

## 9. Knowledge carried over from v1

These cost real debugging time and must not be relearned:

- `generate_figma_design` returns a **frame, not a page**; parent-climbing required. `variantProperties` is read-only; `combineAsVariants` requires siblings; `data-adhd-variant` attributes are not preserved through capture.
- The `use_figma` response cap (~25 KB) forces chunked extraction (now a cursor protocol, §4).
- Lint false-positive exemptions accumulated across four fix commits (icon frames, invisible paints, COMPONENT_SET wrappers, auto-derived variant names, both-sides-aliased variables) — all become explicit, tested rule behavior.
- The `figma-real/*` fixtures and design-system fixtures port into `test/fixtures/`.
- Tailwind v4's default palette is oklch; all color comparison goes through one converter (`core/color.ts`).

## 10. Testing & CI

- **Fake-`figma` runtime harness**: a minimal `figma` global implementing the API surface our scripts use, driven by recorded document states — every `use_figma` script (extract, serialize, write, consolidate) executes in CI. This closes v1's fatal gap: its riskiest code only ever ran inside Figma.
- **Record/replay**: real MCP responses captured during development land in `test/recordings/`. Pipelines are pure functions snapshot-in → report/plan-out, tested as goldens.
- **Consolidation contract tests** against recorded `generate_figma_design` outputs — the surface that broke three times in v1.
- **CI**: esbuild build; dist-freshness check (committed bundle must match source); vitest; example-app build; skill frontmatter validation.

## 11. Porting plan

Work on a v2 branch; v1 stays intact on main until parity. Milestones, each verifiable against `example/`:

1. **Core + lint**: `core/*`, snapshot, extractor with cursor protocol, rules ported with fixtures, `/adhd:lint` end-to-end.
2. **Token sync + lock**: three-way diff, plan/apply, write script, `adhd.lock.json`, `--pr`.
3. **Component reconcile**: TS-API component parsing/writing, mapped-component sync, scaffold.
4. **Capture**: preview generation, `adhd dev`, consolidation + contract tests, first-push flow.
5. **Config wizard + cleanup**: wizard, structure scaffolding, `export --dtcg`, README rewrite + plugin manifest/marketplace metadata updated to the three-command surface (AGENTS.md rule: README must track commands in the same PR), delete v1 code.

## 12. Out of scope for v2.0

- Pulling composite style shells (typography/shadow) Figma→code — push-only in v2.0.
- DTCG Resolver module read/write (spec is ahead of the ecosystem; revisit).
- Watch mode / continuous sync; Figma webhooks.
- Enterprise REST API fast path.
- Non-Tailwind CSS targets.
