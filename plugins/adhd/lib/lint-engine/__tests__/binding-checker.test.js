'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBindings, inferDomain, PROPERTY_TO_DOMAIN } = require('../binding-checker');

const OPTS = (extra) => ({ fileKey: 'abc', varIdMap: {}, badSuggestionsByName: {}, ...extra });

test('inferDomain: collection-as-domain', () => {
  assert.equal(inferDomain('Color/brand'), 'color');
  assert.equal(inferDomain('Spacing/4'), 'spacing');
  assert.equal(inferDomain('Radius/sm'), 'radius');
  assert.equal(inferDomain('Tracking/normal'), 'tracking');
  assert.equal(inferDomain('Leading/relaxed'), 'leading');
});

test('inferDomain: synonym collection', () => {
  // "Colors" → "Color" (synonym), so inferred domain is color
  assert.equal(inferDomain('Colors/brand'), 'color');
  assert.equal(inferDomain('Space/4'), 'spacing');
});

test('inferDomain: tier collection looks inside', () => {
  assert.equal(inferDomain('Primitives/color/brand'), 'color');
  assert.equal(inferDomain('Semantic/spacing/md'), 'spacing');
});

test('inferDomain: returns null for ambiguous/unmapped', () => {
  // ambiguous (path says leading, leaf says tracking)
  assert.equal(inferDomain('Type + Effects/Line-Height/Letter Space 0'), null);
  // no-mapping (no domain signal anywhere)
  assert.equal(inferDomain('Foo/bar/baz'), null);
});

test('checkBindings: no violations when varIdMap is empty', () => {
  const root = {
    id: '1:1', name: 'A', type: 'FRAME',
    boundVariables: { letterSpacing: { id: 'VAR:1', type: 'VARIABLE_ALIAS' } },
  };
  const result = checkBindings(root, OPTS());
  assert.deepEqual(result, []);
});

test('STRUCT012: spacing variable bound to letterSpacing fires per-layer', () => {
  const root = {
    id: '1:1', name: 'Card', type: 'TEXT',
    boundVariables: { letterSpacing: { id: 'VAR:spacing4', type: 'VARIABLE_ALIAS' } },
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:spacing4': 'Spacing/4' },
  }));
  assert.equal(result.length, 1);
  const v = result[0];
  assert.equal(v.rule, 'STRUCT012');
  assert.equal(v.severity, 'error');
  assert.equal(v.nodeId, '1:1');
  assert.equal(v.nodePath, 'Card');
  assert.match(v.message, /Spacing\/4/);
  assert.match(v.message, /a spacing variable/);
  assert.match(v.message, /letterSpacing/);
  assert.match(v.message, /expects a tracking variable/);
});

test('STRUCT012: same-domain binding is not flagged', () => {
  const root = {
    id: '1:1', name: 'Card', type: 'TEXT',
    boundVariables: { letterSpacing: { id: 'VAR:trackingNormal' } },
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:trackingNormal': 'Tracking/normal' },
  }));
  assert.deepEqual(result, []);
});

test('STRUCT012: padding bindings flagged when wrong domain', () => {
  const root = {
    id: '1:1', name: 'Card', type: 'FRAME',
    boundVariables: { paddingTop: { id: 'VAR:radiusSm' } },
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:radiusSm': 'Radius/sm' },
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].rule, 'STRUCT012');
  assert.match(result[0].message, /Radius\/sm/);
  assert.match(result[0].message, /spacing/);
});

test('STRUCT012: corner radius bindings flagged when wrong domain', () => {
  const root = {
    id: '1:1', name: 'Card', type: 'FRAME',
    boundVariables: { topLeftRadius: { id: 'VAR:colorBrand' } },
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:colorBrand': 'Color/brand' },
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].rule, 'STRUCT012');
  assert.match(result[0].message, /color/);
  assert.match(result[0].message, /radius/);
});

test('STRUCT012: fill color binding crossed with non-color variable', () => {
  const root = {
    id: '1:1', name: 'Card', type: 'FRAME',
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VAR:spacingMd' } } }],
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:spacingMd': 'Spacing/md' },
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].rule, 'STRUCT012');
  assert.match(result[0].message, /Spacing\/md/);
});

test('STRUCT012: ambiguous variable name (Line-Height path + Letter Space leaf) does NOT fire — not enough confidence', () => {
  const root = {
    id: '1:1', name: 'Title', type: 'TEXT',
    boundVariables: { letterSpacing: { id: 'VAR:ambig' } },
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:ambig': 'Type + Effects/Line-Height/Letter Space 0' },
  }));
  // inferDomain returns null for ambiguous → no STRUCT012
  assert.deepEqual(result, []);
});

