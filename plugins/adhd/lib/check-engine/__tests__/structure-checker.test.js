'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkStructure } = require('../structure-checker');

const FIGMA_FILE_KEY = 'abc123';

function makeFrame(overrides = {}) {
  return {
    id: '1:1',
    name: 'Card',
    type: 'FRAME',
    layoutMode: 'VERTICAL',
    children: [],
    fills: [],
    ...overrides,
  };
}

test('STRUCT001: flags a frame with children but no auto-layout', () => {
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [{ id: '1:2', name: 'Child', type: 'FRAME' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT001'));
});

test('STRUCT001: does not flag a frame with no children even if layoutMode is NONE', () => {
  const node = makeFrame({ layoutMode: 'NONE', children: [] });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT001').length, 0);
});

test('STRUCT003: flags a fill with raw hex (no boundVariables)', () => {
  const node = makeFrame({
    fills: [{ type: 'SOLID', color: { r: 0.37, g: 0.23, b: 0.93 } }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT003'));
});

test('STRUCT003: does not flag a fill that has boundVariables.color', () => {
  const node = makeFrame({
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:1' } } }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT003').length, 0);
});

test('STRUCT008: flags auto-named layers like "Frame 47"', () => {
  const node = makeFrame({
    children: [{ id: '1:2', name: 'Frame 47', type: 'FRAME' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT008'));
});

test('STRUCT010: flags a Component Set with children that have empty variantProperties', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {},
    children: [
      { id: '1:2', name: 'Variant 1', type: 'COMPONENT', variantProperties: {} },
      { id: '1:3', name: 'Variant 2', type: 'COMPONENT', variantProperties: {} },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT010'));
});

test('STRUCT010: does not flag a Component Set with declared variant properties', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      variant: { type: 'VARIANT', defaultValue: 'primary', variantOptions: ['primary', 'secondary'] },
    },
    children: [
      { id: '1:2', name: 'Button/primary', type: 'COMPONENT', variantProperties: { variant: 'primary' } },
      { id: '1:3', name: 'Button/secondary', type: 'COMPONENT', variantProperties: { variant: 'secondary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT010').length, 0);
});

test('STRUCT009: flags PascalCase variant property values when convention is kebab-case', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      variant: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary', 'Secondary'] },
    },
    children: [
      { id: '1:2', name: 'Button/Primary', type: 'COMPONENT', variantProperties: { variant: 'Primary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT009'));
});

test('STRUCT009: passes when convention is set to false (disabled)', () => {
  const node = {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      variant: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary'] },
    },
    children: [
      { id: '1:2', name: 'Button/Primary', type: 'COMPONENT', variantProperties: { variant: 'Primary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: false });
  assert.equal(violations.filter(v => v.rule === 'STRUCT009').length, 0);
});

test('every violation has rule, severity, nodeId, nodePath, message, deepLink', () => {
  const node = makeFrame({ layoutMode: 'NONE', children: [{ id: '1:2', name: 'Frame 47', type: 'FRAME' }] });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  for (const v of violations) {
    assert.ok(v.rule, 'rule');
    assert.ok(v.severity === 'error' || v.severity === 'warning', 'severity');
    assert.ok(v.nodeId, 'nodeId');
    assert.ok(v.nodePath, 'nodePath');
    assert.ok(v.message, 'message');
    assert.match(v.deepLink, /figma\.com\/design\/abc123\?node-id=/);
  }
});

// --- Additional coverage tests (beyond plan's 9) ---

test('STRUCT002: flags a frame with raw paddingTop and no boundVariables.paddingTop', () => {
  const node = makeFrame({
    layoutMode: 'VERTICAL',
    paddingTop: 16,
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(
    violations.find(v => v.rule === 'STRUCT002'),
    'expected STRUCT002 to flag raw paddingTop',
  );
});

test('STRUCT002: passes when paddingTop is bound to a variable', () => {
  const node = makeFrame({
    layoutMode: 'VERTICAL',
    paddingTop: 16,
    boundVariables: { paddingTop: { id: 'VariableID:space-4' } },
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT002').length, 0);
});

test('STRUCT004: flags a TEXT node with raw style and no textStyleId / boundVariables', () => {
  const node = {
    id: '2:1',
    name: 'Heading',
    type: 'TEXT',
    style: { fontSize: 24, fontWeight: 700 },
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT004'));
});

test('STRUCT004: passes when TEXT has boundVariables.fontSize', () => {
  const node = {
    id: '2:1',
    name: 'Heading',
    type: 'TEXT',
    style: { fontSize: 24, fontWeight: 700 },
    boundVariables: { fontSize: { id: 'VariableID:font-size-l' } },
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT004').length, 0);
});

test('STRUCT005: flags a node with effects but no boundVariables and no effectStyleId', () => {
  const node = makeFrame({
    effects: [
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8 },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT005'));
});

test('STRUCT006: flags a FRAME with wasInstance: true (warning, not error)', () => {
  const node = makeFrame({ wasInstance: true });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  const struct006 = violations.find(v => v.rule === 'STRUCT006');
  assert.ok(struct006, 'expected STRUCT006 violation');
  assert.equal(struct006.severity, 'warning');
});
