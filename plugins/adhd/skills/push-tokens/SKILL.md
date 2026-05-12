---
description: "Push the local design tokens (globals.css variables + named styles) into the configured Figma file. Two-way diff with per-attribute conflict prompts; additive (never deletes from Figma). Reads adhd.config.ts at the repo root. Pass --dry-run to preview without writing. Pass --include-tailwind to seed Figma with the entire Tailwind v4 palette so designers have every utility available as a variable."
disable-model-invocation: true
argument-hint: "[--dry-run] [--include-tailwind]"
allowed-tools: Read Write Edit Bash AskUserQuestion mcp__plugin_figma_figma__use_figma
---

# ADHD Push Tokens

Pushes the codebase's design tokens (variables + named styles) into the configured Figma file. Compares both sides; for each conflicting variable, prompts the user; for variables that exist only in code, creates them in Figma; for variables that exist only in Figma, leaves them alone (additive policy).

Pass `--dry-run` to see exactly what would be added or overwritten without making any changes — no prompts, no writes, no MCP traffic beyond the initial extract.

Pass `--include-tailwind` to also push every Tailwind v4 default (the full color palette, the spacing scale, radii, breakpoints, etc.). Useful as a one-time **seed** when setting up a fresh Figma file so designers can pick from the same token space the code can render. Without this flag, daily pushes stay focused on user-authored tokens only — the Tailwind defaults are implicit on both sides and the additive policy keeps Figma clean.

**Authoritative spec:** `docs/superpowers/specs/2026-05-10-adhd-push-pull-design-system.md`

## Phase 1: Validate config

Read `adhd.config.ts` at the repo root with the `Read` tool. If it doesn't exist, abort: "Run /adhd:config first to set up ADHD."

Extract `figma.url` (required) and `cssEntry` (optional; auto-detect `app/globals.css` then `src/app/globals.css`). Extract the file key from `figma.url` — the segment after `/design/`.

## Phase 1.5: Disposition wizard (runs EVERY push)

Walk the user through seven `AskUserQuestion` prompts to set per-domain push policy. The wizard runs on every invocation — including `--dry-run` — so the dry-run preview reflects exactly what the live push would do. No persistence: dispositions live in `/tmp/adhd-push/dispositions.json` for this run only.

Issue each question in order. After each answer, append the resulting key/value to a running dispositions object. Question text and options:

**1. Color** — `Header: "Color"`
   Question: "Which color tokens should we push to Figma?"
   - `"Push all (recommended for seeding Figma)"` → `color: "all"`
   - `"Push semantic only (skip --color-zinc-*, --color-blue-*, etc.)"` → `color: "semantic-only"`
   - `"Skip colors entirely"` → `color: "skip"`

**2. Typography** — `Header: "Typography"`
   Question: "Which typography scales should we push? (Font families always route to Figma text styles, never variables.)"
   - `"Push all scales (text sizes, font-weights, leading, tracking)"` → `typography: "all"`
   - `"Push sizes + weights only (skip leading + tracking)"` → `typography: "sizes-and-weights"`
   - `"Skip typography variables"` → `typography: "skip"`

**3. Spacing** — `Header: "Spacing"`
   Question: "Which spacing tokens should we push?"
   - `"Push the full Tailwind 0..96 scale"` → `spacing: "all"`
   - `"Push only my authored spacing tokens (skip Tailwind scale)"` → `spacing: "authored-only"`
   - `"Skip spacing"` → `spacing: "skip"`

**4. Radius + border width** — `Header: "Radius / border"`
   Question: "Push corner radius + border-width tokens?"
   - `"Yes — these bind to Figma's corner radius and stroke weight"` → `radiusAndBorder: "push"`
   - `"Skip"` → `radiusAndBorder: "skip"`

**5. Shadow** — `Header: "Shadow"`
   Question: "Push shadow tokens as Figma effect styles?"
   - `"Yes, push as effect styles (Figma's native shadow channel)"` → `shadow: "effect-styles"`
   - `"Skip — manage shadows directly in Figma"` → `shadow: "skip"`

**6. Opacity** — `Header: "Opacity"`
   Question: "Push opacity tokens? Tailwind applies opacity via `/<percent>` class modifiers, not variables."
   - `"Skip (recommended — matches Tailwind's class-modifier pattern)"` → `opacity: "skip"`
   - `"Push as variables anyway (for documentation)"` → `opacity: "push"`

