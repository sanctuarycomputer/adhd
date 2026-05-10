#!/usr/bin/env node
'use strict';

/**
 * /adhd:push-component CLI. Subcommands:
 *   parse        — TS analysis of a component file → variant axes + prop manifest JSON
 *   generate-preview — emit a Next.js preview page TSX
 *   consolidation-script — emit the use_figma JS string for the cleanup phase
 *   preflight    — run lint-engine against a Figma extract JSON
 *   --help
 */

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h' || args.length === 0) {
    console.log(`Usage:
  cli.js parse <component-path> --output <manifest.json>
  cli.js generate-preview --manifest <manifest.json> --max-variants <n> --output <preview.tsx>
  cli.js consolidation-script --manifest <manifest.json> --captured-page-id <id> --reverse-index <ri.json> --output <script.js>
  cli.js preflight --design-context <ctx.json> --variable-defs <vars.json> --globals-css <path> --config <path> --output <report.md>`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  console.error('push-component: subcommand not implemented yet');
  process.exit(2);
}

main();
