'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectTailwindDuplicates,
  normalizeFigmaVarName,
} = require('../tailwind-duplicate-detector');

test('normalizeFigmaVarName: domain-as-collection', () => {
  assert.equal(normalizeFigmaVarName('Color/zinc-500'), 'color-zinc-500');
  assert.equal(normalizeFigmaVarName('Spacing/4'), 'spacing-4');
  assert.equal(normalizeFigmaVarName('Radius/sm'), 'radius-sm');
});

test('normalizeFigmaVarName: tier collection stripped', () => {
  // Primitives is a tier — its prefix is invisible.
  assert.equal(normalizeFigmaVarName('Primitives/color/zinc/500'), 'color-zinc-500');
  assert.equal(normalizeFigmaVarName('Semantic/spacing/md'), 'spacing-md');
});

test('normalizeFigmaVarName: PascalCase / camelCase leaf is kebabed', () => {
  assert.equal(normalizeFigmaVarName('Color/BrandGold'), 'color-brand-gold');
  assert.equal(normalizeFigmaVarName('Spacing/spacing0_5'), 'spacing-spacing-0-5');
});

test('detectTailwindDuplicates: strict name + value match wins', () => {
  const varDefs = {
    'Color/zinc-500': '#71717a',
    'Color/zinc-600': '#52525b',
  };
  const tailwindDefaults = {
    '--color-zinc-500': '#71717a',
    '--color-zinc-600': '#52525b',
    '--color-zinc-700': '#3f3f46',
  };
  const out = detectTailwindDuplicates(varDefs, tailwindDefaults);
  const names = out.map(d => d.figmaName).sort();
  assert.deepEqual(names, ['Color/zinc-500', 'Color/zinc-600']);
  assert.equal(out[0].tailwindCssVar, '--color-zinc-500');
});

test('detectTailwindDuplicates: name matches but value differs → no fire', () => {
  // The user's `Color/MyZinc` case, but with the canonical name. If the
  // value diverges from the Tailwind default, it's not a duplicate — the
  // designer has intentionally overridden it.
  const varDefs = { 'Color/zinc-500': '#888888' };
  const tailwindDefaults = { '--color-zinc-500': '#71717a' };
  const out = detectTailwindDuplicates(varDefs, tailwindDefaults);
  assert.deepEqual(out, []);
});

test('detectTailwindDuplicates: value matches but name differs → no fire (semantic-intent guard)', () => {
  // `Color/MyZinc = #71717a` happens to equal `--color-zinc-500`, but
  // the name signals a semantic intent ("my brand's zinc") — strict mode
  // refuses to flag this. The designer's naming choice is respected.
  const varDefs = { 'Color/MyZinc': '#71717a' };
  const tailwindDefaults = { '--color-zinc-500': '#71717a' };
  const out = detectTailwindDuplicates(varDefs, tailwindDefaults);
  assert.deepEqual(out, []);
});

test('detectTailwindDuplicates: tier-collection variants still match canonical', () => {
  const varDefs = { 'Primitives/color/zinc/500': '#71717a' };
  const tailwindDefaults = { '--color-zinc-500': '#71717a' };
  const out = detectTailwindDuplicates(varDefs, tailwindDefaults);
  assert.equal(out.length, 1);
  assert.equal(out[0].figmaName, 'Primitives/color/zinc/500');
  assert.equal(out[0].tailwindCssVar, '--color-zinc-500');
});

test('detectTailwindDuplicates: case-insensitive value comparison', () => {
  // Designer entered `#71717A`; Tailwind ships `#71717a`. Still a dupe.
  const varDefs = { 'Color/zinc-500': '#71717A' };
  const tailwindDefaults = { '--color-zinc-500': '#71717a' };
  const out = detectTailwindDuplicates(varDefs, tailwindDefaults);
  assert.equal(out.length, 1);
});

test('detectTailwindDuplicates: handles empty inputs gracefully', () => {
  assert.deepEqual(detectTailwindDuplicates(null, {}), []);
  assert.deepEqual(detectTailwindDuplicates({}, null), []);
  assert.deepEqual(detectTailwindDuplicates({}, {}), []);
});