**7. Utility domains** — `Header: "Utilities"`
   Question: "Push utility tokens that Figma doesn't natively consume (z-index, animate, ease, aspect, perspective, container, breakpoint, blur)?"
   - `"Skip all (recommended — none of these bind to Figma properties)"` → `utilityDomains: "skip"`
   - `"Push anyway for documentation"` → `utilityDomains: "push"`

After all seven answers, write the dispositions object to `/tmp/adhd-push/dispositions.json` via the `Write` tool. Example shape:

```json
{
  "color": "all",
  "typography": "all",
  "spacing": "all",
  "radiusAndBorder": "push",
  "shadow": "effect-styles",
  "opacity": "skip",
  "utilityDomains": "skip"
}
```

## Phase 2: Read both sides

Use the `Read` tool to read the resolved `globals.css` path. Save it to `/tmp/adhd-push/globals.css` via the `Write` tool.

Use `mcp__plugin_figma_figma__use_figma` to extract the Figma side's state. Pick the right strategy based on file size:

**Strategy A — single-shot (small files, ≲60 variables).** Read `plugins/adhd/lib/design-system/figma-extract-script.js` and pass the value of the exported `EXTRACT_SCRIPT` constant as the `code` parameter. Save the response JSON to `/tmp/adhd-push/figma.json` via the `Write` tool.

**Strategy B — chunked (recommended for full Tailwind-v4 design systems).** The MCP `use_figma` response is truncated at roughly 20–30 KB, so a full color collection (≈300 vars × 2 modes) exceeds that ceiling and the single-shot script returns a half-baked, JSON-truncated payload. Use the paginated extractor instead:

1. Read `plugins/adhd/lib/design-system/figma-extract-script.js`. The file exports an `EXTRACT_CHUNK_SCRIPT` template and a `CHUNK_SIZE` default.
2. **Manifest call.** Substitute `__INCLUDE_META__ = true` and `__VAR_INDEX__ = null` into the script, pass to `use_figma`. Save the response to `/tmp/adhd-push/chunks/00-manifest.json` via `Write`.
3. **Slice calls.** Read the manifest's `collections` array. For each collection, iterate `from = 0; from < variableCount; from += CHUNK_SIZE`. For each iteration, substitute `__INCLUDE_META__ = false` and `__VAR_INDEX__ = {collectionId: '<id>', from, to: from + CHUNK_SIZE}` into the script, call `use_figma`, and write the response to `/tmp/adhd-push/chunks/<NN>-<collection>-<from>.json`.
4. **Assemble.** Run `node plugins/adhd/lib/design-system/cli.js assemble-extract --chunks-dir /tmp/adhd-push/chunks --output /tmp/adhd-push/figma.json`. The CLI merges the manifest + slices into the single-shot extract shape that `compare` expects, and throws if any collection's variable count doesn't match the manifest (catches truncated chunks).

If Strategy A's response shows visible truncation (look for an unterminated JSON object or a `// truncated to <N>kb` marker at the tail), fall back to Strategy B and re-run from step 1. Don't try to repair the truncated payload by hand.

## Phase 3: Run the comparator

Use `Bash`. If the user passed `--include-tailwind`, add `--include-tailwind` to the compare invocation so the diff surfaces every Tailwind default that's missing from Figma. Otherwise omit it — the comparator filters Tailwind-default-origin tokens out of `codeOnly` so the diff stays focused on user-authored changes.

```bash
node plugins/adhd/lib/design-system/cli.js compare \
  --code /tmp/adhd-push/globals.css \
  --figma /tmp/adhd-push/figma.json \
  --output /tmp/adhd-push/diff.json \
  [--include-tailwind]
```

Read `/tmp/adhd-push/diff.json`. The diff has four arrays: `same`, `conflict`, `codeOnly`, `figmaOnly`.

If `conflict.length === 0` and `codeOnly.length === 0`, print "Figma is already in sync with code. No changes." and exit 0.

## Phase 3b: Dry run (only if `--dry-run` was passed)

If the user invoked `/adhd:push-tokens --dry-run`, build the action plan first (so the preview reflects the user's wizard answers — every disposition's effect shows in the output), then preview, then exit BEFORE the conflict prompts:

