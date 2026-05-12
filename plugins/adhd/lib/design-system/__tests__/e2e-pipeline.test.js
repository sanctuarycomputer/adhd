'use strict';
// End-to-end tests that drive the full design-system pipeline against
// realistic Figma-state fixtures. Each fixture lives in __fixtures__/ and
// represents a different sync scenario (clean / empty / partial / value
// conflict / mode conflict / figma-only extras). The tests assert on the
// shape of the comparator diff and the actions buildFigmaActions emits.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseCodeDesignSystem } = require('../code-parser');
const { parseFigmaDesignSystem } = require('../figma-parser');
const { compareDesignSystems } = require('../comparator');
const { buildFigmaActions } = require('../figma-write-actions');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const GLOBALS = path.join(ROOT, 'example', 'app', 'globals.css');
const FIXTURES = path.join(__dirname, '..', '__fixtures__');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function pipeline(figmaFixtureName, { resolutions = [], direction = 'push' } = {}) {
  const css = fs.readFileSync(GLOBALS, 'utf8');
  const codeDS = parseCodeDesignSystem(css, { includeTailwindDefaults: true });
  const figmaDS = parseFigmaDesignSystem(loadFixture(figmaFixtureName));
  const diff = compareDesignSystems(codeDS, figmaDS);
  const actions = buildFigmaActions(diff, resolutions, direction);
  return { codeDS, figmaDS, diff, actions };
}

function countKind(actions, kind) {
  return actions.filter(a => a.kind === kind).length;
}

test('e2e: clean sync — diff has no codeOnly/conflict/figmaOnly variables', () => {
  const { diff } = pipeline('figma-full-tailwind.json');
  assert.equal(diff.conflict.length, 0, 'expected zero conflicts');
  assert.equal(diff.figmaOnly.length, 0, 'expected zero figmaOnly');
  // Shadows are emitted as effect styles, not variables, so they always look
  // "codeOnly" on the variable side. Confirm every codeOnly is a shadow.
  for (const t of diff.codeOnly) {
    assert.equal(t.domain, 'shadow', `unexpected non-shadow codeOnly: ${t.domain}:${t.path}`);
  }
  assert.equal(diff.styles.effects.same.length > 0, true, 'expected effect styles to match');
  assert.equal(diff.styles.effects.codeOnly.length, 0, 'effect-style codeOnly should be empty');
});

test('e2e: push against synced figma produces zero create-variable actions', () => {
  const { actions } = pipeline('figma-full-tailwind.json', { direction: 'push' });
  assert.equal(countKind(actions, 'create-variable'), 0);
  assert.equal(countKind(actions, 'update-variable'), 0);
  // Effect-style names already exist on the figma side → no create-effect-style.
  assert.equal(countKind(actions, 'create-effect-style'), 0);
});

test('e2e: empty figma — push produces create-variable actions ONLY for user-authored tokens', () => {
  // After the Tailwind-defaults floor fix: codeOnly no longer surfaces
  // tokens that came from `tailwind-defaults.css` or the synthetic utility
  // scale. The user's example/globals.css authors ~18 tokens of its own
  // (custom colors, the chart palette, --radius and friends, sidebar
  // semantics, font families); those are what push should create. Earlier
  // behavior — flooding 400+ create-variable actions into Figma to bake
  // in the full Tailwind palette — was a comparator bug, not a feature.
  const { diff, actions } = pipeline('figma-empty.json', { direction: 'push' });
  assert.equal(diff.same.length, 0);
  assert.equal(diff.conflict.length, 0);
  assert.equal(diff.figmaOnly.length, 0);
  assert.ok(diff.codeOnly.length > 0 && diff.codeOnly.length < 100,
    `expected a focused set of user-authored codeOnly tokens, got ${diff.codeOnly.length}`);
  // Every codeOnly entry must be user-authored — no Tailwind-default
  // tokens leak through the filter.
  for (const t of diff.codeOnly) {
    assert.notEqual(t.fromTailwindDefault, true,
      `Tailwind-default token leaked into codeOnly: ${t.domain}:${t.path}`);
  }
  const nonShadowCodeOnly = diff.codeOnly.filter(t => t.domain !== 'shadow').length;
  assert.equal(countKind(actions, 'create-variable'), nonShadowCodeOnly,
    'create-variable count should equal non-shadow codeOnly count');
  // example/globals.css doesn't author its own shadow tokens — it inherits
  // them from Tailwind, which the floor filter excludes from codeOnly. A
  // project that DID author custom shadows would see create-effect-style
  // actions; users who want the full Tailwind shadow palette in Figma can
  // re-declare them explicitly in `@theme {}`.
  assert.equal(countKind(actions, 'create-effect-style'), 0);
});

