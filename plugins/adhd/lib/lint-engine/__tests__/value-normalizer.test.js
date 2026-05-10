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

test('valuesMatch deep-equals shadow objects', () => {
  const a = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#000000' };
  const b = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#000000' };
  const c = { ...a, blur: '12px' };
  assert.equal(valuesMatch(a, b, 'shadow'), true);
  assert.equal(valuesMatch(a, c, 'shadow'), false);
});
