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
// (already used by push/pull-tokens via parseCodeDesignSystem).
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
const { checkBindings } = require('./binding-checker');
const { detectTailwindDuplicates } = require('./tailwind-duplicate-detector');
const { detectDuplicateCollections } = require('./collection-duplicate-detector');
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

  // Optional: serializer-produced { '<VariableID>': '<collection>/<name>' }
  // map. Required for per-layer STRUCT011 annotations and STRUCT012
  // cross-domain detection; absent in older SKILL versions, in which case
  // we fall back to the legacy aggregated STRUCT011 emission.
  let varIdMap = {};
  if (args['var-id-map']) {
    try { varIdMap = readJson(args['var-id-map']); } catch { varIdMap = {}; }
  }

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

  // STRUCT011 (variable naming) + STRUCT012 (cross-domain bindings).
  //
  // Both rules need to know which LAYER uses each variable so the annotation
  // lands on the offender instead of the scope root — designers asked for
  // this so they can walk a list of annotations and fix them one by one
  // without hunting through the layer tree. The binding-checker walks the
  // node tree and emits one violation per (layer, variable) pair.
  //
  // STRUCT012 catches the cross-domain case STRUCT011 misses: a `Spacing/4`
  // variable (well-named for its domain) bound to letter-spacing. The
  // variable's name is fine, but the binding crosses Tailwind's token-domain
  // boundary. We infer each variable's intended domain from its name and
  // compare to the property's expected domain.
  //
  // Variable names are ALWAYS checked against kebab-case for the leaves,
  // regardless of the project's `naming` config (which is for component
  // identifiers, not CSS custom properties).
  //
  // Fallback: when the SKILL didn't emit a varIdMap (older versions), we
  // can't bridge per-node bindings to variable names, so STRUCT011 falls
  // back to the legacy aggregated emission and STRUCT012 stays silent.
  const varKeys = Object.keys(varDefs || {});
  const suggestions = buildVariableSuggestions(varKeys);
  const badSuggestionsByName = {};
  for (const s of suggestions) badSuggestionsByName[s.name] = s;
  const hasIdMap = Object.keys(varIdMap).length > 0;

  if (hasIdMap) {
    const bindingViolations = [];
    if (designCtx && designCtx.mode === 'whole-file' && Array.isArray(designCtx.pages)) {
      for (const page of designCtx.pages) {
        for (const node of page.nodes) {
          const v = checkBindings(node, { fileKey, varIdMap, badSuggestionsByName });
          for (const x of v) x._page = page.name;
          bindingViolations.push(...v);
        }
      }
    } else if (designCtx) {
      bindingViolations.push(...checkBindings(designCtx, { fileKey, varIdMap, badSuggestionsByName }));
    }
    structureViolations.push(...bindingViolations);
  } else if (suggestions.length > 0) {
    // Legacy aggregated STRUCT011 emission, kept as a graceful fallback
    // when the SKILL hasn't been upgraded to emit varIdMap. Pre-existing
    // behavior — single violation on the scope root listing every bad name.
    const isScoped = designCtx && designCtx.mode !== 'whole-file' && designCtx.id;
    const scopedNodeId = isScoped ? designCtx.id : undefined;
    const renames = suggestions.filter(s => s.kind === 'rename');
    const ambiguous = suggestions.filter(s => s.kind === 'ambiguous');
    const noMapping = suggestions.filter(s => s.kind === 'no-mapping');
    const byTarget = new Map();
    for (const s of renames) {
      const collection = s.target.split('/')[0];
      if (!byTarget.has(collection)) byTarget.set(collection, []);
      byTarget.get(collection).push(s);
    }
    const sortedTargets = [...byTarget.keys()].sort();
    const sections = [];
    for (const collection of sortedTargets) {
      const items = byTarget.get(collection);
      const lines = items.map(s => `  • ${s.name}\n      → ${s.target}`);
      sections.push(`→ Move to "${collection}" collection (${items.length} var${items.length === 1 ? '' : 's'}):\n${lines.join('\n')}`);
    }
    if (ambiguous.length > 0) {
      const lines = ambiguous.map(s =>
        `  • ${s.name}\n` +
        `      ⚠ Ambiguous — ${s.primaryReason}, but ${s.alternateReason}. Pick based on actual usage:\n` +
        `        Primary:    → ${s.target}\n` +
        `        Alternate:  → ${s.alternate}`,
      );
      sections.push(`⚠ Ambiguous (${ambiguous.length}) — path and leaf disagree on the target domain:\n${lines.join('\n\n')}`);
    }
    if (noMapping.length > 0) {
      const lines = noMapping.map(s => `  • ${s.name}\n      ⚠ ${s.reason}`);
      sections.push(`⚠ No Tailwind v4 mapping (${noMapping.length}):\n${lines.join('\n\n')}`);
    }
    structureViolations.push({
      rule: 'STRUCT011',
      severity: 'warning',
      nodeId: scopedNodeId,
      nodePath: 'Variables',
      message:
        `${suggestions.length} variable-naming issue(s). Suggested restructure:\n\n` +
        `${sections.join('\n\n')}\n\n` +
        `How to apply each move in Figma:\n` +
        `  1. Open the Variables panel; create any missing target collections.\n` +
        `  2. Right-click the source variable → "Move to..." → pick the target collection. Figma auto-rewires existing references.\n` +
        `  3. Inside the target, rename to drop redundant path segments (the variable's path within the new collection becomes its full name).\n` +
        `\n` +
        `Use Figma's "Move to..." (not "Rename") — Rename only works within the same collection, but most of these are moves across collections.`,
      deepLink: scopedNodeId
        ? 'https://figma.com/design/' + fileKey + '?node-id=' + scopedNodeId.replace(':', '-')
        : args['target-url'],
    });
  }

  // STRUCT013 — Figma variable duplicates a Tailwind v4 default.
  //
  // Surfaces when a designer has both the canonical Tailwind variable
  // (e.g. `Color/zinc-500`) AND a same-value duplicate sitting alongside.
  // Strict match — name AND value must align — so semantic vars like
  // `Color/MyZinc` (same value, different intent) are NOT flagged.
  //
  // The fix is "consolidate": rebind every layer using the duplicate to
  // the canonical Tailwind variable, then delete the duplicate. The
  // /adhd:lint --fix flow walks each candidate through AskUserQuestion
  // before applying — never auto-rewires.
  const duplicates = detectTailwindDuplicates(varDefs, tailwindDefaults);
  for (const dup of duplicates) {
    // varIdMap is { id: name }; invert to find the duplicate's Figma ID
    // (used by --fix to rebind layers). Absent when the SKILL hasn't
    // emitted varIdMap — STRUCT013 still surfaces, just without an ID
    // hint for the migration script.
    let figmaVarId = null;
    for (const [id, name] of Object.entries(varIdMap || {})) {
      if (name === dup.figmaName) { figmaVarId = id; break; }
    }
    structureViolations.push({
      rule: 'STRUCT013',
      severity: 'warning',
      nodeId: undefined, // file-level concern; doesn't annotate a layer
      nodePath: 'Variables',
      message:
        `Figma variable "${dup.figmaName}" (= ${dup.value}) duplicates Tailwind default \`${dup.tailwindCssVar}\`. ` +
        `Same value, same canonical name — consolidating removes the duplicate without changing what gets rendered.\n\n` +
        `To apply: run \`/adhd:lint --fix\`. The flow walks each candidate via prompt, then for each "Yes" it rebinds every layer that uses "${dup.figmaName}" to \`${dup.tailwindCssVar}\` and deletes the duplicate.`,
      deepLink: args['target-url'],
      // Extra fields consumed by --fix (ignored by the report formatter):
      figmaVarName: dup.figmaName,
      figmaVarId,
      tailwindCssVar: dup.tailwindCssVar,
    });
  }

  // STRUCT014 — duplicate collections (e.g. "Color" + "color" side-by-
  // side, "Type + Effects" + "typography"). Surface every group so
  // designers can see what's grown up over time. /adhd:lint --fix
  // consolidates per group: pick the keeper, move every variable from
  // the loser collections into it (rebinding existing layer references),
  // then delete the empty losers.
  const dupGroups = detectDuplicateCollections(Object.keys(varDefs || {}));
  for (const group of dupGroups) {
    const collNames = group.collections.map(c => `"${c.name}" (${c.varCount})`).join(', ');
    structureViolations.push({
      rule: 'STRUCT014',
      severity: 'warning',
      nodeId: undefined,
      nodePath: 'Variables',
      message:
        `${group.collections.length} Figma collections alias to "${group.canonical}": ${collNames}. ` +
        `These describe the same token domain but Figma treats them as separate collections, so designers see duplicate-looking groups in the Variables panel and push must guess which to append into.\n\n` +
        `To apply: run \`/adhd:lint --fix\`. You'll be asked which collection to keep (the most-populated one is suggested); every variable in the others gets moved into the keeper, layer bindings update automatically, and the empty collections are deleted.`,
      deepLink: args['target-url'],
      // Extra fields consumed by --fix:
      canonical: group.canonical,
      collections: group.collections,
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
