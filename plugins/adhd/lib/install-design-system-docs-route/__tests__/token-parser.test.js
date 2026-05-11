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

test('puts unrecognized @theme vars in `unknown`', () => {
  const t = parseTokens(CSS);
  assert.ok(t.unknown.find(u => u.name === '--font-sans'));
});

test('returns empty domains when no @theme block exists', () => {
  const t = parseTokens('body { color: red; }');
  assert.deepEqual(t.colors, []);
  assert.deepEqual(t.typography, []);
  assert.deepEqual(t.radius, []);
  assert.deepEqual(t.shadows, []);
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