```bash
# Build actions with the wizard's dispositions but no resolutions
# (dry-run never resolves conflicts — it surfaces them).
echo "[]" > /tmp/adhd-push/resolutions.json
node plugins/adhd/lib/design-system/cli.js apply \
  --diff /tmp/adhd-push/diff.json \
  --resolutions /tmp/adhd-push/resolutions.json \
  --dispositions /tmp/adhd-push/dispositions.json \
  --direction push \
  --output /tmp/adhd-push/actions.json

node plugins/adhd/lib/design-system/cli.js preview \
  --diff /tmp/adhd-push/diff.json \
  --actions /tmp/adhd-push/actions.json \
  --direction push
```

The preview splits additions into two lanes: "Would add to Figma" (tokens the action builder would push) and "Would NOT add to Figma" (tokens filtered by the user's dispositions, grouped by reason). Conflicts surface separately. Echo the output verbatim, then print: `Dry run complete. Re-run without --dry-run to apply (you'll be prompted on each conflict and asked the disposition questions again).` Exit 0.

If `--dry-run` was NOT passed, skip this phase and continue to Phase 4.

## Phase 4: Resolve conflicts via AskUserQuestion

For each conflict in `diff.conflict`, use `AskUserQuestion` with these four options:
- "Keep Figma value (no change)" → resolution `{path, mode, winner: 'figma'}`
- "Use code value (overwrite Figma)" → `{path, mode, winner: 'code'}`
- "Use Figma's values for all N conflicts" → batch confirm (see below)
- "Use code's values for all N conflicts" → batch confirm

If the user picks a batch option, follow up with another `AskUserQuestion`:
- "Apply all" → apply chosen winner to ALL remaining conflicts; continue without further per-conflict prompts
- "Cancel — go back to per-conflict review" → resume per-conflict loop at current position

Build a `resolutions` array of `{path, mode, winner}` objects. Save it to `/tmp/adhd-push/resolutions.json` via the `Write` tool.

## Phase 5: Build actions

Pass the wizard's dispositions so the action builder honors the user's per-domain choices.

```bash
node plugins/adhd/lib/design-system/cli.js apply \
  --diff /tmp/adhd-push/diff.json \
  --resolutions /tmp/adhd-push/resolutions.json \
  --dispositions /tmp/adhd-push/dispositions.json \
  --direction push \
  --output /tmp/adhd-push/actions.json
```

Read `/tmp/adhd-push/actions.json`. Count `skip-by-disposition` entries — they're informational only (no Figma write happens for these). If the file contains only skip actions (no `create-variable` or `create-effect-style`), print "Nothing to push given your disposition choices." and exit 0.

## Phase 6: Drift check (re-fetch Figma)

Re-run the extract script via `use_figma` (same call as Phase 2). Save the response to `/tmp/adhd-push/figma-recheck.json`. Compare to `/tmp/adhd-push/figma.json` byte-for-byte:

```bash
diff /tmp/adhd-push/figma.json /tmp/adhd-push/figma-recheck.json
```

If they differ, abort with: "Figma drifted during this run. Re-run /adhd:push-tokens to see fresh conflicts." Exit 1.

## Phase 7: Apply actions to Figma

Load the write script from `plugins/adhd/lib/design-system/figma-write-script.js`'s `WRITE_SCRIPT` export. Substitute `__ACTIONS__` with the contents of `/tmp/adhd-push/actions.json` (the actions array, JSON-stringified inline into the script).

Call `mcp__plugin_figma_figma__use_figma` with the substituted script. The response contains `{ applied, errors }`.

If `errors.length > 0`, print the error list and exit 1.

## Phase 8: Final report

Print:
```
✓ Pushed to Figma:
  - <N> variables created
  - <M> conflicts resolved
  - <K> figma-only variables left untouched (additive policy)
```

Also count `skip-by-disposition` actions in `actions.json`, group them by `reason`, and append a section if any are present:

```
  - <S> token(s) skipped by your disposition choices:
      <count> × <reason>
      <count> × <reason>
      ...
```

This is informational — the user already chose these in the wizard. Surfacing them in the report confirms the policy held end-to-end.

## Common errors

| Error | Fix-up guidance |
|---|---|
| `adhd.config.ts not found` | Run `/adhd:config`. |
| `globals.css not found` | Pass `cssEntry` in adhd.config.ts or place the file at `app/globals.css`. |
| `Figma drifted during this run` | Someone changed Figma while you were resolving conflicts. Re-run `/adhd:push-tokens`. |
| `Figma MCP unreachable` | Verify the figma plugin is installed: `claude plugin install figma@claude-plugins-official`. |
