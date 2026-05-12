'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WRITE_SCRIPT, tokenScopesFor, findCollectionAlias, COLLECTION_ALIASES } = require('../figma-write-script');

test('tokenScopesFor: text/<size> → FONT_SIZE', () => {
  assert.deepEqual(tokenScopesFor('typography', 'text/xs'), ['FONT_SIZE']);
  assert.deepEqual(tokenScopesFor('typography', 'text/base'), ['FONT_SIZE']);
});

test('tokenScopesFor: text/<size>/line-height → LINE_HEIGHT (regression — companion line-heights must not get FONT_SIZE scope)', () => {
  // The bug: Tailwind v4 ships paired line-height values with every text
  // size (--text-xs--line-height: calc(1 / 0.75), etc.). Earlier the
  // startsWith('text/') branch matched first and assigned FONT_SIZE,
  // and Figma rejected the push with "Invalid scope for this variable
  // type" on every text-size's paired line-height.
  assert.deepEqual(tokenScopesFor('typography', 'text/xs/line-height'), ['LINE_HEIGHT']);
  assert.deepEqual(tokenScopesFor('typography', 'text/base/line-height'), ['LINE_HEIGHT']);
  assert.deepEqual(tokenScopesFor('typography', 'text/4xl/line-height'), ['LINE_HEIGHT']);
});

test('tokenScopesFor: leading/, tracking/, font/, font-weight/ keep their dedicated scopes', () => {
  assert.deepEqual(tokenScopesFor('typography', 'leading/relaxed'), ['LINE_HEIGHT']);
  assert.deepEqual(tokenScopesFor('typography', 'tracking/tight'), ['LETTER_SPACING']);
  assert.deepEqual(tokenScopesFor('typography', 'font/sans'), ['FONT_FAMILY']);
  assert.deepEqual(tokenScopesFor('typography', 'font-weight/bold'), ['FONT_WEIGHT']);
});

test('tokenScopesFor: non-typography domains pull from the domain table', () => {
  assert.deepEqual(tokenScopesFor('color', 'gold/100'), ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR']);
  assert.deepEqual(tokenScopesFor('radius', 'sm'), ['CORNER_RADIUS']);
  assert.deepEqual(tokenScopesFor('opacity', '50'), ['OPACITY']);
});

test('findCollectionAlias: matches case-insensitively to the canonical (Color → color)', () => {
  // The user's "duped collections" bug. Designer's Figma file had a
  // "Color" collection (capital C) but push was looking up "color"
  // case-sensitively, missed it, and created a parallel "color"
  // collection alongside. Same for "Radius" / "radius".
  assert.equal(findCollectionAlias('color', ['Color', 'Other']), 'Color');
  assert.equal(findCollectionAlias('radius', ['Other', 'Radius']), 'Radius');
});

test('findCollectionAlias: matches synonyms (Space → spacing, Borders → border-width, Type + Effects → typography)', () => {
  // Real collection names from the user's screenshot. Each maps to a
  // different canonical without case alone — these are semantic synonyms.
  assert.equal(findCollectionAlias('spacing', ['Space']), 'Space');
  assert.equal(findCollectionAlias('border-width', ['Borders']), 'Borders');
  assert.equal(findCollectionAlias('typography', ['Type + Effects']), 'Type + Effects');
  assert.equal(findCollectionAlias('shadow', ['Effects']), 'Effects');
});

test('findCollectionAlias: returns null when nothing matches (caller creates new collection)', () => {
  assert.equal(findCollectionAlias('color', ['Spacing', 'Radii']), null);
  assert.equal(findCollectionAlias('color', []), null);
});

test('findCollectionAlias: unknown canonical returns null (safe default)', () => {
  assert.equal(findCollectionAlias('not-a-domain', ['Color', 'Radius']), null);
});

test('COLLECTION_ALIASES covers every domain the action builder might emit', () => {
  // If a new domain gets added to figma-write-actions's DOMAIN_COLLECTION
  // but not here, the alias lookup silently returns null for it and
  // push starts creating differently-cased duplicate collections.
  const { DOMAIN_COLLECTION } = require('../figma-write-actions');
  for (const canonical of Object.values(DOMAIN_COLLECTION)) {
    assert.ok(COLLECTION_ALIASES[canonical],
      `missing alias list for canonical "${canonical}" — push will create a fresh collection instead of reusing existing case-variants`);
  }
});

test('WRITE_SCRIPT inlines the same alias logic (drift guard)', () => {
  // The script template carries its own copy of COLLECTION_ALIASES.
  // This guard catches drift: if the JS-side table evolves without the
  // inline copy keeping up, real pushes go back to creating parallel
  // case-variant collections.
  for (const aliases of Object.values(COLLECTION_ALIASES)) {
    for (const a of aliases) {
      assert.ok(WRITE_SCRIPT.includes(`'${a}'`),
        `alias "${a}" missing from inlined COLLECTION_ALIASES in WRITE_SCRIPT`);
    }
  }
});

test('WRITE_SCRIPT inlines the same line-height pattern (drift guard)', () => {
  // The script template can't `require`, so it carries its own copy of
  // tokenScopesFor. The exported JS-side function above is its mirror.
  // This guard catches drift: if someone edits the inline version without
  // touching the JS-side mirror (or vice versa), the line-height case
  // could silently regress.
  assert.match(WRITE_SCRIPT,
    /path\.startsWith\(['"`]text\/['"`]\)\s*&&\s*path\.endsWith\(['"`]\/line-height['"`]\)/,
    'WRITE_SCRIPT should include the text/*/line-height branch BEFORE the broader text/ check',
  );
});
