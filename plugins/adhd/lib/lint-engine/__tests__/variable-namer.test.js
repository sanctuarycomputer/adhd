'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkVariableNames, caseMatchesSegment, suggestName, toCase,
  checkVariableDomains, classifyDomain, TAILWIND_DOMAINS,
} = require('../variable-namer');

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

// ---------------------------------------------------------------------------
// Domain "did you mean?" half of STRUCT011

test('classifyDomain: recognized Tailwind v4 prefixes return known', () => {
  for (const d of TAILWIND_DOMAINS) {
    assert.deepEqual(classifyDomain(d), { kind: 'known' }, `expected "${d}" to be known`);
  }
});

test('classifyDomain: synonyms suggest the canonical name', () => {
  assert.deepEqual(classifyDomain('colors'), { kind: 'synonym', suggestion: 'color' });
  assert.deepEqual(classifyDomain('space'), { kind: 'synonym', suggestion: 'spacing' });
  assert.deepEqual(classifyDomain('shadows'), { kind: 'synonym', suggestion: 'shadow' });
  assert.deepEqual(classifyDomain('screens'), { kind: 'synonym', suggestion: 'breakpoint' });
  assert.deepEqual(classifyDomain('font-size'), { kind: 'synonym', suggestion: 'text' });
  assert.deepEqual(classifyDomain('line-height'), { kind: 'synonym', suggestion: 'leading' });
});

test('classifyDomain: small typos (distance ≤ 2) are classified as typo with suggestion', () => {
  // "colur" → "color" (distance 1, missing 'o' + extra letter)
  const r1 = classifyDomain('colur');
  assert.equal(r1.kind, 'typo');
  assert.equal(r1.suggestion, 'color');
  // "radiu" → "radius" (distance 1, missing 's')
  const r2 = classifyDomain('radiu');
  assert.equal(r2.kind, 'typo');
  assert.equal(r2.suggestion, 'radius');
});

test('classifyDomain: genuinely unknown prefixes return kind:unknown', () => {
  // "widget" is too distant from anything in the list to be a typo.
  assert.deepEqual(classifyDomain('widget'), { kind: 'unknown' });
  assert.deepEqual(classifyDomain('miscellaneous'), { kind: 'unknown' });
});

test('classifyDomain is case-insensitive on input', () => {
  // The case-convention check is a separate concern; domain classification
  // shouldn't depend on whether the designer wrote "Color" or "color".
  assert.deepEqual(classifyDomain('Color'), { kind: 'known' });
  assert.deepEqual(classifyDomain('SHADOWS'), { kind: 'synonym', suggestion: 'shadow' });
});

test('checkVariableDomains: real Figma keys with collection prefix', () => {
  const names = [
    'Primitives/color/brand-500',           // ok
    'Primitives/colur/brand-500',           // typo
    'Primitives/space/sm',                  // synonym
    'Primitives/widget/foo',                // unknown
    'Semantic/color/text/default',          // ok
  ];
  const out = checkVariableDomains(names);
  assert.equal(out.length, 3);
  assert.equal(out[0].name, 'Primitives/colur/brand-500');
  assert.equal(out[0].classification.kind, 'typo');
  assert.equal(out[0].classification.suggestion, 'color');
  assert.equal(out[1].name, 'Primitives/space/sm');
  assert.equal(out[1].classification.kind, 'synonym');
  assert.equal(out[1].classification.suggestion, 'spacing');
  assert.equal(out[2].name, 'Primitives/widget/foo');
  assert.equal(out[2].classification.kind, 'unknown');
});

test('checkVariableDomains: collection-only names (no slash) are skipped', () => {
  assert.deepEqual(checkVariableDomains(['Primitives']), []);
});

test('checkVariableDomains: collection name IS the domain — skip domain check on the var', () => {
  // Some teams organize Figma collections by domain ("Color", "Radius", "Spacing")
  // instead of by tier ("Primitives", "Semantic"). When the collection name
  // itself matches a Tailwind domain, the variable name doesn't need another
  // domain prefix. `Color/gold` and `Radius/sm` are valid.
  const names = ['Color/gold', 'Radius/sm', 'Spacing/sm', 'Shadow/lg'];
  assert.deepEqual(checkVariableDomains(names), []);
});

test('checkVariableDomains: collection synonym counts too (Colors/, Shadows/, Screens/)', () => {
  // If the collection is named with a synonym (plural, alternate), accept it.
  // Otherwise the rule would tell the designer to add ANOTHER "color" segment
  // inside a `Colors` collection — busywork.
  const names = ['Colors/gold', 'Shadows/sm', 'Screens/md'];
  assert.deepEqual(checkVariableDomains(names), []);
});

test('checkVariableDomains: case- and whitespace-normalized collection match (Type + Effects is NOT a domain)', () => {
  // "Type + Effects" → "type-effects" — doesn't match any domain. So the
  // first segment after the collection still needs to be checked.
  const names = ['Type + Effects/Font-Size/Body'];
  const out = checkVariableDomains(names);
  assert.equal(out.length, 1);
  // "Font-Size" is a known synonym for "text"
  assert.equal(out[0].classification.kind, 'synonym');
  assert.equal(out[0].classification.suggestion, 'text');
});

test('normalizeCollectionName collapses separators and lowercases', () => {
  const { normalizeCollectionName } = require('../variable-namer');
  assert.equal(normalizeCollectionName('Color'), 'color');
  assert.equal(normalizeCollectionName('Type + Effects'), 'type-effects');
  assert.equal(normalizeCollectionName('Font Weight'), 'font-weight');
  assert.equal(normalizeCollectionName('  Spacing  '), 'spacing');
});

