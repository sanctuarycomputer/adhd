'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseCssDimension } = require('../cli.js');

test('parseCssDimension: rem', () => {
  assert.deepEqual(parseCssDimension('0.25rem'), { value: 0.25, unit: 'rem' });
  assert.deepEqual(parseCssDimension('1rem'), { value: 1, unit: 'rem' });
});

test('parseCssDimension: px', () => {
  assert.deepEqual(parseCssDimension('4px'), { value: 4, unit: 'px' });
  assert.deepEqual(parseCssDimension('16px'), { value: 16, unit: 'px' });
});

test('parseCssDimension: em', () => {
  assert.deepEqual(parseCssDimension('1.5em'), { value: 1.5, unit: 'em' });
});

test('parseCssDimension: negative values', () => {
  assert.deepEqual(parseCssDimension('-1.5em'), { value: -1.5, unit: 'em' });
  assert.deepEqual(parseCssDimension('-1px'), { value: -1, unit: 'px' });
});

test('parseCssDimension: unitless 0', () => {
  // CSS conventionally allows bare 0 (with no unit). Treat as px.
  assert.deepEqual(parseCssDimension('0'), { value: 0, unit: 'px' });
});

test('parseCssDimension: whitespace-tolerant', () => {
  assert.deepEqual(parseCssDimension('  1rem  '), { value: 1, unit: 'rem' });
});

test('parseCssDimension: unsupported unit returns null', () => {
  assert.equal(parseCssDimension('1pt'), null);
  assert.equal(parseCssDimension('1vh'), null);
});

test('parseCssDimension: malformed returns null', () => {
  assert.equal(parseCssDimension(''), null);
  assert.equal(parseCssDimension('abc'), null);
  assert.equal(parseCssDimension('rem'), null);
  assert.equal(parseCssDimension('1.5'), null);  // no unit, not 0
});
