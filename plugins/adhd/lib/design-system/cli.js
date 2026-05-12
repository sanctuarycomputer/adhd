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
  cli.js preview           --diff <diff.json> --direction <push|pull>
  cli.js assemble-extract  --chunks-dir <dir> --output <figma.json>

compare:
  Reads globals.css and a figma-extract JSON (the result of running
  figma-extract-script.js inside use_figma). Produces a diff JSON.

apply:
  Reads a diff JSON and a resolutions JSON (user's choices for each
  conflict). Produces an actions list. For push, actions are Figma
  variable mutations. For pull, actions are CSS edits.

preview:
  Reads a diff JSON and prints a human-readable dry-run preview to stdout
  — which variables would be added, which would conflict with existing
  values on the destination side. No prompts, no writes. Used by
  /adhd:push-tokens --dry-run and /adhd:pull-tokens --dry-run.

assemble-extract:
  Reads every *.json file in --chunks-dir (responses from
  EXTRACT_CHUNK_SCRIPT — one manifest + one-or-more slices) and merges them
  into the single-shot extract shape that compare expects. Use this when the
  full design system is too large to fetch in a single use_figma call.`);
}

// Renders a value (hex string, px string, shadow descriptor, etc.) in a
// single short token. Shadows / nested objects collapse to a short JSON
// representation so the alignment column stays sane. Conservative — the
// preview is for spot-checking, not full fidelity.
function fmtValue(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

// One line per (path, mode). Code-only and figma-only token entries store
// their values per mode under `values`; conflict entries already arrive
// flattened by mode.
function formatPreview(diff, direction) {
  if (direction !== 'push' && direction !== 'pull') {
    throw new Error(`preview: --direction must be 'push' or 'pull', got '${direction}'`);
  }
  const fromSide = direction === 'push' ? 'code'  : 'figma';
  const toSide   = direction === 'push' ? 'Figma' : 'code';
  const fromOnly = direction === 'push' ? diff.codeOnly  : diff.figmaOnly;
  const toOnly   = direction === 'push' ? diff.figmaOnly : diff.codeOnly;

  const lines = [];
  lines.push(`DRY RUN — ${fromSide} → ${toSide}. No changes will be applied.`);
  lines.push('');

  // Additions: tokens that exist only on the source side. Each token may
  // span multiple modes; emit one row per mode.
  const addRows = [];
  for (const tok of fromOnly) {
    for (const [mode, value] of Object.entries(tok.values || {})) {
      addRows.push({ path: tok.path, mode, value });
    }
  }
  addRows.sort((a, b) => a.path.localeCompare(b.path) || a.mode.localeCompare(b.mode));

  if (addRows.length === 0) {
    lines.push(`Would add to ${toSide}: none.`);
  } else {
    lines.push(`Would add to ${toSide} (${addRows.length} entr${addRows.length === 1 ? 'y' : 'ies'}):`);
    const pathW = Math.max(...addRows.map(r => r.path.length));
    const modeW = Math.max(...addRows.map(r => r.mode.length));
    for (const r of addRows) {
      lines.push(`  + ${r.path.padEnd(pathW)}  (${r.mode.padEnd(modeW)})  = ${fmtValue(r.value)}`);
    }
  }
  lines.push('');

  // Conflicts: same path on both sides, different value per mode. Show
  // BOTH sides so the user can judge — the dry run intentionally doesn't
  // pre-resolve in favor of either side, since the prompt loop in Phase 4
  // is where resolution happens.
  const conflicts = diff.conflict || [];
  if (conflicts.length === 0) {
    lines.push(`Would overwrite in ${toSide}: none.`);
  } else {
    lines.push(`Would prompt for ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} (existing on both sides, values differ):`);
    const pathW = Math.max(...conflicts.map(c => c.path.length));
    const modeW = Math.max(...conflicts.map(c => c.mode.length));
    for (const c of conflicts) {
      lines.push(`  ! ${c.path.padEnd(pathW)}  (${c.mode.padEnd(modeW)})  code=${fmtValue(c.code)}  figma=${fmtValue(c.figma)}`);
    }
    lines.push('');
    lines.push(`  Per-conflict prompts let you keep ${fromSide}'s value or ${toSide === 'Figma' ? toSide.toLowerCase() : toSide}'s. Either way, no removal — only the chosen value is written.`);
  }
  lines.push('');

  // Other-side-only: tokens that exist only on the destination. The
  // additive policy means we never delete these; they're shown only so
  // the user understands the full surface.
  const toOnlyCount = (toOnly || []).reduce((n, t) => n + Object.keys(t.values || {}).length, 0);
  lines.push(`${toSide}-only (left untouched per additive policy): ${toOnlyCount} entr${toOnlyCount === 1 ? 'y' : 'ies'}.`);
  lines.push('');
  lines.push(`To apply: re-run without --dry-run.`);

  return lines.join('\n');
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

  if (cmd === 'preview') {
    if (!args.diff) { console.error('Missing --diff'); process.exit(2); }
    if (!args.direction) { console.error('Missing --direction'); process.exit(2); }
    const diff = JSON.parse(fs.readFileSync(args.diff, 'utf8'));
    process.stdout.write(formatPreview(diff, args.direction) + '\n');
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

module.exports = { formatPreview };
