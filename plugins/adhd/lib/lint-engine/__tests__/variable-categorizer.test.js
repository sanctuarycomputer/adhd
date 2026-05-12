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
  assert.equal(m.hint, 'Run /adhd:pull-tokens to import this token.');
});

test('does NOT flag a conflict when both sides are aliases (semantic→primitive)', () => {
  // Figma side: `Semantic/foreground` is an alias to another variable (light + dark modes).
  // Local side: `--foreground` is a CSS alias `var(--zinc-900)`. Both sides agree this
  // is an alias relationship; primitive-level checks elsewhere verify the underlying
  // target consistency. A surface-string comparison would always flag this as a conflict
  // because the alias shapes differ (CSS var() string vs Figma VARIABLE_ALIAS object).
  const figmaVars = {
    'Semantic/foreground': {
      Light: { type: 'VARIABLE_ALIAS', id: 'VariableID:7:9' },
      Dark: { type: 'VARIABLE_ALIAS', id: 'VariableID:7:10' },
    },
  };
  const localTheme = {
    primitives: {},
    exposure: {},
    light: { '--foreground': 'var(--zinc-900)' },
    dark: { '--foreground': 'var(--zinc-50)' },
  };
  const violations = categorizeVariables(figmaVars, localTheme);
  const conflicts = violations.filter(v => v.status === 'conflict');
  assert.equal(conflicts.length, 0, 'aliases on both sides should not produce a conflict');
});

test('still flags a real conflict when one side aliases and the other is a literal that does not match', () => {
  // Mixed alias-vs-literal case: code points at a CSS alias; figma is a literal.
  // We can't cheaply resolve the alias chain here, so leave this as a conflict —
  // accurate when the literal differs from any plausible resolution, false-positive
  // when the resolved alias would have matched. The both-sides-aliased fast path
  // above is the common case we care about; mixed-mode resolution is a future
  // enhancement once the SKILL emits resolved figma values alongside the raw map.
  const figmaVars = {
    'Semantic/foreground': { Light: '#171717', Dark: '#ededed' },
  };
  const localTheme = {
    primitives: {},
    exposure: {},
    light: { '--foreground': 'var(--zinc-900)' },
    dark: { '--foreground': 'var(--zinc-50)' },
  };
  const violations = categorizeVariables(figmaVars, localTheme);
  const conflicts = violations.filter(v => v.status === 'conflict');
  assert.ok(conflicts.length > 0, 'mixed alias-vs-literal still flags (no resolution yet)');
});