test('e2e: empty figma — pull is a no-op (nothing in figma to pull)', () => {
  const { actions } = pipeline('figma-empty.json', { direction: 'pull' });
  assert.equal(actions.length, 0);
});

test('e2e: missing-half figma — push fills in gaps (codeOnly > 0, no conflicts)', () => {
  const { diff, actions } = pipeline('figma-missing-half.json', { direction: 'push' });
  assert.ok(diff.codeOnly.length > 0, 'expected codeOnly > 0');
  assert.equal(diff.conflict.length, 0);
  const creates = countKind(actions, 'create-variable');
  assert.ok(creates > 0, 'expected create-variable actions');
  // Every create-variable should be a color (that's what we trimmed in the fixture).
  for (const a of actions.filter(a => a.kind === 'create-variable')) {
    assert.equal(a.collection, 'color', `unexpected non-color create: ${a.path}`);
  }
});

test('e2e: value conflict — diff.conflict includes changed vars; push with no resolutions = zero update actions', () => {
  const { diff, actions } = pipeline('figma-value-conflict.json', { direction: 'push' });
  // Each conflict produces 2 mode entries (light + dark) since color is multi-mode.
  // We changed gold/100 and gold/500 → expect 4 conflict entries collapsed into 2 (default mode).
  // Actually: code says `--color-gold-100: #faf0c5` (default), figma stores in light+dark.
  // figma-parser collapses identical light/dark to default → so conflict appears as `default` mode.
  assert.ok(diff.conflict.length >= 2, `expected at least 2 conflicts, got ${diff.conflict.length}`);
  const paths = new Set(diff.conflict.map(c => c.path));
  assert.ok(paths.has('gold/100'), 'gold/100 should be in conflicts');
  assert.ok(paths.has('gold/500'), 'gold/500 should be in conflicts');
  // With no resolutions, no conflicts get pushed.
  assert.equal(countKind(actions, 'update-variable'), 0);
});

