#!/usr/bin/env node
'use strict';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) { args[a.slice(2)] = argv[++i]; }
    else { args._.push(a); }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js parse-tokens --css <path> --output <json>
  cli.js parse-props --source <component.tsx> --output <json>
  cli.js slug --paths <comma-separated> --output <json>
  cli.js patch-next-config --config <path> --route-url <url>
  cli.js patch-robots --robots <path> --route-url <url>
  cli.js detect-install --app-dir <path>
  cli.js install --config <choices.json>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];
  // Subcommands wired in later tasks. Reject unknown to keep behavior strict.
  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
