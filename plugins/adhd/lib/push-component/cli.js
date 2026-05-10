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

function buildConsolidationScript(manifest, reverseIndex, pageId) {
  const MANIFEST_JSON = JSON.stringify(manifest);
  const RI_JSON = JSON.stringify(reverseIndex);
  return `
const PAGE_ID = ${JSON.stringify(pageId)};
const MANIFEST = ${MANIFEST_JSON};
const REVERSE_INDEX = ${RI_JSON};

// 1. Load the captured page
const page = await figma.getNodeByIdAsync(PAGE_ID);
if (!page || page.type !== 'PAGE') throw new Error('Captured page not found: ' + PAGE_ID);
await figma.setCurrentPageAsync(page);

// 2. Find variant frames by data-adhd-variant in layer name
function findVariants(root) {
  const out = [];
  function walk(n) {
    if (n.name && n.name.includes('data-adhd-variant=')) { out.push(n); return; }
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  }
  walk(root);
  return out;
}
let variantFrames = findVariants(page);
if (variantFrames.length === 0) {
  throw new Error('Capture produced no recognizable variant frames');
}

// 3. Extract variant key
function variantKeyFromName(name) {
  const m = /data-adhd-variant="?([^"]+)"?/.exec(name); return m ? m[1] : null;
}
function keyToProps(key) {
  const out = {};
  for (const pair of key.split(';')) { const [k, v] = pair.split('='); out[k] = v; }
  return out;
}

// 4. Visual-signature dedup (inline implementation matching visual-signature.js)
function structuralHash(node) {
  const RELEVANT = ['type','width','height','layoutMode','paddingTop','paddingBottom','paddingLeft','paddingRight','itemSpacing','cornerRadius','fills','strokes','effects','characters','fontSize'];
  function pick(n) {
    if (!n || typeof n !== 'object') return n;
    if (Array.isArray(n)) return n.map(pick);
    const out = {};
    for (const k of RELEVANT) if (k in n) out[k] = pick(n[k]);
    if (Array.isArray(n.children)) out.children = n.children.map(pick);
    return out;
  }
  // Inline hash (no crypto in Figma sandbox; use a deterministic JSON-stringify)
  return JSON.stringify(pick(node));
}
const bySig = new Map();
for (const f of variantFrames) {
  const sig = structuralHash(f);
  if (!bySig.has(sig)) bySig.set(sig, []);
  bySig.get(sig).push(f);
}
const survivors = [];
const collapsed = [];
for (const [sig, frames] of bySig) {
  const sorted = frames.sort((a,b) => (variantKeyFromName(a.name)||'').localeCompare(variantKeyFromName(b.name)||''));
  survivors.push(sorted[0]);
  for (let i = 1; i < sorted.length; i++) { collapsed.push(sorted[i].name); sorted[i].remove(); }
}

// 5. Compute effective variant properties (drop axes that don't distinguish any survivors)
const survivorProps = survivors.map(s => keyToProps(variantKeyFromName(s.name) || ''));
const axisNames = new Set();
for (const p of survivorProps) for (const k of Object.keys(p)) axisNames.add(k);
const effectiveAxes = new Set();
for (const axis of axisNames) {
  const values = new Set(survivorProps.map(p => p[axis]));
  if (values.size > 1) effectiveAxes.add(axis);
}

// 6. Combine into Component Set
const sorted = survivors.sort((a,b) => (variantKeyFromName(a.name)||'').localeCompare(variantKeyFromName(b.name)||''));
const componentSet = figma.combineAsVariants(sorted, page);
componentSet.name = MANIFEST.componentName;

// 7. Set variantProperties only for effective axes; drop 'undefined' values
for (const child of componentSet.children) {
  const key = variantKeyFromName(child.name);
  const props = key ? keyToProps(key) : {};
  const effective = {};
  for (const k of Object.keys(props)) {
    if (effectiveAxes.has(k) && props[k] !== 'undefined') effective[k] = props[k];
  }
  child.variantProperties = effective;
}

// 8. Rebind raw fills / paddings / radii to existing Figma variables.
// NOTE: to2 (2-decimal) matches reverse-index.js's colorKey quantization.
function rgbKey(c) { const to2 = (n) => Math.round(n * 100)/100; return [to2(c.r), to2(c.g), to2(c.b), to2('a' in c ? c.a : 1)].join(','); }
const colorIndex = new Map(REVERSE_INDEX.color || []);
const spacingIndex = new Map(REVERSE_INDEX.spacing || []);
const radiusIndex = new Map(REVERSE_INDEX.radius || []);

async function bindNode(n) {
  // Fills
  if (Array.isArray(n.fills)) {
    const newFills = [];
    let changed = false;
    for (const fill of n.fills) {
      if (fill.type === 'SOLID' && fill.color) {
        const hit = colorIndex.get(rgbKey(fill.color));
        if (hit && !fill.boundVariables?.color) {
          const v = await figma.variables.getVariableByIdAsync(hit.id);
          if (v) { newFills.push(figma.variables.setBoundVariableForPaint(fill, 'color', v)); changed = true; continue; }
        }
      }
      newFills.push(fill);
    }
    if (changed) n.fills = newFills;
  }
  // Padding / itemSpacing
  for (const field of ['paddingTop','paddingBottom','paddingLeft','paddingRight','itemSpacing']) {
    if (typeof n[field] === 'number' && n[field] !== 0) {
      const hit = spacingIndex.get(n[field]);
      if (hit && !n.boundVariables?.[field]) {
        const v = await figma.variables.getVariableByIdAsync(hit.id);
        if (v) n.setBoundVariable(field, v);
      }
    }
  }
  // Corner radii
  for (const field of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) {
    if (typeof n[field] === 'number' && n[field] !== 0) {
      const hit = radiusIndex.get(n[field]);
      if (hit && !n.boundVariables?.[field]) {
        const v = await figma.variables.getVariableByIdAsync(hit.id);
        if (v) n.setBoundVariable(field, v);
      }
    }
  }
  // Recurse
  if (Array.isArray(n.children)) for (const c of n.children) await bindNode(c);
}

let boundCount = 0;
for (const child of componentSet.children) {
  await bindNode(child);
}

// 9. Position and finalize
componentSet.x = 40; componentSet.y = 40;
page.name = MANIFEST.componentName;

return {
  componentSetId: componentSet.id,
  variantCount: componentSet.children.length,
  collapsedCount: collapsed.length,
  effectiveAxes: [...effectiveAxes],
  pageId: page.id,
};
`;
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

  if (cmd === 'consolidation-script') {
    if (!args.manifest || !args['captured-page-id'] || !args['reverse-index'] || !args.output) {
      console.error('Usage: consolidation-script --manifest <json> --captured-page-id <id> --reverse-index <json> --output <js>');
      process.exit(2);
    }
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const reverseIndex = JSON.parse(fs.readFileSync(args['reverse-index'], 'utf8'));
    const pageId = args['captured-page-id'];
    const script = buildConsolidationScript(manifest, reverseIndex, pageId);
    fs.writeFileSync(args.output, script);
    process.exit(0);
  }

  if (cmd === 'preflight') {
    if (!args['design-context'] || !args['variable-defs'] || !args['globals-css'] || !args.config || !args.output) {
      console.error('Usage: preflight --design-context <ctx.json> --variable-defs <vars.json> --globals-css <path> --config <path> --output <report.md>');
      process.exit(2);
    }
    // Reuse lint-engine's CLI by invoking it as a subprocess. This is the
    // symmetric-pipeline assertion — same code path as /adhd:lint.
    const lintCli = path.resolve(__dirname, '..', 'lint-engine', 'cli.js');
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('node', [
      lintCli,
      '--design-context', args['design-context'],
      '--variable-defs', args['variable-defs'],
      '--globals-css', args['globals-css'],
      '--config', args.config,
      '--target', 'PushComponent Preflight',
      '--target-url', 'about:blank',
      '--output', args.output,
    ], { encoding: 'utf8', stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
