'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTokens } = require('../token-parser');

const CSS = fs.readFileSync(
  path.resolve(__dirname, '..', '__fixtures__', 'globals.css'),
  'utf8',
);

test('extracts color tokens', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.colors.find(c => c.name === 'zinc-50'),
    { name: 'zinc-50', value: 'oklch(0.985 0 0)' },
  );
  assert.deepEqual(
    t.colors.find(c => c.name === 'brand-500'),
    { name: 'brand-500', value: '#5e3aee' },
  );
});

test('extracts the spacing multiplier', () => {
  const t = parseTokens(CSS);
  assert.equal(t.spacing.multiplier, '0.25rem');
});

test('extracts typography sizes with optional line-heights', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.typography.find(x => x.name === 'xs'),
    { name: 'xs', size: '0.75rem', lineHeight: '1rem' },
  );
  assert.deepEqual(
    t.typography.find(x => x.name === 'base'),
    { name: 'base', size: '1rem', lineHeight: '1.5rem' },
  );
});

test('extracts radius tokens', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.radius.find(r => r.name === 'sm'),
    { name: 'sm', value: '0.25rem' },
  );
});

test('extracts shadow tokens', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.shadows.find(s => s.name === 'sm'),
    { name: 'sm', value: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
  );
});

test('extracts font family tokens', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.fonts.find(f => f.name === 'sans'),
    { name: 'sans', value: '"Inter", system-ui, sans-serif' },
  );
  assert.deepEqual(
    t.fonts.find(f => f.name === 'mono'),
    { name: 'mono', value: '"JetBrains Mono", monospace' },
  );
});

test('extracts font-weight tokens (longest prefix wins over `font-`)', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.fontWeights.find(w => w.name === 'normal'),
    { name: 'normal', value: '400' },
  );
  // `--font-weight-bold` MUST classify as fontWeights, not fonts — the
  // prefix-map's order guarantees the longer prefix (`font-weight-`) wins.
  assert.ok(!t.fonts.find(f => f.name === 'weight-bold'));
});

test('merges inset-shadow-* and drop-shadow-* into the shadows bucket', () => {
  const t = parseTokens(CSS);
  // Both `--inset-shadow-sm` and `--drop-shadow-sm` land in `shadows` alongside `--shadow-sm`.
  const names = t.shadows.map(s => s.name);
  assert.ok(names.includes('sm'));
  assert.ok(names.includes('sm') && t.shadows.filter(s => s.name === 'sm').length >= 1);
  // Distinguish by the leaf — `inset-shadow-sm` becomes leaf `sm`, but we keep
  // the original prefix off so installers can render them grouped.
  // For now, accept multiple entries with the same leaf name.
  assert.ok(t.shadows.length >= 3);
});

test('extracts tracking, leading, breakpoints, easings, animations', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(t.tracking.find(x => x.name === 'tight'), { name: 'tight', value: '-0.025em' });
  assert.deepEqual(t.leading.find(x => x.name === 'tight'), { name: 'tight', value: '1.25' });
  assert.deepEqual(t.breakpoints.find(x => x.name === 'sm'), { name: 'sm', value: '40rem' });
  assert.deepEqual(t.easings.find(x => x.name === 'in-out'), { name: 'in-out', value: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  assert.deepEqual(t.animations.find(x => x.name === 'spin'), { name: 'spin', value: 'spin 1s linear infinite' });
});

test('puts unrecognized @theme vars in `unknown`', () => {
  const t = parseTokens(CSS);
  assert.ok(t.unknown.find(u => u.name === '--some-mystery-var'));
});

test('handles `@theme inline { ... }` modifier syntax', () => {
  const t = parseTokens(CSS);
  // The aliased color from the `@theme inline { ... }` block must be picked up.
  assert.ok(t.colors.find(c => c.name === 'alias-bg' && c.value === 'var(--color-zinc-50)'));
});

test('returns empty domains when no @theme block exists', () => {
  const t = parseTokens('body { color: red; }');
  assert.deepEqual(t.colors, []);
  assert.deepEqual(t.typography, []);
  assert.deepEqual(t.radius, []);
  assert.deepEqual(t.shadows, []);
  assert.deepEqual(t.fonts, []);
  assert.deepEqual(t.fontWeights, []);
  assert.deepEqual(t.tracking, []);
  assert.deepEqual(t.leading, []);
  assert.deepEqual(t.breakpoints, []);
  assert.deepEqual(t.easings, []);
  assert.deepEqual(t.animations, []);
  assert.equal(t.spacing.multiplier, null);
});

test('handles multiple @theme blocks (merge)', () => {
  const css = `
@theme { --color-a-100: #fff; }
@theme { --color-b-200: #000; }
`;
  const t = parseTokens(css);
  assert.equal(t.colors.length, 2);
});
