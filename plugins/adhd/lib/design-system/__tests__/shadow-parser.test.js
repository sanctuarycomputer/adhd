'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseShadow, splitTopLevelCommas } = require('../shadow-parser');

function approxEqual(a, b, tol = 1e-3) {
  return Math.abs(a - b) <= tol;
}

test('parses a single simple shadow with all four lengths and rgba color', () => {
  const out = parseShadow('0 4px 6px -1px rgba(0, 0, 0, 0.1)');
  assert.equal(out.length, 1);
  const s = out[0];
  assert.equal(s.inset, false);
  assert.equal(s.offsetX, 0);
  assert.equal(s.offsetY, 4);
  assert.equal(s.blur, 6);
  assert.equal(s.spread, -1);
  assert.ok(approxEqual(s.color.r, 0));
  assert.ok(approxEqual(s.color.g, 0));
  assert.ok(approxEqual(s.color.b, 0));
  assert.ok(approxEqual(s.color.a, 0.1));
});

test('parses a multi-shadow (comma-separated) into N entries', () => {
  // Tailwind --shadow-md
  const out = parseShadow('0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)');
  assert.equal(out.length, 2);
  assert.equal(out[0].offsetY, 4);
  assert.equal(out[0].blur, 6);
  assert.equal(out[0].spread, -1);
  assert.equal(out[1].offsetY, 2);
  assert.equal(out[1].blur, 4);
  assert.equal(out[1].spread, -2);
});

test('parses inset keyword (leading) and sets the inset flag', () => {
  const out = parseShadow('inset 0 2px 4px 0 rgb(0 0 0 / 0.05)');
  assert.equal(out.length, 1);
  assert.equal(out[0].inset, true);
  assert.equal(out[0].offsetX, 0);
  assert.equal(out[0].offsetY, 2);
  assert.equal(out[0].blur, 4);
  assert.equal(out[0].spread, 0);
});

test('parses alpha channel in rgba() correctly', () => {
  const out = parseShadow('0 1px 2px rgba(0, 0, 0, 0.5)');
  assert.equal(out.length, 1);
  assert.ok(approxEqual(out[0].color.a, 0.5));
});

test('parses oklch() color in shadow', () => {
  // oklch(50% 0 0) is roughly mid-grey
  const out = parseShadow('0 4px 8px oklch(50% 0 0 / 0.4)');
  assert.equal(out.length, 1);
  assert.ok(approxEqual(out[0].color.a, 0.4));
  // L=0.5, C=0, H=0 → achromatic; rgb channels should be approx equal
  assert.ok(approxEqual(out[0].color.r, out[0].color.g, 1e-2));
  assert.ok(approxEqual(out[0].color.g, out[0].color.b, 1e-2));
});

test('omits blur/spread when not provided (defaults to 0)', () => {
  const out = parseShadow('0 1px rgb(0 0 0 / 0.05)');
  assert.equal(out.length, 1);
  assert.equal(out[0].offsetX, 0);
  assert.equal(out[0].offsetY, 1);
  assert.equal(out[0].blur, 0);
  assert.equal(out[0].spread, 0);
});

test('parses inset shadow (only X+Y lengths, then color)', () => {
  // Tailwind --inset-shadow-2xs
  const out = parseShadow('inset 0 1px rgb(0 0 0 / 0.05)');
  assert.equal(out.length, 1);
  assert.equal(out[0].inset, true);
  assert.equal(out[0].offsetY, 1);
  assert.equal(out[0].blur, 0);
});

test('parses rem-unit length and converts to px (1rem=16px)', () => {
  const out = parseShadow('0 0.5rem 1rem black');
  assert.equal(out.length, 1);
  assert.equal(out[0].offsetY, 8);
  assert.equal(out[0].blur, 16);
});

test('parses hex color in shadow (#rgb / #rrggbb / #rrggbbaa)', () => {
  const out = parseShadow('0 4px 6px #00000019');
  assert.equal(out.length, 1);
  assert.ok(approxEqual(out[0].color.r, 0));
  assert.ok(approxEqual(out[0].color.a, 0x19 / 255, 1e-3));
});

test('splitTopLevelCommas respects commas inside function calls', () => {
  const out = splitTopLevelCommas('rgb(0, 0, 0), rgba(255, 255, 255, 0.5)');
  assert.equal(out.length, 2);
  assert.equal(out[0], 'rgb(0, 0, 0)');
  assert.equal(out[1], 'rgba(255, 255, 255, 0.5)');
});

test('parses a 3-shadow text-shadow string with rgb / function commas', () => {
  // Real Tailwind --text-shadow-sm
  const css = '0px 1px 0px rgb(0 0 0 / 0.075), 0px 1px 1px rgb(0 0 0 / 0.075), 0px 2px 2px rgb(0 0 0 / 0.075)';
  const out = parseShadow(css);
  assert.equal(out.length, 3);
  assert.equal(out[0].offsetY, 1); assert.equal(out[0].blur, 0);
  assert.equal(out[1].offsetY, 1); assert.equal(out[1].blur, 1);
  assert.equal(out[2].offsetY, 2); assert.equal(out[2].blur, 2);
});
