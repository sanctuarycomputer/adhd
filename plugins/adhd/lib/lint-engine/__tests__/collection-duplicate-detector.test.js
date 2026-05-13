'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDuplicateCollections } = require('../collection-duplicate-detector');

test('detects case-variant collections (Color vs color)', () => {
  const groups = detectDuplicateCollections([
    'Color/zinc-500', 'Color/red-500',
    'color/zinc-500', 'color/red-500', 'color/blue-500',
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].canonical, 'color');
  // Most-populated first.
  assert.equal(groups[0].collections[0].name, 'color');
  assert.equal(groups[0].collections[0].varCount, 3);
  assert.equal(groups[0].collections[1].name, 'Color');
  assert.equal(groups[0].collections[1].varCount, 2);
});

test('detects synonym collections (Space vs spacing, Borders vs border-width, Type + Effects vs typography)', () => {
  const groups = detectDuplicateCollections([
    'Space/4', 'Space/8',
    'spacing/4', 'spacing/8', 'spacing/16',
    'Borders/sm', 'Borders/md',
    'border-width/sm',
    'Type + Effects/text-lg',
    'typography/text-lg', 'typography/leading-relaxed',
  ]);
  const byCanonical = Object.fromEntries(groups.map(g => [g.canonical, g]));
  assert.deepEqual(Object.keys(byCanonical).sort(), ['border-width', 'spacing', 'typography']);
  assert.equal(byCanonical['spacing'].collections.length, 2);
  assert.equal(byCanonical['border-width'].collections.length, 2);
  assert.equal(byCanonical['typography'].collections.length, 2);
});

test('does not fire when only one collection exists per canonical', () => {
  // No duplicates — alias resolution finds exactly one Figma collection
  // per canonical, nothing to consolidate.
  const groups = detectDuplicateCollections([
    'Color/zinc-500', 'Color/red-500',
    'Spacing/4',
    'Radius/sm',
  ]);
  assert.deepEqual(groups, []);
});

test('ignores collections whose names don\'t alias to a known canonical', () => {
  // "Foo" isn't in the alias table. Doesn't surface.
  const groups = detectDuplicateCollections([
    'Foo/x', 'Foo/y',
    'Bar/x',
  ]);
  assert.deepEqual(groups, []);
});

test('handles three-way duplicates (Color + colors + Colour)', () => {
  const groups = detectDuplicateCollections([
    'Color/a', 'Color/b', 'Color/c',
    'colors/a',
    'Colour/a', 'Colour/b',
  ]);
  assert.equal(groups.length, 1);
  // Three collections, sorted by varCount desc, then by name asc.
  assert.deepEqual(groups[0].collections.map(c => c.name), ['Color', 'Colour', 'colors']);
});

test('empty / invalid input returns empty array (safe default)', () => {
  assert.deepEqual(detectDuplicateCollections([]), []);
  assert.deepEqual(detectDuplicateCollections(null), []);
  assert.deepEqual(detectDuplicateCollections(undefined), []);
});

test('skips entries without a slash (single-segment names)', () => {
  // Bare names like "loose" don't have a collection prefix; ignore them.
  const groups = detectDuplicateCollections(['Color/a', 'color/a', 'loose']);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].canonical, 'color');
});
