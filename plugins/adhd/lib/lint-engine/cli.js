#!/usr/bin/env node
'use strict';

/**
 * ADHD lint-engine CLI.
 * Inputs (all required, passed as flags):
 *   --variable-defs <path>     JSON file with MCP get_variable_defs response
 *   --design-context <path>    JSON file with MCP get_design_context response
 *   --globals-css <path>       Path to globals.css to compare against
 *   --config <path>            Path to adhd.config.ts (for naming convention etc.)
 *   --target <label>           Human-readable target description (e.g. "Page 1 / Card")
 *   --target-url <url>         Figma deep-link to the target node
 *   --output <path>            Where to write the markdown report
 * Output:
 *   - Markdown report at --output
 *   - JSON violations on stdout (for skills to consume)
 *   - Exit 0 if no errors, 1 if any errors, 2 on usage error
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseTheme } = require('./theme-parser');

// Tailwind v4 ships a full default @theme: --color-white, --color-black,
// --color-red-500, --spacing, the --text-* / --leading-* scales, etc.
// `lib/design-system/tailwind-defaults.css` carries the canonical copy
// (already used by push/pull-design-system via parseCodeDesignSystem).
// We merge those defaults into the user's parsed primitives BEFORE the
// variable comparator runs — otherwise a Figma `Color/white` variable
// would surface as "missing in code" even though Tailwind covers it,
// and downstream surfaces (lint reports, pull-component Phase 2.7
// discovery prompts) would suggest writing `--color-white: #fff` to
// globals.css — pure clutter, no value.
const TAILWIND_DEFAULTS_PATH = path.resolve(__dirname, '..', 'design-system', 'tailwind-defaults.css');

function loadTailwindDefaultPrimitives() {
  let css;
  try { css = fs.readFileSync(TAILWIND_DEFAULTS_PATH, 'utf8'); }
  catch { return {}; }
  // The defaults file uses `@theme default {` and `@theme default inline {`
  // (Tailwind's syntax for the canonical reference theme). parseTheme only
  // matches plain `@theme {` / `@theme inline {`, so rewrite the headers
  // before parsing.
  const normalized = css
    .replace(/@theme\s+default\s+inline\s*\{/g, '@theme inline {')
    .replace(/@theme\s+default\s*\{/g, '@theme {');
  return parseTheme(normalized).primitives;
}
const { categorizeVariables } = require('./variable-categorizer');
const { checkStructure } = require('./structure-checker');
const { buildVariableSuggestions } = require('./variable-namer');
const { formatReport } = require('./report-formatter');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js --variable-defs <path> --design-context <path> --globals-css <path> \\
         --config <path> --target <label> --target-url <url> --output <path>

Reads pre-fetched MCP responses + globals.css and writes a markdown
violation report. Stdout is a JSON summary. Exit 0 = no errors, 1 = errors.`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function extractFileKey(url) {
  const m = /design\/([^/?]+)/.exec(url);
  return m ? m[1] : 'unknown';
}

function readNamingConvention(configPath) {
  // Minimal parse: look for `naming: <value>` in the file.
  // Accepts `false` or a quoted string (kebab-case / PascalCase / camelCase).
  const src = fs.readFileSync(configPath, 'utf8');
  const m = /naming\s*:\s*(false|"[^"]+"|'[^']+')/.exec(src);
  if (!m) return 'kebab-case';
  if (m[1] === 'false') return false;
  return m[1].slice(1, -1);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }

  const required = ['variable-defs', 'design-context', 'globals-css', 'config', 'target', 'target-url', 'output'];
  for (const r of required) {
    if (!args[r]) { console.error(`Missing --${r}`); process.exit(2); }
  }

  const varDefs = readJson(args['variable-defs']);
  const designCtx = readJson(args['design-context']);
  const cssText = fs.readFileSync(args['globals-css'], 'utf8');
  const namingConvention = readNamingConvention(args['config']);
  const fileKey = extractFileKey(args['target-url']);

  const userTheme = parseTheme(cssText);
  const tailwindDefaults = loadTailwindDefaultPrimitives();
  // User's @theme wins on key collision (override always beats default).
  const theme = {
    ...userTheme,
    primitives: { ...tailwindDefaults, ...userTheme.primitives },
  };
  const variableViolations = categorizeVariables(varDefs, theme);

  let structureViolations = [];
  let pageGrouping = null;

  if (designCtx && designCtx.mode === 'whole-file' && Array.isArray(designCtx.pages)) {
    // Whole-file mode: iterate pages, then top-level nodes per page
    pageGrouping = [];
    for (const page of designCtx.pages) {
      const pageEntry = { name: page.name, nodes: [] };
      for (const node of page.nodes) {
        const nodeViolations = checkStructure(node, { fileKey, namingConvention });
        // Tag each violation with the page name for grouping
        for (const v of nodeViolations) v._page = page.name;
        structureViolations.push(...nodeViolations);
        pageEntry.nodes.push({ name: node.name, type: node.type, violationCount: nodeViolations.length });
      }
      pageGrouping.push(pageEntry);
    }
  } else {
    structureViolations = checkStructure(designCtx, { fileKey, namingConvention });
  }

  // STRUCT011 — variable-name compliance. For each variable, produce ONE
  // concrete rename target that combines case + domain concerns into a
  // single actionable suggestion. This is the upgrade from the old
  // two-section emission, which forced designers to reconcile contradictory
  // hints ("rename Font-Size to font-size" + "did you mean text?") on
  // their own — too much cognitive load when 10+ variables are flagged.
  //
  // The new emission shows: "Type + Effects/Font-Size/Body → Text/body".
  // One line, complete target. The designer creates the new variable in
  // the right collection (or renames in place) and moves on.
  //
  // Variable names are ALWAYS checked against kebab-case for the leaves,
  // regardless of the project's `naming` config (which is for component
  // identifiers, not CSS custom properties).
  //
  // In whole-file mode there's no scope root, so nodeId is omitted —
  // violation still appears in the report but doesn't annotate.
  const varKeys = Object.keys(varDefs || {});
  const suggestions = buildVariableSuggestions(varKeys);
  if (suggestions.length > 0) {
    const isScoped = designCtx && designCtx.mode !== 'whole-file' && designCtx.id;
    const scopedNodeId = isScoped ? designCtx.id : undefined;
    const shown = suggestions.slice(0, 10);
    const lines = shown.map(s => {
      if (s.kind === 'rename') return `  • ${s.name}\n      → ${s.target}`;
      if (s.kind === 'no-mapping') return `  • ${s.name}\n      ⚠ ${s.reason}`;
      return `  • ${s.name}`;
    });
    const more = suggestions.length > 10 ? `\n\n  +${suggestions.length - 10} more` : '';
    structureViolations.push({
      rule: 'STRUCT011',
      severity: 'warning',
      nodeId: scopedNodeId,
      nodePath: 'Variables',
      message:
        `${suggestions.length} variable(s) need renaming for Tailwind v4 alignment:\n\n` +
        `${lines.join('\n\n')}${more}\n\n` +
        `For each rename: right-click the variable in Figma → "Rename".\n` +
        `Tip: you can also create the variable in the suggested collection and point old references at it via aliasing.`,
      deepLink: scopedNodeId
        ? 'https://figma.com/design/' + fileKey + '?node-id=' + scopedNodeId.replace(':', '-')
        : args['target-url'],
    });
  }

  const meta = {
    target: args.target,
    targetUrl: args['target-url'],
    runAt: new Date(),
    pageGrouping,
  };
  const report = formatReport(
    { variable: variableViolations, structure: structureViolations },
    meta,
  );
  fs.writeFileSync(args.output, report);

  const errors = structureViolations.filter(v => v.severity === 'error').length + variableViolations.length;
  const warnings = structureViolations.filter(v => v.severity === 'warning').length;
  process.stdout.write(JSON.stringify({
    errors,
    warnings,
    variable: variableViolations,
    structure: structureViolations,
    reportPath: args.output,
  }));

  process.exit(errors > 0 ? 1 : 0);
}

main();