test('STRUCT011 per-layer: emits one violation per layer that uses a bad variable', () => {
  // Two layers both bind the same bad-named variable. We want both to be
  // annotated, not just one aggregate emission.
  const root = {
    id: '1:1', name: 'Page', type: 'FRAME',
    children: [
      { id: '1:2', name: 'A', type: 'TEXT',
        boundVariables: { letterSpacing: { id: 'VAR:bad' } } },
      { id: '1:3', name: 'B', type: 'TEXT',
        boundVariables: { letterSpacing: { id: 'VAR:bad' } } },
    ],
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:bad': 'Tracking/BadName' },
    badSuggestionsByName: {
      'Tracking/BadName': { name: 'Tracking/BadName', kind: 'rename', target: 'Tracking/bad-name' },
    },
  }));
  const struct011 = result.filter(v => v.rule === 'STRUCT011');
  assert.equal(struct011.length, 2);
  const ids = struct011.map(v => v.nodeId).sort();
  assert.deepEqual(ids, ['1:2', '1:3']);
  assert.match(struct011[0].message, /Move to "Tracking" collection/);
  assert.match(struct011[0].message, /final name "Tracking\/bad-name"/);
});

test('STRUCT011 per-layer: dedupes per (rule, varName) within a single layer', () => {
  // A layer that binds the same bad variable to BOTH fills.color and
  // strokes.color should get ONE STRUCT011 violation, not two.
  const root = {
    id: '1:1', name: 'A', type: 'FRAME',
    fills:   [{ type: 'SOLID', boundVariables: { color: { id: 'VAR:bad' } } }],
    strokes: [{ type: 'SOLID', boundVariables: { color: { id: 'VAR:bad' } } }],
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:bad': 'Color/BrandGold' },
    badSuggestionsByName: {
      'Color/BrandGold': { name: 'Color/BrandGold', kind: 'rename', target: 'Color/brand-gold' },
    },
  }));
  const struct011 = result.filter(v => v.rule === 'STRUCT011');
  assert.equal(struct011.length, 1);
});

test('STRUCT011 per-layer: emits ambiguous suggestion correctly', () => {
  const root = {
    id: '1:1', name: 'Title', type: 'TEXT',
    boundVariables: { fontSize: { id: 'VAR:ambig' } },
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:ambig': 'Type/Letter Space 0' },
    badSuggestionsByName: {
      'Type/Letter Space 0': {
        name: 'Type/Letter Space 0', kind: 'ambiguous',
        target: 'Text/letter-space-0', alternate: 'Tracking/0',
        primaryReason: 'collection suggests text', alternateReason: 'leaf suggests tracking',
      },
    },
  }));
  const struct011 = result.find(v => v.rule === 'STRUCT011');
  assert.ok(struct011);
  assert.match(struct011.message, /Ambiguous target/);
  assert.match(struct011.message, /primary → Text\/letter-space-0/);
  assert.match(struct011.message, /alternate → Tracking\/0/);
});

test('STRUCT011 + STRUCT012 can both fire for the same (node, binding)', () => {
  // A spacing-domain variable with a BAD name, bound to letterSpacing:
  //  - STRUCT011 wants to rename the variable
  //  - STRUCT012 wants to change the binding to a tracking variable
  // Both fire because they describe different fixes.
  const root = {
    id: '1:1', name: 'X', type: 'TEXT',
    boundVariables: { letterSpacing: { id: 'VAR:bad' } },
  };
  const result = checkBindings(root, OPTS({
    varIdMap: { 'VAR:bad': 'Spacing/BadName' },
    badSuggestionsByName: {
      'Spacing/BadName': { name: 'Spacing/BadName', kind: 'rename', target: 'Spacing/bad-name' },
    },
  }));
  const rules = result.map(v => v.rule).sort();
  assert.deepEqual(rules, ['STRUCT011', 'STRUCT012']);
});

test('PROPERTY_TO_DOMAIN: covers the expected property set', () => {
  // Sanity check — if someone removes a property mapping by accident the
  // STRUCT012 check silently goes quiet for that property. Lock the
  // mapping down with a test.
  assert.equal(PROPERTY_TO_DOMAIN.letterSpacing, 'tracking');
  assert.equal(PROPERTY_TO_DOMAIN.lineHeight,    'leading');
  assert.equal(PROPERTY_TO_DOMAIN.fontSize,      'text');
  assert.equal(PROPERTY_TO_DOMAIN.paddingTop,    'spacing');
  assert.equal(PROPERTY_TO_DOMAIN.itemSpacing,   'spacing');
  assert.equal(PROPERTY_TO_DOMAIN.cornerRadius,  'radius');
});
