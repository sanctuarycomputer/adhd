#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readComponentMapping, addComponentMapping, reverseLookupPath } = require('./config-writer');
const { computeFingerprint, relevantConfigFields } = require('./fingerprint');
const { readComponentState, writeComponentState } = require('./config-state');
const { resolveWriteTarget } = require('./resolve-write-target');
const { resolveInstance } = require('./instance-resolver');
const { parseTheme } = require('../lint-engine/theme-parser');
const { figmaToCssVar } = require('../lint-engine/name-normalizer');

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
  cli.js config-read  --config <adhd.config.ts> --path <relative-path>
  cli.js config-reverse --config <adhd.config.ts> --figma-url <url>
  cli.js fingerprint-check --config <adhd.config.ts> --path <relative-path> --ctx <ctx.json> --vars <vars.json>
  cli.js fingerprint-write --config <adhd.config.ts> --path <relative-path> --ctx <ctx.json> --vars <vars.json>
  cli.js resolve-actions   --globals <globals.css> --figma-path <figma-path> --value <hex-or-px> [--both-modes]
  cli.js resolve-instance  --config <adhd.config.ts> --component-id <A:B> [--repo-root <path>]

fingerprint-check:
  Computes the fingerprint of the fresh Figma extract + relevant config bits
  and compares to the stored fingerprint in adhd.config.ts. Writes JSON to
  stdout: { current, stored, match }. Exit 0 always — the SKILL branches on
  the parsed output.

fingerprint-write:
  Computes the fingerprint and writes it (plus an ISO pulledAt timestamp)
  into adhd.config.ts at components.<path>. Used after a successful pull.`);
}

// Parse adhd.config.ts text for the fields that affect pull output.
// Permissive regex — same approach as parsePushTokensFromConfig in
// lib/design-system/dispositions.js. The schema is small and stable
// enough that a TS evaluator isn't worth the dependency.
function parsePullRelevantConfig(src) {
  const naming = (/naming\s*:\s*["']([^"']+)["']/.exec(src) || [])[1] || 'kebab-case';
  const cssEntry = (/cssEntry\s*:\s*["']([^"']+)["']/.exec(src) || [])[1] || null;
  return { naming, cssEntry };
}

function readJsonOrEmpty(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
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

  if (cmd === 'fingerprint-check') {
    if (!args.config || !args.path || !args.ctx || !args.vars) {
      console.error('Usage: fingerprint-check --config <path> --path <rel> --ctx <ctx.json> --vars <vars.json>');
      process.exit(2);
    }
    const configSrc = fs.readFileSync(args.config, 'utf8');
    const ctx = readJsonOrEmpty(args.ctx);
    const vars = readJsonOrEmpty(args.vars);
    const current = computeFingerprint({
      figma: { ctx, vars },
      config: relevantConfigFields(parsePullRelevantConfig(configSrc)),
    });
    const stored = readComponentState(configSrc, args.path);
    process.stdout.write(JSON.stringify({
      current,
      stored,
      match: !!(stored && stored.fingerprint === current),
    }));
    process.exit(0);
  }

  if (cmd === 'resolve-actions') {
    if (!args.globals || !args['figma-path'] || !args.value) {
      console.error('Usage: resolve-actions --globals <globals.css> --figma-path <path> --value <value> [--both-modes]');
      process.exit(2);
    }
    const css = fs.readFileSync(args.globals, 'utf8');
    const theme = parseTheme(css);
    const cssVar = figmaToCssVar(args['figma-path']);
    const opts = 'both-modes' in args ? { bothModes: true } : {};
    const actions = resolveWriteTarget(cssVar, args.value, theme, opts);
    process.stdout.write(JSON.stringify({ cssVar, actions }, null, 2));
    process.exit(0);
  }

  if (cmd === 'resolve-instance') {
    if (!args.config || !args['component-id']) {
      console.error('Usage: resolve-instance --config <adhd.config.ts> --component-id <A:B> [--repo-root <path>]');
      process.exit(2);
    }
    const configSrc = fs.readFileSync(args.config, 'utf8');
    const out = resolveInstance({
      configSrc,
      componentId: args['component-id'],
      repoRoot: args['repo-root'] || path.dirname(path.resolve(args.config)),
    });
    process.stdout.write(JSON.stringify(out, null, 2));
    process.exit(out.matched ? 0 : 1);
  }

  if (cmd === 'fingerprint-write') {
    if (!args.config || !args.path || !args.ctx || !args.vars) {
      console.error('Usage: fingerprint-write --config <path> --path <rel> --ctx <ctx.json> --vars <vars.json>');
      process.exit(2);
    }
    const configSrc = fs.readFileSync(args.config, 'utf8');
    const ctx = readJsonOrEmpty(args.ctx);
    const vars = readJsonOrEmpty(args.vars);
    const fingerprint = computeFingerprint({
      figma: { ctx, vars },
      config: relevantConfigFields(parsePullRelevantConfig(configSrc)),
    });
    const pulledAt = new Date().toISOString();
    const next = writeComponentState(configSrc, args.path, { pulledAt, fingerprint });
    fs.writeFileSync(args.config, next);
    process.stdout.write(JSON.stringify({ fingerprint, pulledAt }));
    process.exit(0);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
