'use strict';

// STRUCT011 — variable-name compliance.
//
// Splits each Figma variable name on `/` (Figma's path separator) and checks
// each segment against the project's naming convention. Per-segment is the
// right granularity: `color/brand/500` has three segments that each need to
// individually match kebab/Pascal/camel — treating the whole name as one
// string fails since `/` isn't valid in any convention.
//
// Returns: an array of `{ name, suggestion }` for variables whose name
// doesn't match. The suggestion is a best-effort rewrite into the target
// convention (splits words on case transitions, hyphens, underscores;
// numerics stay in place).

function caseMatchesSegment(segment, convention) {
  if (convention === false || convention == null) return true;
  if (convention === 'kebab-case') return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(segment);
  if (convention === 'PascalCase') return /^[A-Z][a-zA-Z0-9]*$/.test(segment);
  if (convention === 'camelCase')  return /^[a-z][a-zA-Z0-9]*$/.test(segment);
  return true;
}

// Word-split: handles "BrandPrimary", "brand-primary", "brand_primary",
// "color500", "HTMLParser" → ["html","parser"], etc.
function splitWords(segment) {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
}

function toCase(segment, convention) {
  const words = splitWords(segment);
  if (words.length === 0) return segment;
  if (convention === 'kebab-case') return words.join('-');
  if (convention === 'PascalCase') return words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
  if (convention === 'camelCase') {
    return words.map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join('');
  }
  return segment;
}

// Variable keys arrive as `<collection>/<name>` from the SKILL's serializer.
// The collection name (e.g. "Primitives", "Semantic") is conventionally
// PascalCase in Figma regardless of the project's variable-naming convention
// — same treatment variable-categorizer already gives it via `strippedToken`.
// We only check segments AFTER the collection.
function suggestName(name, convention) {
  const segments = name.split('/');
  if (segments.length <= 1) return name;
  const [collection, ...rest] = segments;
  return [collection, ...rest.map(s => toCase(s, convention))].join('/');
}

function checkVariableNames(varNames, convention) {
  if (convention === false || convention == null) return [];
  const out = [];
  for (const name of varNames) {
    const segments = name.split('/');
    // Skip collection-prefix-only entries (`foo` with no slash); nothing to check.
    if (segments.length <= 1) continue;
    const checked = segments.slice(1);
    const allGood = checked.every(s => caseMatchesSegment(s, convention));
    if (!allGood) {
      out.push({ name, suggestion: suggestName(name, convention) });
    }
  }
  return out;
}

module.exports = { checkVariableNames, caseMatchesSegment, suggestName, toCase };
