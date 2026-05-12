'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeColor, normalizeDimension, valuesMatch } = require('../value-normalizer');

test('normalizeColor lowercases hex and pads to 6 digits', () => {
  assert.equal(normalizeColor('#5E3AEE'), '#5e3aee');
  assert.equal(normalizeColor('#fff'), '#ffffff');
  assert.equal(normalizeColor('#FFF'), '#ffffff');
});

test('normalizeColor preserves alpha when present', () => {
  assert.equal(normalizeColor('#5E3AEEFF'), '#5e3aeeff');
  assert.equal(normalizeColor('#5e3aee80'), '#5e3aee80');
});

test('normalizeColor accepts rgb()/rgba() and converts to hex', () => {
  assert.equal(normalizeColor('rgb(94, 58, 238)'), '#5e3aee');
  assert.equal(normalizeColor('rgba(94, 58, 238, 0.5)'), '#5e3aee80');
});

test('normalizeDimension converts rem to px (assuming 16px root)', () => {
  assert.equal(normalizeDimension('1rem'), '16px');
  assert.equal(normalizeDimension('2rem'), '32px');
  assert.equal(normalizeDimension('0.5rem'), '8px');
});

test('normalizeDimension passes through px values', () => {
  assert.equal(normalizeDimension('32px'), '32px');
});

test('normalizeDimension preserves unitless values (e.g., line-height)', () => {
  assert.equal(normalizeDimension('1.5'), '1.5');
});

test('valuesMatch dispatches on domain', () => {
  assert.equal(valuesMatch('#5E3AEE', '#5e3aee', 'color'), true);
  assert.equal(valuesMatch('#5E3AEE', '#000000', 'color'), false);
  assert.equal(valuesMatch('1rem', '16px', 'spacing'), true);
  assert.equal(valuesMatch('1.5', '1.5', 'typography'), true);
});

test('normalizeColor accepts Figma\'s raw {r,g,b,a} object form (channels 0..1)', () => {
  // Real scenario from the user's reactor file: the SKILL\'s serializer
  // emits color variable values straight from variable.valuesByMode, so
  // figma side arrives as `{r:0.039, g:0.039, b:0.039, a:1}` while code
  // is `#0a0a0a`. Without this branch the comparator falsely flagged
  // these as conflicts.
  assert.equal(normalizeColor({ r: 0.039, g: 0.039, b: 0.039, a: 1 }), '#0a0a0a');
  assert.equal(normalizeColor({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(normalizeColor({ r: 1, g: 1, b: 1 }), '#ffffff');
  // Alpha < 1 surfaces in the hex.
  assert.equal(normalizeColor({ r: 1, g: 0, b: 0, a: 0.5 }), '#ff000080');
});

test('valuesMatch resolves hex-vs-RGB-object as equal (the "primary" false-conflict fix)', () => {
  assert.equal(valuesMatch({ r: 0.039, g: 0.039, b: 0.039, a: 1 }, '#0a0a0a', 'color'), true);
  // Truly different colors still conflict.
  assert.equal(valuesMatch({ r: 1, g: 0, b: 0, a: 1 }, '#000000', 'color'), false);
});

test('valuesMatch deep-equals shadow objects', () => {
  const a = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#000000' };
  const b = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#000000' };
  const c = { ...a, blur: '12px' };
  assert.equal(valuesMatch(a, b, 'shadow'), true);
  assert.equal(valuesMatch(a, c, 'shadow'), false);
});
