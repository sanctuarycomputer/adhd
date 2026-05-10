#!/usr/bin/env node
'use strict';

/**
 * ADHD design-system CLI.
 *
 * Modes:
 *   compare  — read both sides, output { same, conflict, codeOnly, figmaOnly } as JSON
 *   apply    — read a resolved-actions JSON, output the write-script payload
 *
 * Inputs depend on mode; see --help.
 */

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage:
  cli.js compare --code <globals.css> --figma <figma.json> --output <diff.json>
  cli.js apply   --diff <diff.json> --resolutions <resolutions.json> --direction <push|pull> --output <actions.json>`);
    process.exit(0);
  }
  console.error('design-system: not implemented yet');
  process.exit(2);
}

main();
