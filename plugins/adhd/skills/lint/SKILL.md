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

1. **Workdir.** Set `WORK=<session scratchpad>/adhd-lint` and `mkdir -p "$WORK"`.
2. **Extract loop.** Run `node <plugin-root>/dist/adhd.js figma-script extract` and call
   `use_figma` with the printed script verbatim as `code`. Save the JSON response to
   `$WORK/chunk-00.json`. While the response has `"done": false`, re-run with
   `--cursor <cursor from the response>` and save to `chunk-01.json`, `chunk-02.json`, …
   Never edit the script or the responses.
3. **Lint.** Run:
   `node <plugin-root>/dist/adhd.js lint --dir . --figma-chunks "$WORK" --out "$WORK/report.md"`
   plus `--scope <figma-url>` if the user passed a URL, plus `--check` if they passed it.
4. **Report.** Read `$WORK/report.md` and print it. If the CLI exited 2, show its error
   and fixup text and stop — do not improvise recovery.

`<plugin-root>` is this skill file's grandparent directory (`skills/lint/../..`).

## Errors

The CLI's stderr always contains the fix-up guidance (missing config → run /adhd:config,
file-key mismatch, corrupted chunks). Surface it verbatim.
