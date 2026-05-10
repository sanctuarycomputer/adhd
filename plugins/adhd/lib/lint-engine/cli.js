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
  const structureViolations = checkStructure(designCtx, { fileKey, namingConvention });

  const meta = {
    target: args.target,
    targetUrl: args['target-url'],
    runAt: new Date(),
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
