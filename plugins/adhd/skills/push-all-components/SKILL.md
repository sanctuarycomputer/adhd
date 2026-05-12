---
description: "Bulk version of /adhd:push-component. Iterates over every entry in adhd.config.ts's `components` map and runs the full push flow on each, sequentially. Halts on first failure by default (use --continue-on-error for best-effort + summary). Per-component interactivity (preview server start, capture, consolidation, preflight, --annotate prompts) is preserved — each component's push behaves exactly as if you'd invoked /adhd:push-component manually."
disable-model-invocation: true
argument-hint: "[--continue-on-error] [--max-variants <n>] [--annotate]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma mcp__plugin_figma_figma__generate_figma_design
---

# ADHD Push All Components

Bulk wrapper around `/adhd:push-component`. Reads the components map from `adhd.config.ts` and iterates over every entry, running the full per-component push flow on each. Stops on first failure unless `--continue-on-error` is passed.

**Why this skill exists:** if you've made structural changes to multiple components in code (renamed props, added variants, updated tokens) and want to push them all to Figma, this saves the typing AND keeps the Next.js dev server warm across pushes — push-component auto-starts it on the first component, and subsequent ones reuse the running instance.

**What this skill DOES NOT do:**
- Suppress per-component prompts (rollback decisions, annotate offers). Each push runs its full interactive flow.
- Apply decisions across all components ("rollback all on any failure", "annotate all"). Per-component decisions stay per-component.

## Phase 1: Validate config + read components list

Run the same Phase 1 as `/adhd:push-component`: validate `adhd.config.ts` exists, etc. Then read every key from the `components: { ... }` map using the same `node -e` snippet as `pull-all-components` Phase 1 (brace-counted scan, output to `/tmp/adhd-push-all/paths.json`).

If the resulting list is empty, abort:

```
✗ No components registered in adhd.config.ts.
Run /adhd:push-component <path> to push a component for the first time
(it writes the entry to adhd.config.ts), then re-run /adhd:push-all-components.
```

Print the planned run upfront:

```
Pushing 5 components to Figma in sequence:
  1. components/design-system/logo/index.tsx
  2. components/avatar/index.tsx
  ...
```

## Phase 2: Iterate

For each path in the list, in order:

1. Print a divider:
   ```
   ──── [N/total] pushing <path> ────
   ```

2. Invoke the phases of `/adhd:push-component` inline for this path. Pass through any flags the user gave to `/adhd:push-all-components`:
   - `--max-variants <n>` (applied uniformly to every component's variant cap)
   - `--annotate` (per-component preflight annotation)

   The per-component push-component SKILL handles its own validation, dev-server start/check, capture, consolidation, preflight, decide-or-rollback, final report, and the mapping write to `adhd.config.ts`. All of those still fire normally.

   **Dev-server reuse:** push-component's Phase 4 only starts the server if one isn't already running. The first push in the bulk run starts it (if not already up); subsequent pushes reuse the running instance. push-component's Phase 13 (cleanup) tears down the server only when it auto-started it for that single run — in the bulk case, push-component sees the server was already running and leaves it alone. **This skill's Phase 4 (below) is responsible for the final teardown.**

3. Record the outcome into `/tmp/adhd-push-all/outcomes.json`:
   ```json
   { "path": "<path>", "status": "success" | "abort" | "rollback" | "cancel", "summary": "<one-line>", "error": "<reason if any>" }
   ```
   - `success`: push-component completed Phase 12 (final report).
   - `abort`: blocking error (file missing, capture failure, etc.).
   - `rollback`: preflight produced errors and user (or default) chose to roll back the captured page.
   - `cancel`: user explicitly stopped at an in-flow prompt.

4. **Decide whether to continue:**
   - `success` or `cancel`: continue.
   - `rollback`: treated as failure for halt-on-error purposes. The user saw preflight errors and chose to roll back — they need to fix the source before bulk-pushing.
   - `abort`: same as `rollback` — failure.
   - With `--continue-on-error`: record + continue.
   - Without: print the halt message and break out of the loop.

5. Components after a halt are recorded as `skipped`.

## Phase 3: Final summary

```
Bulk push report:
  ✓ components/design-system/logo/index.tsx  — 4 variants pushed, preflight clean
  ✓ components/avatar/index.tsx              — 6 variants pushed, 1 warning
  ✗ components/button/index.tsx              — rolled back (preflight errors)
  ⏭ components/card/index.tsx                — skipped (earlier failure)

Summary: 2 succeeded, 1 failed, 1 skipped.
```

Actionable next steps:
- **All succeeded:** `All components are now in sync with Figma. Run /adhd:sync-docs if you want to refresh the design-system docs route.`
- **Any failed:** `To re-try just the failures: /adhd:push-component <path>`.
- **`--annotate` was active:** `Preflight annotations updated in the "lint" category in Figma.`

Exit 0 if all `success`/`cancel`, else 1.

## Phase 4: Cleanup (always runs)

```bash
rm -rf /tmp/adhd-push-all
```

**Dev-server teardown:** if the bulk run was the thing that started the Next.js dev server (i.e., it wasn't already running when Phase 2 began), tear it down here. Use the same teardown helper push-component uses in its Phase 13. If the server was already running when the bulk started, leave it alone — it's the user's session.

To check: at the start of Phase 2, record whether the dev server was up. Compare at Phase 4. Only kill the process if the bulk owned its lifecycle.

## Common errors

| Error | Fix-up |
|---|---|
| `No components registered in adhd.config.ts` | Run `/adhd:push-component <path>` once for a single component first to seed the mapping. |
| Mid-run rollback on preflight errors | Fix the source code issue (raw values, etc.), then re-push that component individually before resuming the bulk. |
| Dev-server start failure | Same fix as for `/adhd:push-component` solo runs — check the Next.js logs, port conflicts. |
