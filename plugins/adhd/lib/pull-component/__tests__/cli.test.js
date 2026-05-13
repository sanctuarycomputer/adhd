'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-pull-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, content);
  return p;
}

test('cli with --help prints subcommand usage and exits 0', () => {
  const r = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /config-write/);
  assert.match(r.stdout, /config-read/);
  assert.match(r.stdout, /config-reverse/);
});

test('cli with no args exits 2', () => {
  assert.equal(spawnSync('node', [CLI], { encoding: 'utf8' }).status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  assert.equal(spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' }).status, 2);
});

test('config-write subcommand adds a components entry to the config file', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-write', '--config', cfgPath, '--path', 'app/components/x.tsx', '--figma-url', 'https://figma.com/design/ABC/?node-id=1-1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.match(after, /"app\/components\/x\.tsx":/);
});

test('config-read subcommand prints the figma url to stdout', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n  components: {\n    "app/components/x.tsx": { figma: { url: "https://figma.com/design/ABC/?node-id=1-1" } },\n  },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-read', '--config', cfgPath, '--path', 'app/components/x.tsx'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /node-id=1-1/);
});

test('config-read exits 1 with empty stdout when path is not mapped', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-read', '--config', cfgPath, '--path', 'app/components/missing.tsx'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
});

test('config-reverse subcommand prints the path for a given URL', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n  components: {\n    "app/components/x.tsx": { figma: { url: "https://figma.com/design/ABC/?node-id=1-1" } },\n  },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-reverse', '--config', cfgPath, '--figma-url', 'https://figma.com/design/ABC/?node-id=1-1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /app\/components\/x\.tsx/);
});

test('config-reverse exits 1 with empty stdout when URL has no mapping', () => {
  const cfgPath = tmp('adhd.config.ts', `const config = {\n  figma: { url: "https://figma.com/design/ABC/" },\n};\n\nexport default config;\n`);
  const r = spawnSync('node', [CLI, 'config-reverse', '--config', cfgPath, '--figma-url', 'https://figma.com/design/ABC/?node-id=9-9'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
});
