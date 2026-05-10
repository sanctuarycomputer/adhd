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

const fs = require('node:fs');
const path = require('node:path');
const { parseComponent } = require('./parse-component');
const { defaultForProp } = require('./prop-defaults');
const { variantMatrix, capWithCoverage } = require('./variant-matrix');
const { generatePreviewTsx } = require('./preview-generator');

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
  cli.js parse <component-path> --output <manifest.json> [--import-path <path>] [--max-variants <n>]
  cli.js generate-preview --manifest <manifest.json> --output <preview.tsx>
  cli.js consolidation-script --manifest <manifest.json> --captured-page-id <id> --reverse-index <ri.json> --output <script.js>
  cli.js preflight --design-context <ctx.json> --variable-defs <vars.json> --globals-css <path> --config <path> --output <report.md>`);
}

function inferImportPath(componentPath) {
  // Heuristic: convert app-root-relative path to "@/<rest>". User can override with --import-path.
  // e.g. example/app/components/avatar/index.tsx → @/app/components/avatar
  // We strip the .tsx and any /index suffix.
  let p = componentPath.replace(/\\/g, '/');
  // Find an "app/" segment and treat everything from there as the alias source
  const idx = p.indexOf('/app/');
  if (idx === -1) {
    // Fallback: use the file's directory name
    return './' + path.basename(path.dirname(p));
  }
  p = p.slice(idx + 1); // drop leading "/example/" etc.
  p = p.replace(/\.tsx?$/, '').replace(/\/index$/, '');
  return '@/' + p;
}

function buildManifest(componentPath, opts) {
  const source = fs.readFileSync(componentPath, 'utf8');
  const parsed = parseComponent(source);

  // Build variant axes from union-typed props
  const axes = {};
  const nonVariantProps = {};
  for (const [pname, pmeta] of Object.entries(parsed.props)) {
    if (pmeta.type === 'union') {
      const values = pmeta.values.slice();
      if (pmeta.optional) values.push('undefined'); // implicit
      axes[pname] = values;
    } else {
      const def = defaultForProp(pname, pmeta);
      if (def !== null) nonVariantProps[pname] = def;
    }
  }

  // Cartesian + optional cap
  const fullMatrix = variantMatrix(axes);
  const maxVariants = opts['max-variants'] ? parseInt(opts['max-variants'], 10) : null;
  let variants = fullMatrix;
  if (maxVariants && fullMatrix.length > maxVariants) {
    variants = capWithCoverage(fullMatrix, axes, maxVariants);
  }

  return {
    componentName: parsed.componentName,
    importPath: opts['import-path'] || inferImportPath(componentPath),
    unions: parsed.unions,
    props: parsed.props,
    axes,
    variants,
    nonVariantProps,
    totalCombinations: fullMatrix.length,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];

  if (cmd === 'parse') {
    const componentPath = args._[1];
    if (!componentPath || !args.output) { console.error('Usage: parse <path> --output <json>'); process.exit(2); }
    const manifest = buildManifest(componentPath, args);
    fs.writeFileSync(args.output, JSON.stringify(manifest, null, 2));
    process.exit(0);
  }

  if (cmd === 'generate-preview') {
    if (!args.manifest || !args.output) { console.error('Usage: generate-preview --manifest <json> --output <tsx>'); process.exit(2); }
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    fs.writeFileSync(args.output, generatePreviewTsx(manifest));
    process.exit(0);
  }

  if (cmd === 'consolidation-script' || cmd === 'preflight') {
    console.error('Not yet implemented (Task 9 wires these up)');
    process.exit(2);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
