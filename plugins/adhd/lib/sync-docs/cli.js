#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseTokens } = require('./token-parser');
const { parseProps } = require('./prop-parser');
const { slugMap } = require('./slug');
const { patchNextConfig } = require('./next-config-patcher');
const { patchRobots } = require('./robots-patcher');
const { installRoute, detectExistingInstall } = require('./route-installer');
const { readConfig } = require('./config-parser');

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
  cli.js parse-tokens --css <path> --output <json>
  cli.js parse-props --source <component.tsx> --output <json>
  cli.js slug --paths <comma-separated> --output <json>
  cli.js patch-next-config --config <path> --route-url <url>
  cli.js patch-robots --robots <path> --route-url <url>
  cli.js detect-install --app-dir <path>
  cli.js install --config <choices.json>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];

  if (cmd === 'parse-tokens') {
    if (!args.css || !args.output) { console.error('Usage: parse-tokens --css <path> --output <json>'); process.exit(2); }
    const css = fs.readFileSync(args.css, 'utf8');
    fs.writeFileSync(args.output, JSON.stringify(parseTokens(css), null, 2));
    process.exit(0);
  }

  if (cmd === 'parse-props') {
    if (!args.source || !args.output) { console.error('Usage: parse-props --source <tsx> --output <json>'); process.exit(2); }
    const src = fs.readFileSync(args.source, 'utf8');
    fs.writeFileSync(args.output, JSON.stringify(parseProps(src), null, 2));
    process.exit(0);
  }

  if (cmd === 'slug') {
    if (!args.paths || !args.output) { console.error('Usage: slug --paths <csv> --output <json>'); process.exit(2); }
    const paths = args.paths.split(',').map(s => s.trim()).filter(Boolean);
    fs.writeFileSync(args.output, JSON.stringify(slugMap(paths), null, 2));
    process.exit(0);
  }

  if (cmd === 'patch-next-config') {
    if (!args.config || !args['route-url']) { console.error('Usage: patch-next-config --config <path> --route-url <url> [--render-mode <dev-only|vercel-preview>]'); process.exit(2); }
    const renderMode = args['render-mode'] || 'dev-only';
    const src = fs.readFileSync(args.config, 'utf8');
    const r = patchNextConfig(src, { detectOnly: true });
    if (r && r.conflict) {
      console.error('next.config already sets pageExtensions: ' + r.existing);
      process.exit(3);
    }
    const out = patchNextConfig(src, { renderMode });
    fs.writeFileSync(args.config, out);
    process.exit(0);
  }

  if (cmd === 'patch-robots') {
    if (!args.robots || !args['route-url']) { console.error('Usage: patch-robots --robots <path> --route-url <url>'); process.exit(2); }
    let src = '';
    try { src = fs.readFileSync(args.robots, 'utf8'); } catch {}
    fs.writeFileSync(args.robots, patchRobots(src, args['route-url']));
    process.exit(0);
  }

  if (cmd === 'detect-install') {
    if (!args['app-dir']) { console.error('Usage: detect-install --app-dir <path>'); process.exit(2); }
    const found = detectExistingInstall(args['app-dir']);
    for (const f of found) process.stdout.write(f + '\n');
    process.exit(0);
  }

  if (cmd === 'install') {
    if (!args.config) { console.error('Usage: install --config <choices.json>'); process.exit(2); }
    const choices = JSON.parse(fs.readFileSync(args.config, 'utf8'));
    if (!choices.projectRoot) { console.error('install: choices.projectRoot is required'); process.exit(2); }
    // The installer needs the components list + cssEntry from the consumer's
    // adhd.config.ts. The skill enforces "config exists" in Phase 1, so a
    // missing file here is a hard error — we abort with a useful message
    // instead of generating an empty componentMap.
    let parsed;
    try { parsed = readConfig(choices.projectRoot); }
    catch (e) {
      console.error('install: failed to read adhd.config.ts at ' + choices.projectRoot + ': ' + e.message);
      process.exit(2);
    }
    const r = installRoute(choices.projectRoot, {
      ...choices,
      components: parsed.components,
      cssEntry: parsed.cssEntry,
    });
    process.stdout.write(JSON.stringify({ files: r.files, removed: r.removed, components: parsed.components.map(c => c.slug) }, null, 2) + '\n');
    process.exit(0);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
