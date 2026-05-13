'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveWriteTarget, findDefinitionLayers, isAlias, aliasTarget } = require('../resolve-write-target');

const theme = (parts) => ({
  primitives: parts.primitives || {},
  exposure:   parts.exposure   || {},
  light:      parts.light      || {},
  dark:       parts.dark       || {},
});

test('isAlias / aliasTarget recognize var() syntax', () => {
  assert.equal(isAlias('var(--primary)'), true);
  assert.equal(isAlias('var(--primary, #000)'), true);
  assert.equal(isAlias('  var(--primary)  '), true);
  assert.equal(isAlias('#0a0a0a'), false);
  assert.equal(isAlias('0.25rem'), false);
  assert.equal(aliasTarget('var(--primary)'), '--primary');
  assert.equal(aliasTarget('var(--gold-500, #fallback)'), '--gold-500');
  assert.equal(aliasTarget('#abc'), null);
});

test('findDefinitionLayers returns every layer that defines the cssVar, in cascade order', () => {
  const t = theme({
    primitives: { '--gold': '#c5a572' },
    exposure:   { '--gold': 'var(--gold)' },        // unusual but possible
    light:      { '--gold': '#c5a572' },
    dark:       { '--gold': '#8b6f3e' },
  });
  const out = findDefinitionLayers('--gold', t);
  assert.deepEqual(out.map(l => l.layer), ['primitive', 'exposure', 'light', 'dark']);
});

// ─── STRUCT015 case: variable missing from code entirely ─────────────

test('missing-everywhere: writes as new @theme primitive', () => {
  const t = theme({});
  const actions = resolveWriteTarget('--color-gold', '#c5a572', t);
  assert.deepEqual(actions, [
    { kind: 'set-primitive', cssVar: '--color-gold', value: '#c5a572' },
  ]);
});

// ─── Simple primitive cases ─────────────────────────────────────────

test('primitive literal: writes directly to @theme primitives', () => {
  const t = theme({ primitives: { '--color-gold': '#aaaaaa' } });
  const actions = resolveWriteTarget('--color-gold', '#c5a572', t);
  assert.deepEqual(actions, [
    { kind: 'set-primitive', cssVar: '--color-gold', value: '#c5a572' },
  ]);
});

// ─── Shadcn-style alias chain: --color-primary exposes --primary ────

test('alias chain (exposure → light literal): writes to :root light', () => {
  // The user\'s shadcn case. --color-primary lives only in @theme inline
  // as `var(--primary)`. --primary is defined in :root (light). The
  // write target must be --primary at :root, NOT --color-primary at
  // @theme — overwriting the exposure entry would replace the alias
  // with a literal and break dark-mode propagation.
  const t = theme({
    exposure: { '--color-primary': 'var(--primary)' },
    light:    { '--primary': '#0a0a0a' },
  });
  const actions = resolveWriteTarget('--color-primary', '#1a1a1a', t);
  assert.deepEqual(actions, [
    { kind: 'set-semantic', cssVar: '--primary', mode: 'light', value: '#1a1a1a' },
  ]);
});

test('alias chain (exposure → light + dark literals): defaults to writing light only (conservative)', () => {
  // Figma reports a single mode value; we don\'t know what dark should
  // be. Writing to both would silently flatten the designer\'s dark
  // intent. Conservative default = light only; opts.bothModes overrides.
  const t = theme({
    exposure: { '--color-primary': 'var(--primary)' },
    light:    { '--primary': '#0a0a0a' },
    dark:     { '--primary': '#ededed' },
  });
  const actions = resolveWriteTarget('--color-primary', '#1a1a1a', t);
  assert.deepEqual(actions, [
    { kind: 'set-semantic', cssVar: '--primary', mode: 'light', value: '#1a1a1a' },
  ]);
});

