#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { readComponentMapping, addComponentMapping, reverseLookupPath } = require('./config-writer');

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
  cli.js config-write --config <adhd.config.ts> --path <relative-path> --figma-url <url>
  cli.js config-read --config <adhd.config.ts> --path <relative-path>
  cli.js config-reverse --config <adhd.config.ts> --figma-url <url>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];

  if (cmd === 'config-write') {
    if (!args.config || !args.path || !args['figma-url']) {
      console.error('Usage: config-write --config <path> --path <rel> --figma-url <url>');
      process.exit(2);
    }
    const source = fs.readFileSync(args.config, 'utf8');
    const out = addComponentMapping(source, args.path, args['figma-url']);
    fs.writeFileSync(args.config, out);
    process.exit(0);
  }

  if (cmd === 'config-read') {
    if (!args.config || !args.path) {
      console.error('Usage: config-read --config <path> --path <rel>');
      process.exit(2);
    }
    const source = fs.readFileSync(args.config, 'utf8');
    const r = readComponentMapping(source, args.path);
    if (!r) { process.exit(1); }
    process.stdout.write(r.figma.url);
    process.exit(0);
  }

  if (cmd === 'config-reverse') {
    if (!args.config || !args['figma-url']) {
      console.error('Usage: config-reverse --config <path> --figma-url <url>');
      process.exit(2);
    }
    const source = fs.readFileSync(args.config, 'utf8');
    const r = reverseLookupPath(source, args['figma-url']);
    if (!r) { process.exit(1); }
    process.stdout.write(r);
    process.exit(0);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
