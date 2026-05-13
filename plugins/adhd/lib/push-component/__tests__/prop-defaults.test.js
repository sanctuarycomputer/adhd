'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultForProp, isNameLike } = require('../prop-defaults');

test('returns placeholder string for required string prop', () => {
  assert.equal(defaultForProp('label', { type: 'string', optional: false }), '"Sample text"');
});

test('returns "John Doe" for name-like string props', () => {
  assert.equal(defaultForProp('name', { type: 'string', optional: false }), '"John Doe"');
  assert.equal(defaultForProp('title', { type: 'string', optional: false }), '"John Doe"');
  assert.equal(defaultForProp('label', { type: 'string', optional: false }), '"Sample text"');
});

test('returns omit-marker for optional props (so they fall through to component defaults)', () => {
  assert.equal(defaultForProp('className', { type: 'string', optional: true }), null);
  assert.equal(defaultForProp('size', { type: 'union', values: ['xs'], optional: true }), null);
});

test('returns 0 for required number props', () => {
  assert.equal(defaultForProp('count', { type: 'number', optional: false }), '0');
});

test('returns false for required boolean props', () => {
  assert.equal(defaultForProp('disabled', { type: 'boolean', optional: false }), 'false');
});

test('returns "() => {}" for required function props', () => {
  assert.equal(defaultForProp('onClick', { type: 'function', optional: false }), '() => {}');
});

test('returns null for required ref props', () => {
  assert.equal(defaultForProp('inputRef', { type: 'ref', optional: false }), 'null');
});

test('returns "..." placeholder for required ReactNode children', () => {
  assert.equal(defaultForProp('children', { type: 'reactnode', optional: false }), '"..."');
});

test('returns [] for required array props', () => {
  assert.equal(defaultForProp('items', { type: 'array', optional: false }), '[]');
});

test('returns {} for required object props', () => {
  assert.equal(defaultForProp('config', { type: 'object', optional: false }), '{}');
});

test('returns {} for unresolvable types and includes a marker', () => {
  const result = defaultForProp('mystery', { type: 'unknown', optional: false, raw: 'SomeOtherType' });
  assert.equal(result, '{}');
});

test('isNameLike heuristic', () => {
  assert.equal(isNameLike('name'), true);
  assert.equal(isNameLike('title'), true);
  assert.equal(isNameLike('userName'), true);
  assert.equal(isNameLike('className'), false);
  assert.equal(isNameLike('label'), false);
});
