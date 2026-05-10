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

test('consolidation-script subcommand emits a JS string with placeholders substituted', () => {
  const manifest = tmp('manifest.json', JSON.stringify({
    componentName: 'Avatar',
    variants: [{ size: 'xs' }, { size: 'sm' }],
    importPath: '@/app/components/avatar',
  }));
  const reverseIndex = tmp('ri.json', JSON.stringify({ color: [], spacing: [], radius: [] }));
  const out = tmp('script.js', '');
  const result = spawnSync('node', [
    CLI, 'consolidation-script',
    '--manifest', manifest,
    '--captured-page-id', '12:34',
    '--reverse-index', reverseIndex,
    '--output', out,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const script = fs.readFileSync(out, 'utf8');
  // Script must reference the page id and component name
  assert.match(script, /12:34/);
  assert.match(script, /Avatar/);
  // Script must contain the data-adhd-variant matcher
  assert.match(script, /data-adhd-variant/);
});

test('consolidation-script converts captured FRAMEs to COMPONENTs before combining', () => {
  // generate_figma_design returns FRAME children, but figma.combineAsVariants
  // requires COMPONENT nodes — assert positive evidence of the conversion path.
  const manifest = tmp('manifest.json', JSON.stringify({
    componentName: 'Avatar',
    variants: [{ size: 'xs' }, { size: 'sm' }],
    importPath: '@/app/components/avatar',
  }));
  const reverseIndex = tmp('ri.json', JSON.stringify({ color: [], spacing: [], radius: [] }));
  const out = tmp('script.js', '');
  const result = spawnSync('node', [
    CLI, 'consolidation-script',
    '--manifest', manifest,
    '--captured-page-id', '12:34',
    '--reverse-index', reverseIndex,
    '--output', out,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const script = fs.readFileSync(out, 'utf8');
  assert.match(script, /figma\.createComponentFromNode/);
});

test('consolidation-script includes the universal compliance bake', () => {
  // The script should: (1) bind fontSize to typography vars, (2) bind effects
  // to effect styles, (3) try distance-based color fallback, (4) promote
  // layoutMode=NONE FRAMEs/COMPONENTs to auto-layout, (5) rename auto-named
  // layers. Each is asserted via a stable code marker.
  const manifest = tmp('manifest.json', JSON.stringify({
    componentName: 'Avatar',
    variants: [{ size: 'xs' }, { size: 'sm' }],
    importPath: '@/app/components/avatar',
  }));
  const reverseIndex = tmp('ri.json', JSON.stringify({
    color: [], spacing: [], radius: [],
    typography: [], effects: [], color_rgba: [],
  }));
  const out = tmp('script.js', '');
  const result = spawnSync('node', [
    CLI, 'consolidation-script',
    '--manifest', manifest,
    '--captured-page-id', '12:34',
    '--reverse-index', reverseIndex,
    '--output', out,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const script = fs.readFileSync(out, 'utf8');
  // (1) fontSize binding
  assert.match(script, /setBoundVariable\(['"]fontSize['"]/);
  // (2) effect-style binding (uses effectStyleIdAsync per Plugin API)
  assert.match(script, /effectStyleId/);
  // (3) distance-based fallback color match
  assert.match(script, /Math\.sqrt/);
  // (4) auto-layout promotion
  assert.match(script, /layoutMode\s*=\s*['"]HORIZONTAL['"]/);
  // (5) auto-name rename
  assert.match(script, /AUTO_NAME_RE|Frame\\s\+\\d/);
});

test('preflight subcommand produces a lint report', () => {
  // Build minimal inputs that lint-engine accepts
  const ctx = tmp('ctx.json', JSON.stringify({
    id: '1:1', name: 'Avatar', type: 'COMPONENT_SET',
    componentPropertyDefinitions: { size: { type: 'VARIANT', defaultValue: 'sm', variantOptions: ['xs','sm'] } },
    children: [
      { id: '1:2', name: 'Avatar/size=xs', type: 'COMPONENT', variantProperties: { size: 'xs' }, layoutMode: 'VERTICAL', children: [] },
      { id: '1:3', name: 'Avatar/size=sm', type: 'COMPONENT', variantProperties: { size: 'sm' }, layoutMode: 'VERTICAL', children: [] },
    ],
  }));
  const vars = tmp('vars.json', JSON.stringify({}));
  const css = tmp('globals.css', '@theme {}');
  const cfg = tmp('adhd.config.ts', 'export default { naming: "kebab-case" };');
  const out = tmp('report.md', '');
  const result = spawnSync('node', [
    CLI, 'preflight',
    '--design-context', ctx,
    '--variable-defs', vars,
    '--globals-css', css,
    '--config', cfg,
    '--output', out,
  ], { encoding: 'utf8' });
  // exit 0 if no errors; the synthetic input here has none
  assert.equal(result.status, 0, result.stderr);
  const report = fs.readFileSync(out, 'utf8');
  assert.match(report, /ADHD/);
});
