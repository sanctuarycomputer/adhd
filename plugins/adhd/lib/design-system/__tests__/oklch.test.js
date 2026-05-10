'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { oklchStringToRgb, oklchStringToHex } = require('../oklch');

test('pure red oklch round-trips to ~#ff0000 within ±2 per channel', () => {
  // sRGB pure red is approximately oklch(62.8% 0.258 29.234)
  const { r, g, b } = oklchStringToRgb('oklch(62.8% 0.258 29.234)');
  // convert to 0-255
  const r255 = Math.round(r * 255);
  const g255 = Math.round(g * 255);
  const b255 = Math.round(b * 255);
  assert.ok(Math.abs(r255 - 255) <= 2, 'red channel: expected ~255, got ' + r255);
  assert.ok(Math.abs(g255 - 0) <= 2, 'green channel: expected ~0, got ' + g255);
  assert.ok(Math.abs(b255 - 0) <= 2, 'blue channel: expected ~0, got ' + b255);
});

test('pure black oklch(0% 0 0) → #000000', () => {
  assert.equal(oklchStringToHex('oklch(0% 0 0)'), '#000000');
});

test('pure white oklch(100% 0 0) → #ffffff (or very close)', () => {
  const hex = oklchStringToHex('oklch(100% 0 0)');
  assert.equal(hex, '#ffffff');
});

test('alpha-bearing oklch produces 8-char hex', () => {
  // oklch(50% 0.1 30 / 0.5)
  const hex = oklchStringToHex('oklch(50% 0.1 30 / 0.5)');
  // Hex with alpha: '#' + 8 hex chars = 9 chars total
  assert.equal(hex.length, 9, 'expected 9-char hex (incl. #), got: ' + hex);
  // last 2 chars represent alpha = 0.5 → 128 → '80'
  assert.equal(hex.slice(-2), '80');
});
