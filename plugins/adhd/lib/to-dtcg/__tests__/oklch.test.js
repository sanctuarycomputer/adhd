'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { oklchToHex } = require('../cli.js');

// Tailwind v4's red-500 reference: oklch(63.7% 0.237 25.331) ≈ #ef4444
test('oklch red-500 → ~#ef4444', () => {
  const hex = oklchToHex(0.637, 0.237, 25.331);
  // Allow ±1 LSB per channel for OKLCH→sRGB precision drift.
  assertHexCloseTo(hex, '#ef4444', 1);
});

// Tailwind v4's gold-100-ish: oklch(95% 0.05 96)
test('oklch low-chroma yellow stays in gamut', () => {
  const hex = oklchToHex(0.95, 0.05, 96);
  // Should be a light yellow; alpha implicit
  assert.match(hex, /^#[0-9a-f]{6}$/);
});

// Pure black
test('oklch L=0 → #000000', () => {
  const hex = oklchToHex(0, 0, 0);
  assert.equal(hex, '#000000');
});

// Pure white
test('oklch L=1 C=0 → #ffffff', () => {
  const hex = oklchToHex(1, 0, 0);
  assert.equal(hex, '#ffffff');
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
