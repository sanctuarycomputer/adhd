---
description: "Bulk version of /adhd:pull-component. Iterates over every entry in adhd.config.ts's `components` map and runs the full pull flow on each, sequentially. Halts on first failure by default (use --continue-on-error for best-effort + summary). Per-component interactivity (preflight blockers, --allow-unbound escape, per-variable STRUCT015/016 resolution, Phase 2.7 missing-var discovery, sync-docs prompt) is preserved — each component's pull behaves exactly as if you'd invoked /adhd:pull-component manually."
disable-model-invocation: true
argument-hint: "[--continue-on-error] [--allow-unbound]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma mcp__plugin_figma_figma__get_metadata
---

# ADHD Pull All Components

Bulk wrapper around `/adhd:pull-component`. Reads the components map from `adhd.config.ts` and iterates over every entry, running the full per-component pull flow on each. Stops on first failure unless `--continue-on-error` is passed.

**Why this skill exists:** for design systems with many components, pulling each one manually is repetitive. This skill saves the typing AND provides a single end-of-run summary so failures don't get buried in a long log.

**What this skill DOES NOT do:**
- Suppress per-component prompts (preflight blockers, escape questions, per-variable STRUCT015/016 resolution). Each component's pull runs its full interactive flow.
- Apply decisions across all components ("add all missing vars", "take Figma for everything", etc.). Those would require a global mode and risk batch-applying choices that should be considered per-component. v2 if it proves annoying.

## Phase 1: Validate config + read components list

Run the same Phase 1 as `/adhd:pull-component`: validate `adhd.config.ts` exists at the repo root, etc.

Then read every key from the `components: { ... }` map. Use a small `node -e` snippet to avoid TS-execution dependency:

```bash
mkdir -p /tmp/adhd-pull-all
node -e '
const fs = require("node:fs");
const src = fs.readFileSync("adhd.config.ts", "utf8");
const m = /components:\s*\{([\s\S]*?)\}\s*[,;]?/.exec(src);
if (!m) { process.stdout.write("[]"); process.exit(0); }
// Use brace-counted scan for nested values (each component value is itself
// an object). This is the same logic lib/sync-docs/config-parser.js uses.
const startIdx = m.index + m[0].indexOf("{");
let depth = 1, k = startIdx + 1;
while (k < src.length && depth > 0) {
  if (src[k] === "{") depth++;
  else if (src[k] === "}") depth--;
  if (depth > 0) k++;
}
const inner = src.slice(startIdx + 1, k);
const paths = [];
let d = 0, i = 0;
while (i < inner.length) {
  const ch = inner[i];
  if (ch === "{") { d++; i++; continue; }
  if (ch === "}") { d--; i++; continue; }
  if (d === 0 && ch === "\"") {
    const end = inner.indexOf("\"", i + 1);
    if (end === -1) break;
    const key = inner.slice(i + 1, end);
    let j = end + 1;
    while (j < inner.length && /\s/.test(inner[j])) j++;
    if (inner[j] === ":") paths.push(key);
    i = end + 1; continue;
  }
  i++;
}
process.stdout.write(JSON.stringify(paths));
' > /tmp/adhd-pull-all/paths.json
```

If the resulting list is empty, abort:

```
✗ No components registered in adhd.config.ts.
Run /adhd:push-component <path> to register a component first
(it writes the entry to adhd.config.ts), then re-run /adhd:pull-all-components.
```

Print the planned run upfront so the user can see what's about to happen:

```
Pulling 5 components in sequence:
  1. components/design-system/logo/index.tsx
  2. components/avatar/index.tsx
  3. components/button/index.tsx
  4. components/card/index.tsx
  5. components/icon/index.tsx
```

## Phase 2: Iterate

For each path in the list, in order:

1. Print a divider header:
   ```
   ──── [N/total] pulling <path> ────
   ```

