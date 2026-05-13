'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findCanonicalForValue, looksSemantic, typographyFamily } = require('../canonical-matcher');
const { synthesizeTailwindUtilityScale } = require('../../design-system/code-parser');

// Build a realistic primitives map — Tailwind defaults + the synthesized
// utility scale, mirroring what loadTailwindDefaultPrimitives produces.
function buildPrimitives() {
  const out = {
    '--color-red-500':   '#ef4444',
    '--color-zinc-500':  '#71717a',
    '--color-white':     '#fff',
    '--text-xs':         '0.75rem',
    '--text-sm':         '0.875rem',
    '--text-base':       '1rem',
    '--text-lg':         '1.125rem',
    '--text-2xl':        '1.5rem',
    '--leading-5':       '1.25rem',
    '--leading-6':       '1.5rem',
    '--leading-7':       '1.75rem',
    '--tracking-tight':  '-0.025em',
    '--tracking-normal': '0em',
    '--radius':          '0.25rem',
  };
  for (const t of synthesizeTailwindUtilityScale()) {
    if (!(t.cssVar in out)) out[t.cssVar] = t.values.default.value;
  }
  return out;
}

// ─── Strict value matching ──────────────────────────────────────────

test('font-size 14 (number) matches Tailwind --text-sm (0.875rem = 14px)', () => {
  // The user\'s "Font-Size/Body = 14" case from the screenshot. After
  // normalizeDimension, both reduce to 14px. Auto-fix candidate.
  const p = buildPrimitives();
  const out = findCanonicalForValue('typography/Font-Size/Body', 14, p);
  assert.equal(out, '--text-sm');
});

test('line-height 28 matches --leading-7 (1.75rem = 28px)', () => {
  // The user\'s "Line-Height/Line Height 28" case. Family disambiguator
  // picks --leading-7 because the figma path mentions "Line-Height,"
  // which maps to the leading family.
  const p = buildPrimitives();
  const out = findCanonicalForValue('typography/Line-Height/Line Height 28', 28, p);
  assert.equal(out, '--leading-7');
});

test('color hex matches identical Tailwind palette entry', () => {
  const p = buildPrimitives();
  const out = findCanonicalForValue('color/red', '#ef4444', p);
  assert.equal(out, '--color-red-500');
});

test('color rgb-object (Figma\'s raw form) matches palette entry via normalization', () => {
  const p = buildPrimitives();
  // #ef4444 = rgb(239, 68, 68) = (0.937..., 0.267..., 0.267..., 1)
  const out = findCanonicalForValue('color/red', { r: 239 / 255, g: 68 / 255, b: 68 / 255, a: 1 }, p);
  assert.equal(out, '--color-red-500');
});

test('spacing 16 (number, 16px) matches --spacing-4 (synthesized 1rem = 16px)', () => {
  const p = buildPrimitives();
  const out = findCanonicalForValue('spacing/4', 16, p);
  assert.equal(out, '--spacing-4');
});

// ─── No match cases ──────────────────────────────────────────────────

test('value with no Tailwind match returns null', () => {
  const p = buildPrimitives();
  // Reactor's gold color isn\'t in any Tailwind default.
  const out = findCanonicalForValue('color/gold', '#c5a572', p);
  assert.equal(out, null);
});

test('semantic name with coincidental match still returns the canonical (matcher is name-agnostic; SKILL decides what to surface)', () => {
  // The matcher returns the match — the SKILL\'s prompt-builder uses
  // `looksSemantic` separately to label the "Add as semantic" option
  // prominently. Designer decides; matcher just reports.
  const p = buildPrimitives();
  const out = findCanonicalForValue('color/brand', '#ef4444', p);
  assert.equal(out, '--color-red-500');
});

test('null / undefined / unparseable values return null (no crash)', () => {
  const p = buildPrimitives();
  assert.equal(findCanonicalForValue('x/y', null, p), null);
  assert.equal(findCanonicalForValue('x/y', undefined, p), null);
  assert.equal(findCanonicalForValue('x/y', { wrong: 'shape' }, p), null);
});

test('empty primitives map returns null safely', () => {
  assert.equal(findCanonicalForValue('color/red', '#ef4444', {}), null);
  assert.equal(findCanonicalForValue('color/red', '#ef4444', null), null);
});

// ─── Family disambiguation in typography ────────────────────────────

test('typography family disambiguator: font-size path skips leading candidates with same value', () => {
  // 16px is BOTH text-base AND leading-6 in Tailwind. Without family
  // disambiguation, the matcher would return whichever came first in
  // iteration order. Family hint pins it to the right family.
  const p = buildPrimitives();
  const fontSizeOut = findCanonicalForValue('typography/Font-Size/Body', 16, p);
  assert.equal(fontSizeOut, '--text-base');
  const leadingOut = findCanonicalForValue('typography/Line-Height/Normal', 24, p);
  assert.equal(leadingOut, '--leading-6');
});

test('typographyFamily picks up "Font-Size", "Line-Height", "Tracking", etc.', () => {
  assert.equal(typographyFamily('typography/Font-Size/Body'), 'text');
  assert.equal(typographyFamily('typography/Line-Height/Line Height 28'), 'leading');
  assert.equal(typographyFamily('Type + Effects/Letter Space 0'), 'tracking');
  assert.equal(typographyFamily('Font-Weight/Bold'), 'font-weight');
  assert.equal(typographyFamily('font-family/Inter'), 'font');
  assert.equal(typographyFamily('text/sm'), 'text');
});

// ─── Semantic-name detector ──────────────────────────────────────────

test('looksSemantic: recognizes brand / accent / surface / etc.', () => {
  assert.equal(looksSemantic('color/brand'), true);
  assert.equal(looksSemantic('color/accent'), true);
  assert.equal(looksSemantic('color/surface'), true);
  assert.equal(looksSemantic('color/background'), true);
  assert.equal(looksSemantic('color/foreground'), true);
  assert.equal(looksSemantic('color/primary'), true);
  assert.equal(looksSemantic('color/success'), true);
  assert.equal(looksSemantic('color/destructive'), true);
  // Tier-collection variants.
  assert.equal(looksSemantic('Semantic/brand/surface'), true);
});

test('looksSemantic: Tailwind canonical names are NOT marked semantic', () => {
  assert.equal(looksSemantic('color/red-500'), false);
  assert.equal(looksSemantic('color/zinc-500'), false);
  assert.equal(looksSemantic('text/sm'), false);
  assert.equal(looksSemantic('spacing/4'), false);
  assert.equal(looksSemantic('radius/full'), false);
  // The user\'s non-canonical-but-not-semantic case.
  assert.equal(looksSemantic('typography/Font-Size/Body'), false);
});

test('looksSemantic: edge cases (null, empty, single-segment) handled safely', () => {
  assert.equal(looksSemantic(null), false);
  assert.equal(looksSemantic(''), false);
  // Single-segment semantic name (no collection prefix at all).
  assert.equal(looksSemantic('brand'), true);
  assert.equal(looksSemantic('red-500'), false);
});
