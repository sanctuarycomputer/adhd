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

// 1. Load the captured node; walk up to its PAGE ancestor.
// generate_figma_design returns a FRAME (not a PAGE), so we must climb to the page.
const capturedRoot = await figma.getNodeByIdAsync(PAGE_ID);
if (!capturedRoot) throw new Error('Captured node not found: ' + PAGE_ID);
let pageNode = capturedRoot;
while (pageNode && pageNode.type !== 'PAGE') pageNode = pageNode.parent;
if (!pageNode) throw new Error('Could not locate PAGE ancestor for captured node ' + PAGE_ID);
await figma.setCurrentPageAsync(pageNode);

// 2. Find the descendant whose children count matches the expected variant count.
// This is the "variant parent" — the grid container that holds one frame per variant.
function findVariantLevel(n) {
  if ('children' in n && Array.isArray(n.children) && n.children.length === MANIFEST.variants.length) return n;
  if ('children' in n && Array.isArray(n.children)) {
    for (const c of n.children) { const f = findVariantLevel(c); if (f) return f; }
  }
  return null;
}
const variantParent = findVariantLevel(capturedRoot);
if (!variantParent) throw new Error('Could not find a descendant with ' + MANIFEST.variants.length + ' children (expected variant grid)');

// 3. Try data-adhd-variant name match first; fall back to positional reading order.
// generate_figma_design does NOT preserve data-* attributes as layer names in practice,
// so the positional fallback is the usual path.
function variantKeyFromName(name) {
  if (!name) return null;
  const m = /data-adhd-variant="?([^"\\s]+)"?/.exec(name);
  return m ? m[1] : null;
}
function keyToProps(key) {
  const out = {};
  for (const pair of key.split(';')) { const [k, v] = pair.split('='); out[k] = v; }
  return out;
}
const namedMatches = [];
(function walkNames(n) {
  if (n.name && n.name.includes('data-adhd-variant=')) namedMatches.push(n);
  if ('children' in n && Array.isArray(n.children)) for (const c of n.children) walkNames(c);
})(capturedRoot);

let variantNodes;
if (namedMatches.length === MANIFEST.variants.length) {
  // Sort by extracted variant key alphabetically (matches manifest sort below).
  variantNodes = namedMatches.sort((a, b) => (variantKeyFromName(a.name) || '').localeCompare(variantKeyFromName(b.name) || ''));
} else {
  // Positional fallback: read variantParent.children top-to-bottom, left-to-right (5px row tolerance).
  variantNodes = [...variantParent.children].sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > 5) return dy;
    return a.x - b.x;
  });
}

// 4. Sort manifest variants by variant-key (alphabetical) so they align with the sorted node order.
function variantKeyFor(v) { return Object.keys(v).sort().map(k => k + '=' + v[k]).join(';'); }
const sortedVariants = [...MANIFEST.variants].sort((a, b) => variantKeyFor(a).localeCompare(variantKeyFor(b)));

// 5. Visual-signature dedup BEFORE conversion: collapse frames with identical structural signatures.
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
  return JSON.stringify(pick(node));
}
const bySig = new Map();
const survivorNodes = [];
const survivorProps = [];
const collapsed = [];
for (let i = 0; i < variantNodes.length; i++) {
  const node = variantNodes[i];
  const props = sortedVariants[i];
  const sig = structuralHash(node);
  if (bySig.has(sig)) {
    collapsed.push(props);
    try { node.remove(); } catch (e) {}
  } else {
    bySig.set(sig, true);
    survivorNodes.push(node);
    survivorProps.push(props);
  }
}

// 6. Move survivors to the page (top-level siblings) and convert FRAME → COMPONENT.
// combineAsVariants requires COMPONENT nodes that are siblings of the target parent.
// Keep ALL property keys in the component name, even where the value is the literal string
// "undefined" — Component Set requires uniform property names across all variants.
const components = [];
for (let i = 0; i < survivorNodes.length; i++) {
  const child = await figma.getNodeByIdAsync(survivorNodes[i].id);
  pageNode.appendChild(child);
  const c = figma.createComponentFromNode(child);
  const props = survivorProps[i];
  const parts = Object.keys(props).sort().map(k => k + '=' + String(props[k]));
  // Figma derives variant properties from this name via "propA=valueA, propB=valueB".
  c.name = parts.join(', ');
  components.push(c);
}

// 7. Combine into Component Set.
const componentSet = figma.combineAsVariants(components, pageNode);
componentSet.name = MANIFEST.componentName;
componentSet.x = 40;
componentSet.y = 40;
pageNode.name = MANIFEST.componentName;

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

for (const child of componentSet.children) {
  await bindNode(child);
}

// 9. Prune the now-empty captured root (its variant children have been moved out).
function pruneEmpty(n) {
  if (n === componentSet) return;
  if ('children' in n && Array.isArray(n.children)) {
    for (const c of [...n.children]) pruneEmpty(c);
    if (n.children.length === 0) {
      try { n.remove(); } catch (e) {}
    }
  }
}
pruneEmpty(capturedRoot);

return {
  componentSetId: componentSet.id,
  variantCount: componentSet.children.length,
  collapsedCount: collapsed.length,
  pageId: pageNode.id,
  pageName: pageNode.name,
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