test('alias chain (exposure → light + dark literals) with bothModes: writes both light and dark', () => {
  const t = theme({
    exposure: { '--color-primary': 'var(--primary)' },
    light:    { '--primary': '#0a0a0a' },
    dark:     { '--primary': '#ededed' },
  });
  const actions = resolveWriteTarget('--color-primary', '#1a1a1a', t, { bothModes: true });
  assert.deepEqual(actions, [
    { kind: 'set-semantic', cssVar: '--primary', mode: 'light', value: '#1a1a1a' },
    { kind: 'set-semantic', cssVar: '--primary', mode: 'dark', value: '#1a1a1a' },
  ]);
});

test('alias chain (exposure → dark only): writes to :root dark', () => {
  // Asymmetric case: variable only defined for dark mode. Write goes there.
  const t = theme({
    exposure: { '--color-overlay': 'var(--overlay)' },
    dark:     { '--overlay': 'rgba(0,0,0,0.5)' },
  });
  const actions = resolveWriteTarget('--color-overlay', 'rgba(0,0,0,0.75)', t);
  assert.deepEqual(actions, [
    { kind: 'set-semantic', cssVar: '--overlay', mode: 'dark', value: 'rgba(0,0,0,0.75)' },
  ]);
});

// ─── Multi-hop alias chains ─────────────────────────────────────────

test('two-hop chain: --color-x → --x → --y (literal in primitives) writes to --y in @theme', () => {
  const t = theme({
    primitives: { '--y': '#abc' },
    exposure:   { '--color-x': 'var(--x)' },
    light:      { '--x': 'var(--y)' },
  });
  const actions = resolveWriteTarget('--color-x', '#def', t);
  // --x is an alias in :root light; it forwards to --y. --y is a literal
  // primitive. Write lands at --y in @theme.
  assert.deepEqual(actions, [
    { kind: 'set-primitive', cssVar: '--y', value: '#def' },
  ]);
});

test('three-hop chain bottoms out cleanly', () => {
  const t = theme({
    primitives: { '--root-value': '#000' },
    exposure:   { '--surface-on-canvas': 'var(--surface-default)' },
    light:      { '--surface-default': 'var(--root-value)' },
  });
  const actions = resolveWriteTarget('--surface-on-canvas', '#111', t);
  assert.deepEqual(actions, [
    { kind: 'set-primitive', cssVar: '--root-value', value: '#111' },
  ]);
});

// ─── Defensive guards: cycles, runaways, broken refs ────────────────

test('alias cycle: stops gracefully, falls back to primitive write', () => {
  const t = theme({
    light: { '--a': 'var(--b)', '--b': 'var(--a)' },
  });
  const actions = resolveWriteTarget('--a', '#fff', t);
  // No literal terminal; cycle detection lands back at writing as primitive.
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'set-primitive');
});

test('alias to undefined variable: falls back to primitive write at the dangling cssVar', () => {
  const t = theme({
    exposure: { '--color-primary': 'var(--primary)' },
    // --primary is undefined anywhere
  });
  const actions = resolveWriteTarget('--color-primary', '#fff', t);
  // Chain resolves to --primary which isn\'t defined → STRUCT015 path
  // (write as new primitive at the dangling target).
  assert.deepEqual(actions, [
    { kind: 'set-primitive', cssVar: '--primary', value: '#fff' },
  ]);
});

test('depth-bounded: pathological 20-hop chain doesn\'t loop forever', () => {
  const t = theme({
    light: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`--v${i}`, `var(--v${i + 1})`]),
    ),
  });
  // No terminal — bottoms out at depth limit, falls back to primitive write
  // at SOME var in the chain. Just confirm we don\'t hang.
  const actions = resolveWriteTarget('--v0', '#fff', t);
  assert.ok(actions.length > 0);
  assert.equal(actions[0].kind, 'set-primitive');
});

// ─── Idempotent behavior ────────────────────────────────────────────

test('writing the same value again still resolves to the same write target', () => {
  const t = theme({
    exposure: { '--color-primary': 'var(--primary)' },
    light:    { '--primary': '#0a0a0a' },
  });
  const a = resolveWriteTarget('--color-primary', '#1a1a1a', t);
  const b = resolveWriteTarget('--color-primary', '#1a1a1a', t);
  assert.deepEqual(a, b);
});

