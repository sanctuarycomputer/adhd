'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReverseIndex, lookupColor, lookupNumber } = require('../reverse-index');

const EXTRACT = {
  collections: [
    {
      name: 'color',
      modes: [{ id: 'M1', name: 'Light' }, { id: 'M2', name: 'Dark' }],
      variables: [
        {
          id: 'V1', name: 'gold/100', resolvedType: 'COLOR', scopes: [],
          valuesByMode: {
            Light: { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
            Dark:  { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
          },
        },
        {
          id: 'V2', name: 'brand/surface', resolvedType: 'COLOR', scopes: [],
          valuesByMode: {
            Light: { kind: 'alias', targetName: 'gold/100', targetId: 'V1' },
            Dark:  { kind: 'alias', targetName: 'gold/900', targetId: 'V99' },
          },
        },
      ],
    },
    {
      name: 'spacing',
      modes: [{ id: 'M3', name: 'Mode 1' }],
      variables: [
        { id: 'V3', name: '4', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 16 } } },
        { id: 'V4', name: '8', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 32 } } },
      ],
    },
    {
      name: 'radius',
      modes: [{ id: 'M4', name: 'Mode 1' }],
      variables: [
        { id: 'V5', name: 'sm', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 4 } } },
        { id: 'V6', name: 'full', resolvedType: 'FLOAT', scopes: [], valuesByMode: { 'Mode 1': { kind: 'literal', value: 9999 } } },
      ],
    },
  ],
  effectStyles: [], textStyles: [],
};

test('looks up a color by RGB triple', () => {
  const index = buildReverseIndex(EXTRACT);
  const v = lookupColor(index, { r: 0.98, g: 0.94, b: 0.77, a: 1 });
  assert.equal(v.name, 'gold/100');
  assert.equal(v.id, 'V1');
});

test('color lookup tolerates small float drift', () => {
  const index = buildReverseIndex(EXTRACT);
  // 0.98 vs 0.9803921 — same color, different precision
  const v = lookupColor(index, { r: 0.9803921, g: 0.9411764, b: 0.7725490, a: 1 });
  assert.equal(v && v.name, 'gold/100');
});

test('returns null for an unknown color', () => {
  const index = buildReverseIndex(EXTRACT);
  assert.equal(lookupColor(index, { r: 0.5, g: 0.5, b: 0.5, a: 1 }), null);
});

test('looks up spacing by px value', () => {
  const index = buildReverseIndex(EXTRACT);
  const v = lookupNumber(index, 'spacing', 16);
  assert.equal(v.name, '4');
});

test('looks up radius by px value', () => {
  const index = buildReverseIndex(EXTRACT);
  const v = lookupNumber(index, 'radius', 4);
  assert.equal(v.name, 'sm');
});

test('returns null for unknown spacing', () => {
  const index = buildReverseIndex(EXTRACT);
  assert.equal(lookupNumber(index, 'spacing', 7), null);
});

test('skips alias values (aliases resolve through the index, not into it)', () => {
  const index = buildReverseIndex(EXTRACT);
  // brand/surface is an alias; its concrete color is gold/100's color, so
  // looking up that color returns gold/100 (the underlying primitive),
  // not brand/surface
  const v = lookupColor(index, { r: 0.98, g: 0.94, b: 0.77, a: 1 });
  assert.equal(v.name, 'gold/100');
});
