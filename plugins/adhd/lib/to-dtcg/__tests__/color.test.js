'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseCssColor } = require('../cli.js');

test('parseCssColor: 6-char hex', () => {
  assert.deepEqual(parseCssColor('#faf0c5'), {
    colorSpace: 'srgb',
    components: [0.9804, 0.9412, 0.7725],
    alpha: 1,
  });
});

test('parseCssColor: 3-char hex (expanded)', () => {
  assert.deepEqual(parseCssColor('#abc'), {
    colorSpace: 'srgb',
    components: [0.6667, 0.7333, 0.8],
    alpha: 1,
  });
});

test('parseCssColor: 8-char hex (with alpha)', () => {
  assert.deepEqual(parseCssColor('#ff0000ff'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 1,
  });
  assert.deepEqual(parseCssColor('#ff000080'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 0.502,
  });
});

test('parseCssColor: rgb() legacy syntax', () => {
  assert.deepEqual(parseCssColor('rgb(255, 0, 0)'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: rgba() legacy syntax', () => {
  assert.deepEqual(parseCssColor('rgba(0, 0, 0, 0.1)'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 0.1,
  });
});

test('parseCssColor: rgb() modern syntax (space-separated)', () => {
  assert.deepEqual(parseCssColor('rgb(255 0 0)'), {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: rgb() modern syntax with alpha', () => {
  assert.deepEqual(parseCssColor('rgb(0 0 0 / 0.1)'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 0.1,
  });
});

test('parseCssColor: named transparent', () => {
  assert.deepEqual(parseCssColor('transparent'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 0,
  });
});

test('parseCssColor: named black', () => {
  assert.deepEqual(parseCssColor('black'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: named white', () => {
  assert.deepEqual(parseCssColor('white'), {
    colorSpace: 'srgb',
    components: [1, 1, 1],
    alpha: 1,
  });
});

test('parseCssColor: case-insensitive named colors', () => {
  assert.deepEqual(parseCssColor('BLACK'), {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('parseCssColor: throws on unparseable input', () => {
  assert.throws(() => parseCssColor('not-a-color'), /Unparseable CSS color/);
  assert.throws(() => parseCssColor('hsl(0, 100%, 50%)'), /Unparseable CSS color/);
});
