'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeFingerprint, canonicalJson, relevantConfigFields } = require('../fingerprint');

test('canonicalJson: produces same string regardless of key order', () => {
  const a = { figma: { url: 'x' }, naming: 'kebab' };
  const b = { naming: 'kebab', figma: { url: 'x' } };
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test('canonicalJson: nested keys sort independently', () => {
  const a = { x: { c: 1, a: 2, b: 3 } };
  assert.equal(canonicalJson(a), '{"x":{"a":2,"b":3,"c":1}}');
});

test('canonicalJson: arrays preserve order (semantic)', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});

test('computeFingerprint: returns 8 hex chars', () => {
  const fp = computeFingerprint({ figma: 'x' });
  assert.match(fp, /^[0-9a-f]{8}$/);
});

test('computeFingerprint: identical inputs hash identically', () => {
  const a = computeFingerprint({ x: 1, y: 2 });
  const b = computeFingerprint({ y: 2, x: 1 });
  assert.equal(a, b);
});

test('computeFingerprint: any change to the input changes the hash', () => {
  // The asymmetric failure mode: false positives (re-pull when output
  // would be identical) are fine; false negatives (skip when output
  // would differ) would be a correctness bug. Confirm changes propagate.
  const base = computeFingerprint({ figma: { url: 'x' } });
  const changed = computeFingerprint({ figma: { url: 'y' } });
  assert.notEqual(base, changed);
  // Even a deeply-nested change flips the hash.
  const deepBase = computeFingerprint({ a: { b: { c: 1 } } });
  const deepChanged = computeFingerprint({ a: { b: { c: 2 } } });
  assert.notEqual(deepBase, deepChanged);
});

test('relevantConfigFields: extracts pull-affecting config bits', () => {
  const out = relevantConfigFields({
    figma: { url: 'https://figma.com/design/abc' },
    naming: 'PascalCase',
    cssEntry: 'src/app/globals.css',
    components: { 'x': {} },
  });
  // Only fields that affect generated code make it in.
  assert.deepEqual(out, { naming: 'PascalCase', cssEntry: 'src/app/globals.css' });
});

test('relevantConfigFields: handles missing optional fields', () => {
  const out = relevantConfigFields({ figma: { url: 'x' } });
  assert.equal(out.naming, 'kebab-case'); // default
  assert.equal(out.cssEntry, null);
});

test('fingerprint changes when config naming changes (the invalidation case)', () => {
  // The whole point of including config in the fingerprint: if a
  // designer changes `naming` from kebab to Pascal, the same Figma
  // input now produces different code. We must NOT skip on the next
  // pull just because Figma is unchanged.
  const figmaExtract = { name: 'Button', variants: [{ size: 'sm' }] };
  const kebab = computeFingerprint({ figma: figmaExtract, config: relevantConfigFields({ naming: 'kebab-case' }) });
  const pascal = computeFingerprint({ figma: figmaExtract, config: relevantConfigFields({ naming: 'PascalCase' }) });
  assert.notEqual(kebab, pascal);
});
