---
description: "Read-only report of Figma structure violations, code↔Figma drift (value, existence, structural), likely renames, off-system values in code, and un-syncable entries. All logic lives in the bundled CLI. Optional argument: a Figma URL with node-id (scoped lint) plus --check for a CI-style exit code. With no argument, lints the whole configured Figma file."
disable-model-invocation: true
argument-hint: "[<figma-url>] [--check]"
allowed-tools: Read Write Bash mcp__plugin_figma_figma__use_figma
---

# ADHD Lint

Read-only report: Figma structure violations + code↔Figma drift. All logic lives in
the bundled CLI; your only jobs are relaying scripts to Figma and saving responses.

## Steps

1. **Workdir.** Set `WORK=<session scratchpad>/adhd-lint`, `mkdir -p "$WORK"`, and
   `rm -f "$WORK"/chunk-*.json` (clears stale chunks from a prior run so they can't
   pollute this one — `readChunks` globs all `*.json` in the dir).
2. **Extract loop.** Run `node <plugin-root>/dist/adhd.js figma-script extract` and call
   `use_figma` with the printed script verbatim as `code`. Save the JSON response to
   `$WORK/chunk-00.json`. While the response has `"done": false`, re-run with
   `--cursor <cursor from the response>` and save to `chunk-01.json`, `chunk-02.json`, …
   Never edit the script or the responses.
3. **Lint.** Run:
   `node <plugin-root>/dist/adhd.js lint --dir . --figma-chunks "$WORK" --out "$WORK/report.md"`
   plus `--scope <figma-url>` if the user passed a URL, plus `--check` if they passed it.
4. **Report.** Branch on the CLI's exit code:
   - **0** — Read `$WORK/report.md` and print it.
   - **1** (only possible with `--check`) — the report was still written and the
     "N errors" summary was printed to stdout. Read `$WORK/report.md`, print it, and
     tell the user the `--check` gate failed (errors present). This is not an
     operational error — don't treat it like one.
   - **2** — operational failure. Show the CLI's stderr (the `✗` message and `→`
     fixup) and stop — do not read the report, do not improvise recovery.

`<plugin-root>` is this skill file's grandparent directory (`skills/lint/../..`).

## Errors

The CLI's stderr always contains the fix-up guidance (missing config → create
adhd.config.json, file-key mismatch, corrupted chunks). Surface it verbatim.

If `use_figma` itself fails during Step 2 (before the CLI ever runs), the Figma desktop
plugin isn't connected. Tell the user: "In Figma, run the Claude plugin (Plugins → Claude)
and retry", then stop.
