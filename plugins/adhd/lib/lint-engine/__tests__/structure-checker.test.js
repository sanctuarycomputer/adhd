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

test('STRUCT001: does NOT flag a frame holding a single shape primitive (icon/logo container)', () => {
  // Common case: a Logo Component Set variant frame whose only child is a VECTOR.
  // Auto-layout manages flow between multiple children; a single shape fills its
  // container via constraints, no auto-layout needed.
  for (const childType of ['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'STAR', 'POLYGON', 'LINE']) {
    const node = makeFrame({
      layoutMode: 'NONE',
      children: [{ id: '1:2', name: 'logo-art', type: childType }],
    });
    const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
    assert.equal(
      violations.filter(v => v.rule === 'STRUCT001').length,
      0,
      `expected no STRUCT001 for single-child of type ${childType}`,
    );
  }
});

test('STRUCT001: does NOT flag a frame whose subtree is shape-only through nested containers', () => {
  // The user's real-world case: a Logo Component Set whose outer frame holds
  // "light" and "dark" sub-frames, each containing only vector paths. The whole
  // outer frame rasterizes to a single SVG — flexbox doesn't apply, even though
  // the immediate children are FRAMEs (not shapes) themselves.
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [
      {
        id: '1:2', name: 'light', type: 'FRAME', layoutMode: 'NONE',
        children: [
          { id: '1:3', name: 'path-1', type: 'VECTOR' },
          { id: '1:4', name: 'path-2', type: 'VECTOR' },
        ],
      },
      {
        id: '1:5', name: 'dark', type: 'COMPONENT', layoutMode: 'NONE',
        children: [
          { id: '1:6', name: 'path-1', type: 'VECTOR' },
          { id: '1:7', name: 'mask', type: 'BOOLEAN_OPERATION' },
        ],
      },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  // STRUCT001 must not fire on the OUTER frame (it's a shape-only composition).
  const outerStruct001 = violations.find(v => v.rule === 'STRUCT001' && v.nodeId === node.id);
  assert.equal(outerStruct001, undefined, 'outer frame should be exempt — entire subtree is shape-only');
});

test('STRUCT001: still flags a deeply-nested frame if a leaf is non-shape (TEXT)', () => {
  // One TEXT leaf anywhere in the subtree breaks the shape-only predicate.
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [
      {
        id: '1:2', name: 'badge', type: 'FRAME', layoutMode: 'NONE',
        children: [
          { id: '1:3', name: 'path', type: 'VECTOR' },
          { id: '1:4', name: 'label', type: 'TEXT' },
        ],
      },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT001'));
});

test('STRUCT001: does NOT flag a frame whose children are all shape primitives (multi-path SVG)', () => {
  // Real-world case: a Logo Component Set variant that's a composite of multiple
  // vector paths (e.g. a wordmark with separate paths per letter, or a mark with
  // multiple boolean-op layers). The whole frame rasterizes to a single SVG;
  // flexbox doesn't apply. Auto-layout would be incorrect here.
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [
      { id: '1:2', name: 'path-1', type: 'VECTOR' },
      { id: '1:3', name: 'path-2', type: 'VECTOR' },
      { id: '1:4', name: 'mask',   type: 'BOOLEAN_OPERATION' },
      { id: '1:5', name: 'dot',    type: 'ELLIPSE' },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT001').length, 0);
});

test('STRUCT001: still flags a frame with a single TEXT child (needs padding/alignment control)', () => {
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [{ id: '1:2', name: 'label', type: 'TEXT' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT001'));
});

test('STRUCT001: still flags a frame with a single FRAME child', () => {
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [{ id: '1:2', name: 'inner', type: 'FRAME' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT001'));
});

test('STRUCT001: still flags a frame with mixed shapes + non-shape children (needs auto-layout)', () => {
  // If even one child isn't a shape primitive, the exemption doesn't apply —
  // the non-shape needs auto-layout for padding/alignment.
  const node = makeFrame({
    layoutMode: 'NONE',
    children: [
      { id: '1:2', name: 'icon-path', type: 'VECTOR' },
      { id: '1:3', name: 'label',     type: 'TEXT' },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT001'));
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

test('STRUCT003: does NOT flag a fill with visible: false (invisible paints do not render)', () => {
  // Figma keeps invisible paint entries on a node when the user has hidden them
  // in the UI. Enforcing variable bindings on paints the viewer cannot see is busywork.
  const node = makeFrame({
    fills: [{ type: 'SOLID', visible: false, color: { r: 1, g: 0, b: 0 } }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT003').length, 0);
});

test('STRUCT003: does NOT flag a stroke with visible: false', () => {
  const node = makeFrame({
    strokes: [{ type: 'SOLID', visible: false, color: { r: 0, g: 0, b: 0 } }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT003').length, 0);
});

test('STRUCT003: still flags a visible stroke that lacks a bound variable', () => {
  const node = makeFrame({
    strokes: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 } }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT003'));
});

test('STRUCT003: does NOT fire on a COMPONENT_SET wrapper — wrappers do not render', () => {
  // Figma stuffs the dashed-purple "this is a component set" chrome into the
  // wrapper's strokes array as a real SOLID stroke. The chrome is editor-only;
  // CS wrappers do not render in instances. Lint rules that care about visible
  // output should not fire on them.
  const node = {
    id: '818:2610',
    name: 'Logo',
    type: 'COMPONENT_SET',
    strokes: [{
      type: 'SOLID', visible: true, opacity: 1,
      color: { r: 0.592, g: 0.278, b: 1 }, // Figma's #9747FF chrome
      boundVariables: {},
    }],
    fills: [
      { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 } }, // also a fill — should also skip
    ],
    children: [
      { id: '818:2612', name: 'Colour=dark', type: 'COMPONENT', children: [] },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT003').length, 0);
});

test('STRUCT002: does NOT fire on a COMPONENT_SET wrapper — wrappers do not render padding', () => {
  const node = {
    id: '818:2610',
    name: 'Logo',
    type: 'COMPONENT_SET',
    layoutMode: 'VERTICAL',
    paddingTop: 16, // raw, no variable
    fills: [],
    strokes: [],
    children: [
      { id: '818:2612', name: 'Colour=dark', type: 'COMPONENT', children: [] },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT002').length, 0);
});

test('STRUCT005: does NOT fire on a COMPONENT_SET wrapper — wrappers do not render effects', () => {
  const node = {
    id: '818:2610',
    name: 'Logo',
    type: 'COMPONENT_SET',
    effects: [
      { type: 'DROP_SHADOW', visible: true, color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8 },
    ],
    fills: [],
    strokes: [],
    children: [
      { id: '818:2612', name: 'Colour=dark', type: 'COMPONENT', children: [] },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT005').length, 0);
});

test('STRUCT003: still fires on a child COMPONENT inside a Component Set with a raw stroke', () => {
  // Sanity: the exemption is narrow — it only spares the WRAPPER. Real component
  // variants still get linted.
  const node = {
    id: '818:2610',
    name: 'Logo',
    type: 'COMPONENT_SET',
    fills: [],
    strokes: [],
    children: [
      {
        id: '818:2612',
        name: 'Colour=dark',
        type: 'COMPONENT',
        fills: [],
        strokes: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, boundVariables: {} }],
        children: [],
      },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT003'), 'STRUCT003 should still fire on a child COMPONENT inside a CS');
});

test('STRUCT008: flags auto-named layers like "Frame 47"', () => {
  const node = makeFrame({
    children: [{ id: '1:2', name: 'Frame 47', type: 'FRAME' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.ok(violations.find(v => v.rule === 'STRUCT008'));
});

test('STRUCT010: flags a Component Set with children that have empty variantProperties + diagnostic message', () => {
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
  const struct010 = violations.find(v => v.rule === 'STRUCT010');
  assert.ok(struct010);
  // Message names the count, suggests a property example, and calls out the
  // codegen consequence so the designer understands the fix is non-optional.
  assert.match(struct010.message, /2 variant\(s\) but no variant property/);
  assert.match(struct010.message, /Properties panel/);
  assert.match(struct010.message, /2 separate components/);
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

test('STRUCT009: flags non-kebab variant property names when convention is kebab-case', () => {
  const node = {
    id: '1:1',
    name: 'button',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      // PascalCase property name violates kebab-case
      Variant: { type: 'VARIANT', defaultValue: 'primary', variantOptions: ['primary', 'secondary'] },
    },
    children: [
      { id: '1:2', name: 'Variant=primary', type: 'COMPONENT', variantProperties: { Variant: 'primary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  const hits = violations.filter(v => v.rule === 'STRUCT009');
  assert.ok(hits.find(v => /property/i.test(v.message)), 'expected a STRUCT009 violation on the property name');
});

test('STRUCT009: does NOT flag variant property VALUES regardless of casing — values are string-literal type members, not identifiers', () => {
  const node = {
    id: '1:1',
    name: 'logo',
    type: 'COMPONENT_SET',
    componentPropertyDefinitions: {
      // Property name is kebab-friendly; values are lowercase but the rule should not enforce casing on values.
      colour: { type: 'VARIANT', defaultValue: 'light', variantOptions: ['light', 'dark', 'OnDark'] },
    },
    children: [
      { id: '1:2', name: 'colour=light', type: 'COMPONENT', variantProperties: { colour: 'light' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  const valueViolations = violations.filter(v => v.rule === 'STRUCT009' && /value/i.test(v.message));
  assert.equal(valueViolations.length, 0, 'STRUCT009 should not fire on variant values, even mixed-case ones like "OnDark"');
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

test('STRUCT005: does NOT flag effects with visible: false (parity with STRUCT003 paints)', () => {
  const node = makeFrame({
    effects: [
      { type: 'DROP_SHADOW', visible: false, color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8 },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT005').length, 0);
});

test('STRUCT006: flags a FRAME with wasInstance: true (warning, not error)', () => {
  const node = makeFrame({ wasInstance: true });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  const struct006 = violations.find(v => v.rule === 'STRUCT006');
  assert.ok(struct006, 'expected STRUCT006 violation');
  assert.equal(struct006.severity, 'warning');
});

test('STRUCT007: flags sibling components sharing a name prefix outside a Component Set with diagnostic message', () => {
  const node = makeFrame({
    type: 'FRAME',
    children: [
      { id: '1:2', name: 'Logo/light', type: 'COMPONENT' },
      { id: '1:3', name: 'Logo/dark', type: 'COMPONENT' },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  const struct007 = violations.find(v => v.rule === 'STRUCT007');
  assert.ok(struct007, 'expected STRUCT007 violation');
  assert.equal(struct007.severity, 'warning');
  // The message names the prefix, the specific siblings, and the codegen
  // consequence — so a designer reading the annotation in Figma understands
  // what to fix AND why it matters.
  assert.match(struct007.message, /"Logo\/"/);
  assert.match(struct007.message, /"light"/);
  assert.match(struct007.message, /"dark"/);
  assert.match(struct007.message, /look like variants/i);
  assert.match(struct007.message, /Combine as Variants/);
  assert.match(struct007.message, /code generation/i);
});

test('STRUCT007: truncates the suffix list to four with a "+N more" hint when there are many', () => {
  const node = makeFrame({
    type: 'FRAME',
    children: Array.from({ length: 7 }, (_, i) => ({
      id: `1:${10 + i}`, name: `Logo/v${i + 1}`, type: 'COMPONENT',
    })),
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  const struct007 = violations.find(v => v.rule === 'STRUCT007');
  assert.ok(struct007);
  // First four suffixes shown, then "+3 more"
  assert.match(struct007.message, /"v1", "v2", "v3", "v4", \+3 more/);
});

test('STRUCT007: does not flag a single child component (no siblings to group)', () => {
  const node = makeFrame({
    children: [{ id: '1:2', name: 'Button/primary', type: 'COMPONENT' }],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT007').length, 0);
});

test('STRUCT007: does not flag siblings inside a Component Set (parent is COMPONENT_SET)', () => {
  const node = {
    id: '1:1', name: 'Button', type: 'COMPONENT_SET',
    componentPropertyDefinitions: { variant: { type: 'VARIANT', defaultValue: 'primary', variantOptions: ['primary', 'secondary'] } },
    children: [
      { id: '1:2', name: 'Button/primary', type: 'COMPONENT', variantProperties: { variant: 'primary' } },
      { id: '1:3', name: 'Button/secondary', type: 'COMPONENT', variantProperties: { variant: 'secondary' } },
    ],
  };
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT007').length, 0);
});

test('STRUCT007: does not flag two components with different prefixes', () => {
  const node = makeFrame({
    children: [
      { id: '1:2', name: 'Button/primary', type: 'COMPONENT' },
      { id: '1:3', name: 'Avatar/circle', type: 'COMPONENT' },
    ],
  });
  const violations = checkStructure(node, { fileKey: FIGMA_FILE_KEY, namingConvention: 'kebab-case' });
  assert.equal(violations.filter(v => v.rule === 'STRUCT007').length, 0);
});
