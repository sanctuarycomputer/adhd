'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WRITE_SCRIPT, tokenScopesFor } = require('../figma-write-script');

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
