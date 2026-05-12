'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkVariableNames, caseMatchesSegment, suggestName, toCase } = require('../variable-namer');

// Real Figma var keys arrive as `<collection>/<rest>`. The first segment is
// the collection name (Primitives, Semantic) and is left alone — that's the
// same treatment variable-categorizer applies. All assertions below use the
// realistic shape.

test('returns [] when convention is false (check disabled)', () => {
  assert.deepEqual(checkVariableNames(['Primitives/color/BrandPrimary', 'Primitives/radius/MD'], false), []);
});

test('returns [] when every variable name is compliant in kebab-case (with path segments)', () => {
  const names = [
    'Primitives/color/brand-primary',
    'Semantic/color/text/default',
    'Primitives/radius/sm',
    'Primitives/shadow/md',
  ];
  assert.deepEqual(checkVariableNames(names, 'kebab-case'), []);
});

test('does NOT flag the collection prefix even when it is PascalCase (real Figma convention)', () => {
  // `Primitives` is PascalCase but it's a collection name, not a variable
  // name. The rule mirrors variable-categorizer.strippedToken behavior.
  const names = ['Primitives/color/brand-primary'];
  assert.deepEqual(checkVariableNames(names, 'kebab-case'), []);
});

test('flags PascalCase-shaped variable segments in a kebab-case project', () => {
  const result = checkVariableNames(['Primitives/color/BrandPrimary', 'Primitives/radius/MD'], 'kebab-case');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { name: 'Primitives/color/BrandPrimary', suggestion: 'Primitives/color/brand-primary' });
  assert.deepEqual(result[1], { name: 'Primitives/radius/MD', suggestion: 'Primitives/radius/md' });
});

test('only the BAD segment fails; good segments are preserved in the suggestion', () => {
  // `color` is fine in kebab; `Brand_Primary` is the bad part.
  const result = checkVariableNames(['Primitives/color/Brand_Primary'], 'kebab-case');
  assert.equal(result.length, 1);
  assert.equal(result[0].suggestion, 'Primitives/color/brand-primary');
});

test('handles numerics in segments without inserting stray separators in kebab', () => {
  // `color/blue/500` is valid kebab; `color/Blue500` should become `color/blue-500`.
  const valid = checkVariableNames(['Primitives/color/blue/500'], 'kebab-case');
  assert.deepEqual(valid, []);
  const result = checkVariableNames(['Primitives/color/Blue500'], 'kebab-case');
  assert.equal(result[0].suggestion, 'Primitives/color/blue-500');
});

test('PascalCase project: flags kebab-cased variable segments (collection prefix kept)', () => {
  const result = checkVariableNames(['Primitives/brand-primary', 'Primitives/sm'], 'PascalCase');
  assert.equal(result.length, 2);
  assert.equal(result[0].suggestion, 'Primitives/BrandPrimary');
  assert.equal(result[1].suggestion, 'Primitives/Sm');
});

test('camelCase project: flags Pascal- and kebab-cased segments and suggests camel', () => {
  const result = checkVariableNames(['Primitives/color/BrandPrimary', 'Primitives/color/text-default'], 'camelCase');
  assert.equal(result.length, 2);
  assert.equal(result[0].suggestion, 'Primitives/color/brandPrimary');
  assert.equal(result[1].suggestion, 'Primitives/color/textDefault');
});

test('top-level vars without a collection prefix are skipped (no name to check)', () => {
  // An unprefixed var like "spacing" can't be split — nothing to enforce.
  assert.deepEqual(checkVariableNames(['spacing'], 'kebab-case'), []);
});

test('caseMatchesSegment: kebab accepts lowercase+digits+hyphens, rejects uppercase', () => {
  assert.equal(caseMatchesSegment('brand-primary', 'kebab-case'), true);
  assert.equal(caseMatchesSegment('blue500', 'kebab-case'), true);
  assert.equal(caseMatchesSegment('Brand', 'kebab-case'), false);
  assert.equal(caseMatchesSegment('brand_primary', 'kebab-case'), false);
});

test('caseMatchesSegment: PascalCase requires leading uppercase', () => {
  assert.equal(caseMatchesSegment('BrandPrimary', 'PascalCase'), true);
  assert.equal(caseMatchesSegment('brand', 'PascalCase'), false);
  assert.equal(caseMatchesSegment('Brand-Primary', 'PascalCase'), false);
});

test('caseMatchesSegment: camelCase requires leading lowercase, no separators', () => {
  assert.equal(caseMatchesSegment('brandPrimary', 'camelCase'), true);
  assert.equal(caseMatchesSegment('Brand', 'camelCase'), false);
  assert.equal(caseMatchesSegment('brand_primary', 'camelCase'), false);
});

test('toCase handles HTMLParser-style acronyms by splitting before the lowercase run', () => {
  // "HTMLParser" → words ["html","parser"] → kebab "html-parser", Pascal "HtmlParser"
  assert.equal(toCase('HTMLParser', 'kebab-case'), 'html-parser');
  assert.equal(toCase('HTMLParser', 'PascalCase'), 'HtmlParser');
});

test('suggestName preserves the / path separator', () => {
  assert.equal(suggestName('color/text/PrimaryBold', 'kebab-case'), 'color/text/primary-bold');
});