// ---------------------------------------------------------------------------
// suggestTargetName — actionable per-variable rename targets

const { suggestTargetName } = require('../variable-namer');

test('suggestTargetName: tier collection (Primitives/Semantic) preserves the tier', () => {
  // The standard two-tier organization. Internal domain segments and leaves
  // get kebab-cased; the tier itself stays.
  assert.deepEqual(suggestTargetName('Primitives/color/BrandPrimary'), {
    name: 'Primitives/color/BrandPrimary', kind: 'rename', target: 'Primitives/color/brand-primary',
  });
  assert.deepEqual(suggestTargetName('Primitives/color/brand-500'), {
    name: 'Primitives/color/brand-500', kind: 'ok',
  });
});

test('suggestTargetName: tier collection with unrecognized inner domain → no-mapping', () => {
  // Tier is fine, but "widget" inside isn't a Tailwind domain — can't auto-rename safely.
  const r = suggestTargetName('Primitives/widget/foo');
  assert.equal(r.kind, 'no-mapping');
  assert.match(r.reason, /Inside the "Primitives" tier, the segment "widget" doesn't match any Tailwind v4 domain/);
});

test('suggestTargetName: domain-named collection (Color/gold) preserves collection', () => {
  // Some teams organize by domain at the collection level. No need to inject
  // a redundant "color" segment.
  assert.deepEqual(suggestTargetName('Color/gold'), { name: 'Color/gold', kind: 'ok' });
  assert.deepEqual(suggestTargetName('Radius/sm'), { name: 'Radius/sm', kind: 'ok' });
  // Case-fix the leaf in this mode too.
  assert.deepEqual(suggestTargetName('Color/BrandGold'), {
    name: 'Color/BrandGold', kind: 'rename', target: 'Color/brand-gold',
  });
});

test('suggestTargetName: synonym-collection rewrites to canonical Tailwind name', () => {
  // A collection named "Colors" or "Shadows" gets renormalized to the
  // canonical domain (Color, Shadow).
  assert.deepEqual(suggestTargetName('Colors/gold'), {
    name: 'Colors/gold', kind: 'rename', target: 'Color/gold',
  });
  assert.deepEqual(suggestTargetName('Shadows/sm'), {
    name: 'Shadows/sm', kind: 'rename', target: 'Shadow/sm',
  });
});

test('suggestTargetName: bundled collection with domain hint in rest → MOVE to domain collection', () => {
  // The user's "Type + Effects" case. The engine detects that one of the
  // inner segments hints at a domain ("Font-Size" → text, "Line-Height" →
  // leading) and suggests moving the variable to a dedicated collection.
  // The redundant domain-naming segment is dropped from the path.
  assert.deepEqual(suggestTargetName('Type + Effects/Font-Size/Body'), {
    name: 'Type + Effects/Font-Size/Body', kind: 'rename', target: 'Text/body',
  });
  assert.deepEqual(suggestTargetName('Type + Effects/Font-Size/Body LG'), {
    name: 'Type + Effects/Font-Size/Body LG', kind: 'rename', target: 'Text/body-lg',
  });
  assert.deepEqual(suggestTargetName('Type + Effects/Line-Height/Line Height 28'), {
    name: 'Type + Effects/Line-Height/Line Height 28', kind: 'rename', target: 'Leading/line-height-28',
  });
});

test('suggestTargetName: opacity-shaped names get a specific concept-aware hint', () => {
  // Tailwind v4 has no "opacity" domain — opacity is applied via class
  // modifiers (`bg-white/50`). The no-mapping message reflects that
  // rather than just listing canonical domains.
  const r = suggestTargetName('Type + Effects/Effects/Opacity 100%');
  assert.equal(r.kind, 'no-mapping');
  assert.match(r.reason, /Tailwind v4 has no "opacity" domain/);
  assert.match(r.reason, /class modifiers/);
  // Doesn't repeat the generic "Expected one of: ..." list.
  assert.doesNotMatch(r.reason, /Expected one of: color/);
});

test('suggestTargetName: leaf hint conflicts with path → ambiguous result', () => {
  // The user's real case: "Type + Effects/Line-Height/Letter Space 0".
  // Path says line-height (→ leading), leaf says "Letter Space" (→ tracking).
  // The variable could be either; surface both options for the designer.
  const r = suggestTargetName('Type + Effects/Line-Height/Letter Space 0');
  assert.equal(r.kind, 'ambiguous');
  assert.equal(r.target, 'Leading/letter-space-0');
  assert.equal(r.alternate, 'Tracking/0');
  assert.match(r.primaryReason, /path suggests leading/);
  assert.match(r.alternateReason, /Letter Space.*suggests tracking/);
});

test('suggestTargetName: when no domain hint exists AND no opacity → generic no-mapping', () => {
  // Fallback case for truly unmappable variables. Surfaces the canonical
  // domain list as a menu.
  const r = suggestTargetName('Foo/widget/thing');
  assert.equal(r.kind, 'no-mapping');
  assert.match(r.reason, /No Tailwind v4 domain found in path/);
  assert.match(r.reason, /Expected one of: color, spacing, text/);
});

test('suggestTargetName: top-level vars without collection are ok by default', () => {
  // Can't classify without a path; leave alone.
  assert.deepEqual(suggestTargetName('spacing'), { name: 'spacing', kind: 'ok' });
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
