'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { oklchToHex, oklchToColorValue } = require('../cli.js');

// Tailwind v4's red-500 reference: oklch(63.7% 0.237 25.331). The hex equivalent
// computed via the OKLCH → OKLab → sRGB pipeline (Ottosson) is ~#fb2c36.
test('oklchToHex: red-500 → ~#fb2c36 (Tailwind v4)', () => {
  const hex = oklchToHex(0.637, 0.237, 25.331);
  // Allow ±1 LSB per channel for OKLCH→sRGB precision drift.
  assertHexCloseTo(hex, '#fb2c36', 1);
});

test('oklchToHex: pure black', () => {
  assert.equal(oklchToHex(0, 0, 0), '#000000');
});

test('oklchToHex: pure white', () => {
  assert.equal(oklchToHex(1, 0, 0), '#ffffff');
});

// Tailwind v4's gold-100-ish: oklch(95% 0.05 96)
test('oklchToHex: low-chroma yellow stays in gamut', () => {
  const hex = oklchToHex(0.95, 0.05, 96);
  assert.match(hex, /^#[0-9a-f]{6}$/);
});

// Tailwind v4's red-500 reference: components ≈ #fb2c36 = (251/255, 44/255, 54/255)
// ≈ (0.984, 0.172, 0.212).
test('oklchToColorValue: red-500 returns ColorValue object', () => {
  const cv = oklchToColorValue(0.637, 0.237, 25.331);
  assert.equal(cv.colorSpace, 'srgb');
  assert.equal(cv.alpha, 1);
  assert.equal(cv.components.length, 3);
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

function assertHexCloseTo(actual, expected, tolerance) {
  const a = parseHex(actual);
  const e = parseHex(expected);
  for (const ch of ['r', 'g', 'b']) {
    assert.ok(
      Math.abs(a[ch] - e[ch]) <= tolerance,
      `channel ${ch}: actual=${a[ch]}, expected=${e[ch]}, tol=${tolerance}`
    );
  }
}

function parseHex(h) {
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}
