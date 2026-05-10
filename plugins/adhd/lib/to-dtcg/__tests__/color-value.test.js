'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { rgbObjectToColorValue } = require('../cli.js');

test('rgbObjectToColorValue: full alpha', () => {
  const cv = rgbObjectToColorValue({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0.5, 0.5, 0.5],
    alpha: 1,
  });
});

test('rgbObjectToColorValue: partial alpha', () => {
  const cv = rgbObjectToColorValue({ r: 1, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [1, 0, 0],
    alpha: 0.5,
  });
});

test('rgbObjectToColorValue: alpha undefined defaults to 1', () => {
  const cv = rgbObjectToColorValue({ r: 0, g: 0, b: 0 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('rgbObjectToColorValue: gold-100 round-trip from RGB', () => {
  // Figma stores #faf0c5 = (250, 240, 197) ≈ (0.9804, 0.9412, 0.7725).
  const cv = rgbObjectToColorValue({ r: 0.9804, g: 0.9412, b: 0.7725, a: 1 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0.9804, 0.9412, 0.7725],
    alpha: 1,
  });
});

test('rgbObjectToColorValue: rounds to 4 decimals', () => {
  const cv = rgbObjectToColorValue({ r: 0.123456789, g: 0.987654321, b: 0.5, a: 0.9876543 });
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0.1235, 0.9877, 0.5],
    alpha: 0.9877,
  });
});
