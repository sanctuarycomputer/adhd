'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseCssShadow } = require('../cli.js');

test('parseCssShadow: single shadow with rgba', () => {
  const result = parseCssShadow('0 4px 6px -1px rgba(0, 0, 0, 0.1)');
  assert.deepEqual(result, [{
    color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1 },
    offsetX: { value: 0, unit: 'px' },
    offsetY: { value: 4, unit: 'px' },
    blur:    { value: 6, unit: 'px' },
    spread:  { value: -1, unit: 'px' },
    inset:   false,
  }]);
});

test('parseCssShadow: single shadow with rgb modern syntax', () => {
  const result = parseCssShadow('0 1px 3px 0 rgb(0 0 0 / 0.1)');
  assert.deepEqual(result, [{
    color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1 },
    offsetX: { value: 0, unit: 'px' },
    offsetY: { value: 1, unit: 'px' },
    blur:    { value: 3, unit: 'px' },
    spread:  { value: 0, unit: 'px' },
    inset:   false,
  }]);
});

test('parseCssShadow: multi-shadow stack (Tailwind v4 shadow-md)', () => {
  const result = parseCssShadow('0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].offsetY, { value: 4, unit: 'px' });
  assert.deepEqual(result[1].offsetY, { value: 2, unit: 'px' });
  assert.equal(result[0].inset, false);
  assert.equal(result[1].inset, false);
});

test('parseCssShadow: inset keyword', () => {
  const result = parseCssShadow('inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)');
  assert.equal(result.length, 1);
  assert.equal(result[0].inset, true);
  assert.deepEqual(result[0].offsetY, { value: 2, unit: 'px' });
});

test('parseCssShadow: 3 dimensions (no spread)', () => {
  const result = parseCssShadow('0 4px 6px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].spread, { value: 0, unit: 'px' });
  assert.deepEqual(result[0].blur, { value: 6, unit: 'px' });
});

test('parseCssShadow: 2 dimensions (no blur, no spread)', () => {
  const result = parseCssShadow('0 4px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].blur, { value: 0, unit: 'px' });
  assert.deepEqual(result[0].spread, { value: 0, unit: 'px' });
  assert.deepEqual(result[0].offsetY, { value: 4, unit: 'px' });
});

test('parseCssShadow: hex color', () => {
  const result = parseCssShadow('0 1px 2px #000000');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].color, {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('parseCssShadow: comma in rgba does not split shadows', () => {
  const result = parseCssShadow('0 1px 2px rgba(0, 0, 0, 0.1)');
  assert.equal(result.length, 1, 'should be 1 shadow, not 4');
});

test('parseCssShadow: throws on insufficient tokens', () => {
  assert.throws(() => parseCssShadow('rgba(0, 0, 0, 0.1)'), /at least offsetX, offsetY, color/);
});
