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

test('produces tokens with literal values from primitive variables (collapsed to default when modes are identical)', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'gold/100');
  assert.ok(t);
  assert.equal(t.domain, 'color');
  // gold/100 has the same value in Light and Dark, so it collapses to default
  assert.equal(t.values.default.type, 'literal');
  assert.match(t.values.default.value, /^#[0-9a-f]{6}$/i);
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
  // gold/100 collapses to default (same value across modes)
  assert.equal(t.values.default.value.length, 7); // # + 6 hex chars
  assert.equal(t.values.default.value, t.values.default.value.toLowerCase());
});

test('effect styles and text styles surface as ds.styles', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  assert.equal(ds.styles.effects.length, 1);
  assert.equal(ds.styles.effects[0].name, 'shadow-2xs');
  assert.equal(ds.styles.text.length, 0);
});

test('collapses to default when all modes hold the same value (mode-independent primitive in multi-mode collection)', () => {
  // gold/100 has the same hex in both Light and Dark — should collapse to default
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'gold/100');
  assert.ok(t);
  assert.deepEqual(Object.keys(t.values), ['default']);
  assert.equal(t.values.default.type, 'literal');
});

test('does NOT collapse when modes differ (semantic vars stay multi-mode)', () => {
  const ds = parseFigmaDesignSystem(EXTRACT_FIXTURE);
  const t = ds.tokens.find(x => x.path === 'brand/surface');
  assert.ok(t);
  // brand/surface has different aliases per mode — stays multi-mode
  assert.deepEqual(Object.keys(t.values).sort(), ['dark', 'light']);
});

// ── Regression: the figma-parser must recognize ALL collections the push side
// can create (opacity, breakpoint, container, blur, perspective, aspect, ease,
// animate, border-width, z-index). Before the fix it only covered 5 domains,
// so previously-pushed utility-scale variables surfaced as codeOnly on the
// next compare run — an infinite-push loop.
test('inferDomain recognizes every collection name that push can create', () => {
  const COLLECTIONS = [
    'color', 'spacing', 'radius', 'shadow', 'typography',
    'opacity', 'border-width', 'z-index', 'breakpoint', 'container',
    'blur', 'perspective', 'aspect', 'ease', 'animate',
  ];
  for (const name of COLLECTIONS) {
    const ds = parseFigmaDesignSystem({
      collections: [{
        id: 'c', name, modes: [{ id: 'm', name: 'default' }],
        variables: [{
          id: 'v', name: 'test/leaf', resolvedType: 'FLOAT', scopes: [],
          valuesByMode: { default: { kind: 'literal', value: 1 } },
        }],
      }],
      effectStyles: [], textStyles: [],
    });
    assert.equal(ds.tokens.length, 1, `${name}: token should be recognized`);
    assert.equal(ds.tokens[0].domain, name, `${name}: domain should match collection name`);
  }
});

