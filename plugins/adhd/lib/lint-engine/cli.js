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
const { parseTheme } = require('./theme-parser');
const { categorizeVariables } = require('./variable-categorizer');
const { checkStructure } = require('./structure-checker');
const { checkVariableNames, checkVariableDomains, TAILWIND_DOMAINS } = require('./variable-namer');
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

  const theme = parseTheme(cssText);
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

  // STRUCT011 — variable-name compliance. Combines TWO concerns into one
  // aggregated violation so the designer sees a single "fix your variable
  // names" block per lint run:
  //   - Case: name doesn't follow the project's namingConvention
  //     (kebab/Pascal/camel).
  //   - Domain: first segment after the collection doesn't map to a Tailwind v4
  //     token-domain prefix (color/spacing/text/font/etc.). Suggests a synonym
  //     or typo correction via the "did you mean?" heuristic.
  // In whole-file mode there's no scope root, so we omit nodeId — the
  // violation still appears in the report but doesn't annotate.
  // Variable names are ALWAYS checked against kebab-case, regardless of the
  // project's `naming` config. That config is for component identifiers
  // (`Logo` vs `logo`); CSS custom properties — what Figma variables ultimately
  // become — are kebab-case-lowercase by Tailwind v4 spec. There's no honest
  // way to honor `naming: "PascalCase"` for variables and still produce
  // working utility classes.
  const VARIABLE_CASE = 'kebab-case';
  const varKeys = Object.keys(varDefs || {});
  const badCase = checkVariableNames(varKeys, VARIABLE_CASE);
  const badDomain = checkVariableDomains(varKeys);
  if (badCase.length > 0 || badDomain.length > 0) {
    const isScoped = designCtx && designCtx.mode !== 'whole-file' && designCtx.id;
    const scopedNodeId = isScoped ? designCtx.id : undefined;
    const sections = [];
    if (badCase.length > 0) {
      const shown = badCase.slice(0, 8);
      const lines = shown.map(v => `  • ${v.name}  →  ${v.suggestion}`);
      const more = badCase.length > 8 ? `\n  +${badCase.length - 8} more` : '';
      sections.push(`Case (kebab-case — Tailwind v4 requires lowercase CSS vars):\n${lines.join('\n')}${more}`);
    }
    if (badDomain.length > 0) {
      const shown = badDomain.slice(0, 8);
      const lines = shown.map(v => {
        const c = v.classification;
        if (c.kind === 'synonym') return `  • ${v.name}  —  did you mean "${c.suggestion}"? (Tailwind v4 prefix)`;
        if (c.kind === 'typo')    return `  • ${v.name}  —  did you mean "${c.suggestion}"? (looks like a typo)`;
        return `  • ${v.name}  —  unknown domain "${v.domainSegment}"; expected one of: ${TAILWIND_DOMAINS.join(', ')}`;
      });
      const more = badDomain.length > 8 ? `\n  +${badDomain.length - 8} more` : '';
      sections.push(`Tailwind v4 domain:\n${lines.join('\n')}${more}`);
    }
    const total = badCase.length + badDomain.length;
    structureViolations.push({
      rule: 'STRUCT011',
      severity: 'warning',
      nodeId: scopedNodeId,
      nodePath: 'Variables',
      message:
        `${total} variable-naming issue(s):\n` +
        `${sections.join('\n\n')}\n\n` +
        `Rename them in Figma (right-click the variable → "Rename") to match.`,
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