// ─── End-to-end: resolveWriteTarget actions → applyToCss → categorizer clean

test('end-to-end: shadcn alias chain — action applies to :root, categorizer sees the new value, no remaining conflict', () => {
  // The full round-trip for the user\'s reported bug. globals.css has
  // the shadcn semantic-via-exposure pattern. Figma reports a different
  // primary color. resolveWriteTarget figures out where to write, then
  // applyToCss does the actual CSS edit, then the categorizer re-runs
  // and sees no conflict.
  const { applyToCss } = require('../../design-system/code-writer');
  const { categorizeVariables } = require('../../lint-engine/variable-categorizer');
  const { parseTheme } = require('../../lint-engine/theme-parser');
  const cssBefore = `
    :root { --primary: #0a0a0a; }
    @theme inline { --color-primary: var(--primary); }
  `;
  // Figma wants this primary to be a different color.
  const figmaRgb = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
  const figmaHex = '#1a1a1a';

  // 1. Confirm the categorizer currently surfaces a conflict.
  const themeBefore = parseTheme(cssBefore);
  const before = categorizeVariables({ 'color/primary': figmaRgb }, themeBefore);
  assert.equal(before.length, 1, 'should surface a conflict before write');
  assert.equal(before[0].status, 'conflict');

  // 2. Resolve the write target and apply it.
  const actions = resolveWriteTarget('--color-primary', figmaHex, themeBefore);
  assert.deepEqual(actions, [
    { kind: 'set-semantic', cssVar: '--primary', mode: 'light', value: figmaHex },
  ]);
  const cssAfter = applyToCss(cssBefore, actions);

  // 3. The :root --primary value is now what Figma wanted.
  assert.match(cssAfter, /:root\s*\{[^}]*--primary:\s*#1a1a1a/);
  // The exposure layer is untouched (still aliasing --primary).
  assert.match(cssAfter, /@theme inline\s*\{[^}]*--color-primary:\s*var\(--primary\)/);

  // 4. Re-categorize against the updated theme — conflict is gone.
  const themeAfter = parseTheme(cssAfter);
  const after = categorizeVariables({ 'color/primary': figmaRgb }, themeAfter);
  assert.equal(after.length, 0, 'conflict should clear after the alias-aware write');
});

test('end-to-end: STRUCT015 missing variable — applyToCss adds to @theme, then no conflict', () => {
  const { applyToCss } = require('../../design-system/code-writer');
  const { categorizeVariables } = require('../../lint-engine/variable-categorizer');
  const { parseTheme } = require('../../lint-engine/theme-parser');
  const cssBefore = `@theme { --existing: #fff; }\n:root {}\n`;
  // Pick a value whose RGB form rounds cleanly: 199/192/153 → #c7c099.
  const figmaRgb = { r: 199 / 255, g: 192 / 255, b: 153 / 255, a: 1 };
  const hex = '#c7c099';

  // 1. Before: variable is missing.
  const themeBefore = parseTheme(cssBefore);
  const before = categorizeVariables({ 'color/gold': figmaRgb }, themeBefore);
  assert.equal(before.length, 1);
  assert.equal(before[0].status, 'missing');

  // 2. Resolve write target — variable not defined anywhere → primitive.
  const actions = resolveWriteTarget('--color-gold', hex, themeBefore);
  assert.deepEqual(actions, [
    { kind: 'set-primitive', cssVar: '--color-gold', value: hex },
  ]);
  const cssAfter = applyToCss(cssBefore, actions);
  assert.match(cssAfter, new RegExp(`@theme\\s*\\{[^}]*--color-gold:\\s*${hex}`));

  // 3. Re-categorize: clean.
  const themeAfter = parseTheme(cssAfter);
  const after = categorizeVariables({ 'color/gold': figmaRgb }, themeAfter);
  assert.equal(after.length, 0);
});
