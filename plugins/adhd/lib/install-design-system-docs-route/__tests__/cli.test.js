'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints subcommand usage and exits 0', () => {
  const r = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /parse-tokens/);
  assert.match(r.stdout, /parse-props/);
  assert.match(r.stdout, /slug/);
  assert.match(r.stdout, /patch-next-config/);
  assert.match(r.stdout, /patch-robots/);
  assert.match(r.stdout, /detect-install/);
  assert.match(r.stdout, /install/);
});

test('cli with no args exits 2', () => {
  assert.equal(spawnSync('node', [CLI], { encoding: 'utf8' }).status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  assert.equal(spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' }).status, 2);
});

const fs = require('node:fs');
const os = require('node:os');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-ids-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, content);
  return p;
}

const FX_CSS = path.resolve(__dirname, '..', '__fixtures__', 'globals.css');
const FX_AVATAR = path.resolve(__dirname, '..', '__fixtures__', 'avatar.tsx');

test('parse-tokens subcommand outputs token JSON', () => {
  const out = tmp('tokens.json', '');
  const r = spawnSync('node', [CLI, 'parse-tokens', '--css', FX_CSS, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(t.colors.length > 0);
});

test('parse-props subcommand outputs props JSON', () => {
  const out = tmp('props.json', '');
  const r = spawnSync('node', [CLI, 'parse-props', '--source', FX_AVATAR, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(p.componentName, 'Avatar');
  assert.ok(p.props.size.values.length === 5);
});

test('slug subcommand outputs slug map JSON', () => {
  const out = tmp('slugs.json', '');
  const r = spawnSync('node', [CLI, 'slug', '--paths', 'app/components/avatar/index.tsx,app/components/avatar-group/index.tsx', '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(m['app/components/avatar/index.tsx'], 'avatar');
});

test('patch-next-config subcommand mutates the file in place', () => {
  const cfg = tmp('next.config.ts', `import type { NextConfig } from "next";\nconst nextConfig: NextConfig = {};\nexport default nextConfig;\n`);
  const r = spawnSync('node', [CLI, 'patch-next-config', '--config', cfg, '--route-url', '/-docs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.match(after, /pageExtensions:\s*process\.env\.NODE_ENV/);
});

test('patch-robots subcommand mutates the file in place; creates if missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-ids-robots-'));
  const robots = path.join(root, 'robots.txt');
  const r = spawnSync('node', [CLI, 'patch-robots', '--robots', robots, '--route-url', '/-docs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(robots, 'utf8');
  assert.match(after, /Disallow: \/-docs/);
});

test('detect-install subcommand prints existing install paths to stdout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-ids-detect-'));
  fs.mkdirSync(path.join(root, 'app', '(design-system)', '-docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'layout.tsx'),
    '// design-system-docs-route — auto-generated installer artifact; safe to edit.\nexport default function L({ children }) { return children; }\n',
  );
  const r = spawnSync('node', [CLI, 'detect-install', '--app-dir', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /-docs\/layout\.tsx/);
});

test('install subcommand writes files based on choices JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-ids-install-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  const choices = tmp('choices.json', JSON.stringify({
    projectRoot: root, groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true,
  }));
  const r = spawnSync('node', [CLI, 'install', '--config', choices], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(root, 'app', '(design-system)', '-docs', 'page.design-system.tsx')));
});
