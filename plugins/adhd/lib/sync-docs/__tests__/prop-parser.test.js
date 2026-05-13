'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseProps } = require('../prop-parser');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', '__fixtures__', 'avatar.tsx'),
  'utf8',
);

test('returns the component name', () => {
  const r = parseProps(SOURCE);
  assert.equal(r.componentName, 'Avatar');
});

test('captures string props', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.name, { type: 'string', optional: false });
  assert.deepEqual(r.props.src, { type: 'string', optional: true });
});

test('captures number and boolean props', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.count, { type: 'number', optional: true });
  assert.deepEqual(r.props.hidden, { type: 'boolean', optional: true });
});

test('captures named-union references with their values', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.size, {
    type: 'union', unionName: 'AvatarSize', values: ['xs', 'sm', 'md', 'lg', 'xl'], optional: true,
  });
  assert.deepEqual(r.props.shape, {
    type: 'union', unionName: 'AvatarShape', values: ['circle', 'square'], optional: true,
  });
});

test('captures inline literal unions', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.status, {
    type: 'union', values: ['online', 'away', 'offline'], optional: true,
  });
});

test('marks function props as `function` (toggle-skipped)', () => {
  const r = parseProps(SOURCE);
  assert.equal(r.props.onClick.type, 'function');
});

test('marks ReactNode props as `reactnode` (toggle-skipped)', () => {
  const r = parseProps(SOURCE);
  assert.equal(r.props.children.type, 'reactnode');
});

test('returns componentName=null when no exported function found', () => {
  const r = parseProps('export const x = 42;');
  assert.equal(r.componentName, null);
  assert.deepEqual(r.props, {});
});
