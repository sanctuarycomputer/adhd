'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFigmaDesignSystem } = require('../figma-parser');

const EXTRACT_FIXTURE = {
  collections: [
    {
      id: 'VariableCollectionId:1', name: 'color',
      modes: [{ id: 'M1', name: 'Light' }, { id: 'M2', name: 'Dark' }],
      variables: [
        {
          id: 'V1', name: 'gold/100', resolvedType: 'COLOR',
          scopes: ['FRAME_FILL'],
          valuesByMode: {
            Light: { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
            Dark:  { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
          },
        },
        {
          id: 'V2', name: 'brand/surface', resolvedType: 'COLOR',
          scopes: ['FRAME_FILL'],
          valuesByMode: {
            Light: { kind: 'alias', targetName: 'gold/100', targetId: 'V1' },
            Dark:  { kind: 'alias', targetName: 'gold/900', targetId: 'V99' },
          },
        },
      ],
    },
  ],
  effectStyles: [
    {
      id: 'S1', name: 'shadow-2xs',
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.05 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true, blendMode: 'NORMAL' }],
    },
  ],
  textStyles: [],
};

test('produces tokens with light/dark literals from primitive variables', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'gold/100');
  assert.ok(t);
  assert.equal(t.domain, 'color');
  assert.equal(t.values.light.type, 'literal');
  assert.match(t.values.light.value, /^#[0-9a-f]{6}$/i);
});

test('alias values map to alias type with target path', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'brand/surface');
  assert.deepEqual(t.values.light, { type: 'alias', target: 'gold/100' });
  assert.deepEqual(t.values.dark,  { type: 'alias', target: 'gold/900' });
});

test('treats single-mode collections as default', () => {
  const ds = parseFigmaDesignSystem({
    collections: [{
      id: 'C', name: 'spacing',
      modes: [{ id: 'M', name: 'Mode 1' }],
      variables: [{
        id: 'V', name: '4', resolvedType: 'FLOAT', scopes: ['GAP'],
        valuesByMode: { 'Mode 1': { kind: 'literal', value: 16 } },
      }],
    }],
    effectStyles: [], textStyles: [],
  });
  const t = ds.tokens.find(x => x.path === '4');
  assert.equal(t.domain, 'spacing');
  assert.equal(t.values.default.type, 'literal');
});

test('infers domain from collection name', () => {
  const ds = parseFigmaDesignSystem({
    collections: [
      { id: 'A', name: 'spacing', modes: [{id:'X',name:'Mode 1'}], variables: [{id:'V1',name:'4',resolvedType:'FLOAT',scopes:[],valuesByMode:{'Mode 1':{kind:'literal',value:16}}}] },
      { id: 'B', name: 'radius',  modes: [{id:'Y',name:'Mode 1'}], variables: [{id:'V2',name:'sm',resolvedType:'FLOAT',scopes:[],valuesByMode:{'Mode 1':{kind:'literal',value:4}}}] },
    ],
    effectStyles: [], textStyles: [],
  });
  const byPath = Object.fromEntries(ds.tokens.map(t => [t.path, t.domain]));
  assert.equal(byPath['4'], 'spacing');
  assert.equal(byPath['sm'], 'radius');
});

test('color values normalize to 6-digit lowercase hex', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'gold/100');
  assert.equal(t.values.light.value.length, 7); // # + 6 hex chars
  assert.equal(t.values.light.value, t.values.light.value.toLowerCase());
});

test('effect styles and text styles surface as ds.styles', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  assert.equal(ds.styles.effects.length, 1);
  assert.equal(ds.styles.effects[0].name, 'shadow-2xs');
  assert.equal(ds.styles.text.length, 0);
});