test('e2e: value conflict — push with code-winner produces update-variable actions', () => {
  const { diff } = pipeline('figma-value-conflict.json');
  const resolutions = diff.conflict.map(c => ({ path: c.path, mode: c.mode, winner: 'code' }));
  const { actions } = pipeline('figma-value-conflict.json', { direction: 'push', resolutions });
  assert.equal(countKind(actions, 'update-variable'), diff.conflict.length);
  // Each update-variable carries the code-side value.
  for (const a of actions.filter(a => a.kind === 'update-variable')) {
    assert.equal(a.newValue.type, 'literal');
    assert.ok(/^#[0-9a-f]+$/i.test(a.newValue.value), `expected hex value, got ${a.newValue.value}`);
  }
});

test('e2e: value conflict — push with figma-winner produces zero update-variable actions', () => {
  const { diff } = pipeline('figma-value-conflict.json');
  const resolutions = diff.conflict.map(c => ({ path: c.path, mode: c.mode, winner: 'figma' }));
  const { actions } = pipeline('figma-value-conflict.json', { direction: 'push', resolutions });
  assert.equal(countKind(actions, 'update-variable'), 0);
});

test('e2e: mode conflict — diff.conflict includes one mode entry, not two', () => {
  const { diff } = pipeline('figma-mode-conflict.json');
  // We only changed brand/surface's dark mode. The light mode still matches.
  const brandConflicts = diff.conflict.filter(c => c.path === 'brand/surface');
  assert.equal(brandConflicts.length, 1, `expected 1 brand/surface conflict, got ${brandConflicts.length}`);
  assert.equal(brandConflicts[0].mode, 'dark');
});

test('e2e: extra tokens — diff.figmaOnly has them; push leaves them alone (additive policy)', () => {
  const { diff, actions } = pipeline('figma-extra-tokens.json', { direction: 'push' });
  assert.equal(diff.figmaOnly.length, 2);
  const figmaOnlyPaths = new Set(diff.figmaOnly.map(t => t.path));
  assert.ok(figmaOnlyPaths.has('figma-only/marker'));
  assert.ok(figmaOnlyPaths.has('figma-only/sentinel'));
  // Push must NOT emit any action that touches a figma-only path.
  for (const a of actions) {
    if (a.path) assert.ok(!figmaOnlyPaths.has(a.path), `push touched figma-only path: ${a.path}`);
  }
});

test('e2e: extra tokens — pull writes them to code (set-primitive/set-semantic actions present)', () => {
  const { actions } = pipeline('figma-extra-tokens.json', { direction: 'pull' });
  assert.ok(actions.length > 0, 'expected pull actions for figma-only tokens');
  const setActions = actions.filter(a => a.kind === 'set-primitive' || a.kind === 'set-semantic');
  // Each of the two extras has light+dark modes → 4 set actions total (collapsed to default if equal).
  // figma-only/sentinel has identical light+dark → collapses to default (1 action).
  // figma-only/marker has different light+dark → stays 2-moded (2 actions).
  // Expected: 1 set-primitive (sentinel default) + 2 set-semantic (marker light/dark) = 3
  assert.equal(setActions.length, 3, `unexpected pull action count: ${setActions.length}`);
  const cssVars = setActions.map(a => a.cssVar);
  // figma-only/marker → --color-figma-only-marker (domain=color, leading "figma-only" doesn't match the
  // semantic-color regex, so the standard "--color-" prefix is applied).
  assert.ok(cssVars.includes('--color-figma-only-marker'), `cssVars: ${cssVars.join(', ')}`);
  assert.ok(cssVars.includes('--color-figma-only-sentinel'));
});

test('e2e: pull alias targets resolve to valid CSS vars with proper domain prefixes', () => {
  // Use figma-empty plus a single Figma-only alias to exercise the alias resolution path.
  const baseline = loadFixture('figma-full-tailwind.json');
  // Inject one figma-only alias variable that points at gold/200.
  const colorCol = baseline.collections.find(c => c.name === 'color');
  colorCol.variables.push({
    id: 'VariableID:syn:alias-test',
    name: 'figma-only/alias',
    resolvedType: 'COLOR',
    scopes: ['FRAME_FILL'],
    valuesByMode: {
      light: { kind: 'alias', targetName: 'gold/200', targetId: 'VariableID:syn:gold-200' },
      dark:  { kind: 'alias', targetName: 'gold/200', targetId: 'VariableID:syn:gold-200' },
    },
  });
  const css = fs.readFileSync(GLOBALS, 'utf8');
  const codeDS = parseCodeDesignSystem(css, { includeTailwindDefaults: true });
  const figmaDS = parseFigmaDesignSystem(baseline);
  const diff = compareDesignSystems(codeDS, figmaDS);
  const actions = buildFigmaActions(diff, [], 'pull');
  const aliasAction = actions.find(a => a.valueAlias);
  assert.ok(aliasAction, 'expected at least one action carrying valueAlias');
  assert.equal(aliasAction.valueAlias, '--color-gold-200',
    `alias should resolve with domain prefix, got: ${aliasAction.valueAlias}`);
  // Ensure no malformed cssVar (no double `--`, no missing prefix) is emitted anywhere.
  for (const a of actions) {
    if (a.cssVar) {
      assert.ok(a.cssVar.startsWith('--'), `cssVar missing leading --: ${a.cssVar}`);
      // Allow the text-X--line-height companion form; reject any other `--` mid-name.
      const tail = a.cssVar.slice(2);
      if (tail.includes('--')) {
        assert.match(a.cssVar, /^--text-[a-z0-9]+--line-height$/i,
          `unexpected double-dash in cssVar: ${a.cssVar}`);
      }
    }
    if (a.valueAlias) {
      assert.ok(a.valueAlias.startsWith('--'), `valueAlias missing leading --: ${a.valueAlias}`);
      // Should never end with `--<word>` (an alias to a leaf-companion var).
      assert.ok(!/^--(?!color-|spacing-|radius-|font-|text-|leading-|tracking-|opacity-|border-|z-|breakpoint-|container-|blur-|perspective-|aspect-|ease-|animate-|shadow-|background|foreground|brand-|surface|accent|border)/i.test(a.valueAlias)
        || /^--(color-|spacing-|radius-|font-|text-|leading-|tracking-|opacity-|border-|z-|breakpoint-|container-|blur-|perspective-|aspect-|ease-|animate-|shadow-|background|foreground|brand-|surface|accent|border)/i.test(a.valueAlias),
        `valueAlias missing domain prefix: ${a.valueAlias}`);
    }
  }
});

test('e2e: pull actions have no NaN / undefined / empty values', () => {
  // Use the extra-tokens fixture which actually produces pull actions.
  const { actions } = pipeline('figma-extra-tokens.json', { direction: 'pull' });
  for (const a of actions) {
    assert.notEqual(a.cssVar, '');
    assert.notEqual(a.cssVar, undefined);
    // Either value or valueAlias must be set (not both null).
    assert.ok(a.value != null || a.valueAlias != null, `action missing value: ${JSON.stringify(a)}`);
    if (a.value != null) {
      assert.notEqual(a.value, '');
      assert.notEqual(String(a.value).toLowerCase(), 'nan');
      assert.notEqual(String(a.value).toLowerCase(), 'undefined');
    }
  }
});
