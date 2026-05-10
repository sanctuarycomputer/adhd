#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseCodeDesignSystem } = require('./code-parser');
const { parseFigmaDesignSystem } = require('./figma-parser');
const { compareDesignSystems } = require('./comparator');
const { buildFigmaActions } = require('./figma-write-actions');
const { assembleExtract } = require('./figma-extract-script');

function parseArgs(argv) {
  const args = {};
  args._ = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js compare           --code <globals.css> --figma <figma.json> --output <diff.json>
  cli.js apply             --diff <diff.json> --resolutions <resolutions.json> --direction <push|pull> --output <actions.json>
  cli.js assemble-extract  --chunks-dir <dir> --output <figma.json>

compare:
  Reads globals.css and a figma-extract JSON (the result of running
  figma-extract-script.js inside use_figma). Produces a diff JSON.

apply:
  Reads a diff JSON and a resolutions JSON (user's choices for each
  conflict). Produces an actions list. For push, actions are Figma
  variable mutations. For pull, actions are CSS edits.

assemble-extract:
  Reads every *.json file in --chunks-dir (responses from
  EXTRACT_CHUNK_SCRIPT — one manifest + one-or-more slices) and merges them
  into the single-shot extract shape that compare expects. Use this when the
  full design system is too large to fetch in a single use_figma call.`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  const cmd = args._[0];

  if (cmd === 'compare') {
    const css = fs.readFileSync(args.code, 'utf8');
    const figmaExtract = JSON.parse(fs.readFileSync(args.figma, 'utf8'));
    // Default: include Tailwind v4's full default theme so push/pull see
    // the complete design system, not just what's redeclared in globals.css.
    // Disable with --no-tailwind-defaults if you only want explicit overrides.
    const includeTailwindDefaults = !('no-tailwind-defaults' in args);
    const codeDS = parseCodeDesignSystem(css, { includeTailwindDefaults });
    const figmaDS = parseFigmaDesignSystem(figmaExtract);
    const diff = compareDesignSystems(codeDS, figmaDS);
    fs.writeFileSync(args.output, JSON.stringify(diff, null, 2));
    process.exit(0);
  }

  if (cmd === 'apply') {
    const diff = JSON.parse(fs.readFileSync(args.diff, 'utf8'));
    const resolutions = JSON.parse(fs.readFileSync(args.resolutions, 'utf8'));
    const actions = buildFigmaActions(diff, resolutions, args.direction);
    fs.writeFileSync(args.output, JSON.stringify(actions, null, 2));
    process.exit(0);
  }

  if (cmd === 'assemble-extract') {
    const dir = args['chunks-dir'];
    if (!dir) { console.error('Missing --chunks-dir'); process.exit(2); }
    if (!args.output) { console.error('Missing --output'); process.exit(2); }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const payloads = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const extract = assembleExtract(payloads);
    fs.writeFileSync(args.output, JSON.stringify(extract, null, 2));
    process.exit(0);
  }

  console.error('Unknown command. Use --help.');
  process.exit(2);
}

main();
