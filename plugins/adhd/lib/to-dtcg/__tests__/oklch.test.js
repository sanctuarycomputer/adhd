'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { oklchToColorValue } = require('../cli.js');

// Tailwind v4's red-500 reference: oklch(63.7% 0.237 25.331). Components are
// gamma-encoded sRGB floats in [0, 1]. The hex equivalent of these components,
// rounded to 8-bit channels, is #fb2c36.
test('oklchToColorValue: red-500 returns ColorValue object', () => {
  const cv = oklchToColorValue(0.637, 0.237, 25.331);
  assert.equal(cv.colorSpace, 'srgb');
  assert.equal(cv.alpha, 1);
  assert.equal(cv.components.length, 3);
  // Components ≈ #fb2c36 = (251/255, 44/255, 54/255) ≈ (0.984, 0.172, 0.212).
  assert.ok(Math.abs(cv.components[0] - 0.984) <= 0.005, `R: ${cv.components[0]}`);
  assert.ok(Math.abs(cv.components[1] - 0.172) <= 0.005, `G: ${cv.components[1]}`);
  assert.ok(Math.abs(cv.components[2] - 0.212) <= 0.005, `B: ${cv.components[2]}`);
});

test('oklchToColorValue: black is exactly [0, 0, 0]', () => {
  const cv = oklchToColorValue(0, 0, 0);
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [0, 0, 0],
    alpha: 1,
  });
});

test('oklchToColorValue: white is exactly [1, 1, 1]', () => {
  const cv = oklchToColorValue(1, 0, 0);
  assert.deepEqual(cv, {
    colorSpace: 'srgb',
    components: [1, 1, 1],
    alpha: 1,
  });
});
