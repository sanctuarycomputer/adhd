'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReverseIndex, lookupColor, lookupColorFuzzy, lookupNumber, lookupEffect } = require('../reverse-index');

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

test('fuzzy color lookup finds nearest variable within threshold (amber/500 quantization case)', () => {
  // amber/500 design-system value is rgb(1.0, 0.6, 0).
  // Figma's 8-bit float quantization returns (0.994, 0.602, 0) which
  // rounds to (0.99, 0.60, 0.00) — 2-decimal exact match misses.
  // Distance ≈ 0.006, well within 0.02 threshold.
  const extract = {
    collections: [{
      name: 'color',
      modes: [{ id: 'M1', name: 'Light' }],
      variables: [
        {
          id: 'V_AMBER', name: 'amber/500', resolvedType: 'COLOR', scopes: [],
          valuesByMode: { Light: { kind: 'color', r: 1, g: 0.6, b: 0, a: 1 } },
        },
      ],
    }],
    effectStyles: [], textStyles: [],
  };
  const index = buildReverseIndex(extract);
  // Exact (2-decimal) miss
  assert.equal(lookupColor(index, { r: 0.9942, g: 0.6020, b: 0, a: 1 }), null);
  // Fuzzy hit
  const fuzzy = lookupColorFuzzy(index, { r: 0.9942, g: 0.6020, b: 0, a: 1 }, 0.02);
  assert.equal(fuzzy && fuzzy.name, 'amber/500');
});

test('fuzzy color lookup returns null when nothing is within threshold', () => {
  const index = buildReverseIndex(EXTRACT);
  const fuzzy = lookupColorFuzzy(index, { r: 0.1, g: 0.1, b: 0.1, a: 1 }, 0.02);
  assert.equal(fuzzy, null);
});

test('fuzzy color lookup returns the closest match when multiple are within threshold', () => {
  const extract = {
    collections: [{
      name: 'color',
      modes: [{ id: 'M1', name: 'Light' }],
      variables: [
        { id: 'A', name: 'gray/500', resolvedType: 'COLOR', scopes: [],
          valuesByMode: { M1: { kind: 'color', r: 0.5, g: 0.5, b: 0.5, a: 1 } } },
        { id: 'B', name: 'gray/600', resolvedType: 'COLOR', scopes: [],
          valuesByMode: { M1: { kind: 'color', r: 0.45, g: 0.45, b: 0.45, a: 1 } } },
      ],
    }],
    effectStyles: [], textStyles: [],
  };
  const index = buildReverseIndex(extract);
  // Slightly closer to gray/500
  const v = lookupColorFuzzy(index, { r: 0.51, g: 0.51, b: 0.51, a: 1 }, 0.1);
  assert.equal(v && v.name, 'gray/500');
});

test('typography lookup finds a font-size variable by px value', () => {
  const extract = {
    collections: [{
      name: 'typography',
      modes: [{ id: 'M1', name: 'Mode 1' }],
      variables: [
        { id: 'TXS', name: 'text/xs', resolvedType: 'FLOAT', scopes: [],
          valuesByMode: { M1: { kind: 'literal', value: 12 } } },
        { id: 'T2XS', name: 'text/2xs', resolvedType: 'FLOAT', scopes: [],
          valuesByMode: { M1: { kind: 'literal', value: 10 } } },
      ],
    }],
    effectStyles: [], textStyles: [],
  };
  const index = buildReverseIndex(extract);
  assert.equal(lookupNumber(index, 'typography', 10).name, 'text/2xs');
  assert.equal(lookupNumber(index, 'typography', 12).name, 'text/xs');
  assert.equal(lookupNumber(index, 'typography', 11), null);
});

test('effect lookup finds an effect style by shadow signature', () => {
  const extract = {
    collections: [],
    effectStyles: [
      {
        id: 'S:shadow2xs', name: 'shadow/2xs',
        effects: [{
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.05 },
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: 0,
        }],
      },
      {
        id: 'S:shadowMd', name: 'shadow/md',
        effects: [{
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.1 },
          offset: { x: 0, y: 4 },
          radius: 6,
          spread: -1,
        }],
      },
    ],
    textStyles: [],
  };
  const index = buildReverseIndex(extract);
  const hit = lookupEffect(index, [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.05 },
    offset: { x: 0, y: 1 },
    radius: 2,
    spread: 0,
  }]);
  assert.equal(hit && hit.id, 'S:shadow2xs');
});

test('effect lookup returns null when no signature matches', () => {
  const extract = {
    collections: [],
    effectStyles: [
      { id: 'S:a', name: 'shadow/lg', effects: [{
        type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 8 }, radius: 12, spread: 0,
      }]},
    ],
    textStyles: [],
  };
  const index = buildReverseIndex(extract);
  const hit = lookupEffect(index, [{
    type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.05 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0,
  }]);
  assert.equal(hit, null);
});
