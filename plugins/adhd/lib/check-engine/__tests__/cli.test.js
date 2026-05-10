'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

test('cli with --help prints usage', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('cli runs end-to-end on synthetic inputs and writes a report', () => {
  const varDefs = tmp('vars.json', { 'Primitives/color/brand/600': '#5e3aee' });
  const ctx = tmp('ctx.json', {
    id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL',
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'X' } } }],
  });
  const cssPath = tmp('globals.css', `
    @theme { --color-brand-600: #5e3aee; }
    :root { }
    :root[data-theme="dark"] { }
  `);
  const configPath = tmp('adhd.config.ts', `
    export default { figma: { url: 'https://figma.com/design/abc/Test' }, naming: 'kebab-case' };
  `);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, 'exit 0 (no errors): stderr=' + result.stderr);
  const report = fs.readFileSync(reportPath, 'utf8');
  assert.match(report, /No violations found/);

  // stdout should be JSON summary
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.errors, 0);
  assert.equal(summary.warnings, 0);
});

test('cli exits 1 when variable conflicts exist', () => {
  const varDefs = tmp('vars.json', { 'Primitives/color/brand/600': '#5e3aee' });
  const ctx = tmp('ctx.json', { id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme { --color-brand-600: #000000; } :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1);
});

// --- Extra coverage beyond the plan ---

test('cli exits 2 with helpful error when a required flag is missing', () => {
  // Omit --variable-defs deliberately.
  const ctx = tmp('ctx.json', { id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    // --variable-defs intentionally omitted
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /variable-defs/);
});

test('cli with structure errors but no variable issues exits 1', () => {
  // Empty variable defs (no var issues), and a frame with children but no auto-layout (STRUCT001).
  const varDefs = tmp('vars.json', {});
  const ctx = tmp('ctx.json', {
    id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'NONE',
    children: [
      { id: '1:2', name: 'inner', type: 'FRAME', layoutMode: 'NONE' },
    ],
  });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, 'exit 1: stderr=' + result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.variable.length, 0);
  assert.ok(summary.errors >= 1);
});
