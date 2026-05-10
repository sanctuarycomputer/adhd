'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { figmaToCssVar, cssVarToFigma } = require('../name-normalizer');

test('drops collection prefix, slashes become hyphens, lowercases', () => {
  assert.equal(figmaToCssVar('Primitives/color/brand/600'), '--color-brand-600');
  assert.equal(figmaToCssVar('Semantic/color/surface/elevated'), '--color-surface-elevated');
  assert.equal(figmaToCssVar('Primitives/space/2xl'), '--space-2xl');
});

test('handles single-segment names with collection prefix', () => {
  assert.equal(figmaToCssVar('Primitives/radius/pill'), '--radius-pill');
});

test('handles missing collection prefix (defensive — accepts both forms)', () => {
  assert.equal(figmaToCssVar('color/brand/600'), '--color-brand-600');
});

test('cssVarToFigma is best-effort reverse: assumes a known collection set', () => {
  assert.equal(
    cssVarToFigma('--color-brand-600', { primitives: ['color'], semantic: [] }),
    'Primitives/color/brand/600',
  );
  assert.equal(
    cssVarToFigma('--color-surface-elevated', { primitives: ['color'], semantic: ['color/surface'] }),
    'Semantic/color/surface/elevated',
  );
});

test('throws on inputs that are clearly not Figma paths', () => {
  assert.throws(() => figmaToCssVar(''), /empty/);
  assert.throws(() => figmaToCssVar(null), /string/);
});
