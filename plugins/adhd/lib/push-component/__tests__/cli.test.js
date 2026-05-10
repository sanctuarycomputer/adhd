'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints subcommand usage and exits 0', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /parse/);
  assert.match(result.stdout, /generate-preview/);
  assert.match(result.stdout, /consolidation-script/);
  assert.match(result.stdout, /preflight/);
});

test('cli with no args exits 2 with usage', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  const result = spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-pc-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, content);
  return p;
}

const AVATAR_SOURCE = `
import Image from "next/image";

export type AvatarSize = "xs" | "sm" | "md";
export type AvatarShape = "circle" | "square";

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  className?: string;
}

export function Avatar({ name, size = "md" }: AvatarProps) {
  return <span>{name}</span>;
}
`;

test('parse subcommand writes a manifest JSON', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const out = tmp('manifest.json', '');
  const result = spawnSync('node', [CLI, 'parse', componentFile, '--output', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.componentName, 'Avatar');
  assert.ok(manifest.variants.length > 0);
  assert.deepEqual(manifest.unions.AvatarSize, ['xs', 'sm', 'md']);
});

test('parse subcommand --import-path overrides the auto-inferred import', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const out = tmp('manifest.json', '');
  spawnSync('node', [CLI, 'parse', componentFile, '--output', out, '--import-path', '@/foo/avatar'], { encoding: 'utf8' });
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.importPath, '@/foo/avatar');
});

test('parse subcommand respects --max-variants', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const out = tmp('manifest.json', '');
  // 3 sizes × 2 shapes × undefined-for-shape = 9 (3 sizes × 3 shape options)
  // size has 4 effective values (xs, sm, md, undefined), shape has 3 (circle, square, undefined)
  // = 12 total; cap to 4
  spawnSync('node', [CLI, 'parse', componentFile, '--output', out, '--max-variants', '4'], { encoding: 'utf8' });
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.variants.length, 4);
});

test('generate-preview subcommand emits a TSX file', () => {
  const componentFile = tmp('avatar.tsx', AVATAR_SOURCE);
  const manifest = tmp('manifest.json', '');
  spawnSync('node', [CLI, 'parse', componentFile, '--output', manifest], { encoding: 'utf8' });
  const previewOut = tmp('preview.tsx', '');
  const result = spawnSync('node', [CLI, 'generate-preview', '--manifest', manifest, '--output', previewOut], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const tsx = fs.readFileSync(previewOut, 'utf8');
  assert.match(tsx, /import \{ Avatar \}/);
  assert.match(tsx, /data-adhd-variant=/);
});
