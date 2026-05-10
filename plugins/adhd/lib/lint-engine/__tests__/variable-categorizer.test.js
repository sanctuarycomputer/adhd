'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { categorizeVariables } = require('../variable-categorizer');

const figmaVars = {
  'Primitives/color/brand/600': '#5e3aee',
  'Primitives/space/2xl': '32px',
  'Semantic/color/surface/elevated': { Light: '#ffffff', Dark: '#1a1a1a' },
};

const localTheme = {
  primitives: {
    '--color-brand-600': '#5e3aee',
    // --space-2xl missing
  },
  exposure: {},
  light: {
    '--color-surface-elevated': '#f5f5f5',  // conflict
  },
  dark: {
    '--color-surface-elevated': '#1a1a1a',  // same
  },
};

test('flags missing variables', () => {
  const violations = categorizeVariables(figmaVars, localTheme);
  const missing = violations.filter(v => v.status === 'missing');
  assert.deepEqual(
    missing.map(v => v.token).sort(),
    ['space/2xl'],
  );
});

test('flags conflicts with both light and dark values', () => {
  const violations = categorizeVariables(figmaVars, localTheme);
  const conflicts = violations.filter(v => v.status === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].token, 'color/surface/elevated');
  assert.equal(conflicts[0].mode, 'light');
  assert.equal(conflicts[0].figma, '#ffffff');
  assert.equal(conflicts[0].local, '#f5f5f5');
});

test('does not emit violations for variables that match', () => {
  const violations = categorizeVariables(figmaVars, localTheme);
  const matches = violations.filter(v => v.token === 'color/brand/600');
  assert.equal(matches.length, 0);
});

test('treats hex case as semantically identical', () => {
  const violations = categorizeVariables(
    { 'Primitives/color/x': '#5E3AEE' },
    { primitives: { '--color-x': '#5e3aee' }, exposure: {}, light: {}, dark: {} },
  );
  assert.equal(violations.length, 0);
});

test('treats rem and px as semantically identical', () => {
  const violations = categorizeVariables(
    { 'Primitives/space/sm': '1rem' },
    { primitives: { '--space-sm': '16px' }, exposure: {}, light: {}, dark: {} },
  );
  assert.equal(violations.length, 0);
});

test('missing variables include a suggested-fix hint', () => {
  const violations = categorizeVariables(
    { 'Primitives/color/brand/accent': '#5e3aee' },
    { primitives: {}, exposure: {}, light: {}, dark: {} },
  );
  const m = violations.find(v => v.status === 'missing');
  assert.ok(m);
  assert.equal(m.hint, 'Run /adhd:pull-design-system to import this token.');
});