2. Invoke the phases of `/adhd:pull-component` inline for this path. Pass through any flags the user gave to `/adhd:pull-all-components`:
   - `--allow-unbound` (per-component STRUCT003/004/005 escape)

   The per-component pull-component SKILL handles its own validation, preflight, abort/escape logic, STRUCT015/016 resolution, opportunistic-variable discovery (Phase 2.7), final report, and the post-success sync-docs prompt. Annotations land automatically on any abort — no flag forwarding needed.

3. Record the outcome for this component into `/tmp/adhd-pull-all/outcomes.json` (append-only). Outcome shape:
   ```json
   { "path": "<path>", "status": "success" | "abort" | "cancel" | "unchanged", "summary": "<one-line summary>", "error": "<abort reason if any>" }
   ```
   - `success`: the per-component pull completed Phase 10 (final report).
   - `unchanged`: the per-component pull's fingerprint short-circuit (pull-component Phase 2.5) matched the stored value — Figma + relevant config haven't changed since the last successful pull, no work was done. Recorded separately from `success` so the bulk summary surfaces how many were skipped vs how many were actively re-synced.
   - `abort`: any blocking error (STRUCT011, unbound without escape, file missing, etc.).
   - `cancel`: user said "no" / cancel on an in-flow prompt (treated as a halt — they explicitly stopped).

4. **Decide whether to continue:**
   - If `success`, `unchanged`, or `cancel`: continue to the next component. (`cancel` halts the inner per-component flow but is not treated as a bulk failure — the user made an explicit choice. `unchanged` is the fingerprint-skip case — also not a failure.)
   - If `abort`:
     - With `--continue-on-error`: record + continue.
     - Without (default): print `Halted on <path>. Re-run with --continue-on-error to push through subsequent components, or fix the issue and re-run /adhd:pull-component <path> directly.` Then break out of the loop and go to Phase 3.

5. **Skipped components** (when halt-on-error fires partway through): the remaining paths are NOT iterated. Their outcomes are recorded as `{ status: "skipped" }` so they show up in the final summary.

## Phase 3: Final summary

Read `/tmp/adhd-pull-all/outcomes.json` and produce:

```
Bulk pull report:
  ✓ components/design-system/logo/index.tsx  — 3 cells updated
  ✓ components/avatar/index.tsx              — no changes
  ⊙ components/badge/index.tsx               — unchanged (fingerprint match, last pulled 2026-05-10T...)
  ⊙ components/spinner/index.tsx             — unchanged (fingerprint match, last pulled 2026-05-11T...)
  ✗ components/button/index.tsx              — preflight: STRUCT011 (2 var-naming issues)
  ⏭ components/card/index.tsx                — skipped (earlier failure)
  ⏭ components/icon/index.tsx                — skipped (earlier failure)

Summary: 2 re-synced, 2 unchanged, 1 failed, 2 skipped.
```

The `⊙` marker covers the fingerprint-short-circuit case — no work was done for that component because Figma + relevant config matched the stored fingerprint. Surface the `pulledAt` from `adhd.config.ts`'s component entry so designers can confirm what "last pulled" actually means.

Append actionable next steps based on outcome:

- **All succeeded:** print `Run /adhd:sync-docs to refresh the design-system docs route.` (already prompted per component but worth reminding for the whole run).
- **Any failed:** print `To re-try just the failures: /adhd:pull-component <path>` with the actual failed paths listed.
- **Any abort happened during the run** (per-component pulls auto-push annotations on abort): print `Annotations were pushed to Figma for unresolved violations during this run. Check the "lint" category to see what needs fixing.`

Exit code:
- All `success`/`cancel`: exit 0.
- Any `abort`/`skipped`: exit 1.

## Phase 4: Cleanup

Always runs (even on abort):

```bash
rm -rf /tmp/adhd-pull-all
```

## Common errors

| Error | Fix-up |
|---|---|
| `No components registered in adhd.config.ts` | Register a component first via `/adhd:push-component <path>`, or edit `adhd.config.ts` manually. |
| Mid-run halt on STRUCT011 | Rename the offending Figma variables (see the STRUCT011 message for the per-variable target), then re-run. |
| Mid-run halt on unbound values | Bind the values in Figma OR add `--allow-unbound` to the bulk command (applies to every component, so use carefully). |
