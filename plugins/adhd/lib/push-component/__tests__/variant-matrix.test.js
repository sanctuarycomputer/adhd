'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { variantMatrix, capWithCoverage, variantKey } = require('../variant-matrix');

test('full Cartesian product when no cap', () => {
  const axes = {
    size: ['xs', 'sm', 'md'],
    shape: ['circle', 'square'],
  };
  const matrix = variantMatrix(axes);
  assert.equal(matrix.length, 6);
});

test('includes undefined for optional union props (added as implicit value)', () => {
  const axes = { status: ['online', 'away', 'offline', 'undefined'] };
  const matrix = variantMatrix(axes);
  assert.equal(matrix.length, 4);
  assert.ok(matrix.some(v => v.status === 'undefined'));
});

test('Avatar shape: 5 sizes × 2 shapes × 4 status = 40', () => {
  const axes = {
    size: ['xs', 'sm', 'md', 'lg', 'xl'],
    shape: ['circle', 'square'],
    status: ['online', 'away', 'offline', 'undefined'],
  };
  const matrix = variantMatrix(axes);
  assert.equal(matrix.length, 40);
});

test('variantKey produces stable lexically-sorted string', () => {
  assert.equal(variantKey({ size: 'xs', shape: 'circle' }), 'shape=circle;size=xs');
  assert.equal(variantKey({ status: 'online', size: 'md' }), 'size=md;status=online');
});

test('capWithCoverage preserves every axis value when cap >= unique value count', () => {
  const axes = { size: ['xs', 'sm', 'md', 'lg', 'xl'], shape: ['circle', 'square'] };
  const full = variantMatrix(axes); // 10
  const capped = capWithCoverage(full, axes, 7);
  // 7 variants must collectively contain all values of all axes
  const sizesUsed = new Set(capped.map(v => v.size));
  const shapesUsed = new Set(capped.map(v => v.shape));
  assert.equal(sizesUsed.size, 5);
  assert.equal(shapesUsed.size, 2);
  assert.equal(capped.length, 7);
});

test('capWithCoverage requires cap >= max axis size; throws otherwise', () => {
  const axes = { size: ['xs', 'sm', 'md', 'lg', 'xl'] };
  assert.throws(() => capWithCoverage(variantMatrix(axes), axes, 3), /cap too small/);
});

test('capWithCoverage produces lexically-sorted output after coverage', () => {
  const axes = { size: ['xs', 'sm', 'md'] };
  const capped = capWithCoverage(variantMatrix(axes), axes, 3);
  const keys = capped.map(variantKey);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
});
