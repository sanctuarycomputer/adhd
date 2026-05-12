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

// ---------------------------------------------------------------------------
// STRUCT011 — Tailwind v4 domain "did you mean?" check.
//
// Second half of the variable-naming rule. The first half (above) checks the
// case convention; this half checks that the first segment AFTER the
// collection maps to a Tailwind v4 token-domain prefix. Both halves emit
// under the same rule code (STRUCT011) and get aggregated into one
// annotation — designers see "variable naming compliance" as a single
// concern, not two separate things to chase down.
//
// Why this matters: a variable named `Primitives/colur/brand-500` is
// perfectly kebab-case, so the case half passes — but `colur` doesn't map
// to anything in Tailwind v4. Code gen sees an unrecognized namespace and
// either drops the var or surfaces it as a one-off alias.
//
// This rule catches three classes of issue:
//   1. Synonyms — designers writing the natural-language form instead of
//      Tailwind's canonical name (`colors/...`, `space/...`, `shadows/...`,
//      `screens/...`, etc.).
//   2. Typos — `colur/brand-500`, `radiu/sm`. Caught via Levenshtein distance.
//   3. Genuinely unknown prefixes — `widget/...`, `random/...`. Flagged with
//      the list of recognized domains so the designer can pick one.
//
// Suggestions come from a hand-curated synonym table first (high precision),
// falling back to Levenshtein distance ≤ 2 against the canonical domain list.
// Distance 3+ → "no good match"; report lists the canonical set instead.

const TAILWIND_DOMAINS = [
  'color', 'spacing', 'text', 'font', 'font-weight',
  'tracking', 'leading', 'radius', 'shadow',
  'breakpoint', 'ease', 'animate',
];

const DOMAIN_SYNONYMS = {
  // Pluralization
  'colors': 'color',
  'shadows': 'shadow',
  'radii': 'radius',
  'animations': 'animate',
  'breakpoints': 'breakpoint',
  'easings': 'ease',
  'fonts': 'font',
  // Common alternates
  'colour': 'color',
  'colours': 'color',
  'space': 'spacing',
  'spaces': 'spacing',
  'screen': 'breakpoint',
  'screens': 'breakpoint',
  'media': 'breakpoint',
  'transition': 'ease',
  'easing': 'ease',
  'animation': 'animate',
  'border-radius': 'radius',
  'rounded': 'radius',
  'font-family': 'font',
  'font-size': 'text',
  'fontsize': 'text',
  'font-weights': 'font-weight',
  'fontweight': 'font-weight',
  'weight': 'font-weight',
  'letter-spacing': 'tracking',
  'letterspacing': 'tracking',
  'line-height': 'leading',
  'lineheight': 'leading',
};

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let v0 = Array.from({ length: b.length + 1 }, (_, i) => i);
  let v1 = new Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    [v0, v1] = [v1, v0];
  }
  return v0[b.length];
}

// Returns { kind: 'known' } | { kind: 'synonym', suggestion } |
//   { kind: 'typo', suggestion, distance } | { kind: 'unknown' }
function classifyDomain(segment) {
  const lower = segment.toLowerCase();
  if (TAILWIND_DOMAINS.includes(lower)) return { kind: 'known' };
  if (DOMAIN_SYNONYMS[lower]) {
    return { kind: 'synonym', suggestion: DOMAIN_SYNONYMS[lower] };
  }
  // Fall back to Levenshtein. Distance 1–2 = likely typo. 3+ = probably not
  // a typo — flag as unknown so the user picks from the canonical list.
  const candidates = TAILWIND_DOMAINS
    .map(d => ({ domain: d, distance: levenshtein(lower, d) }))
    .sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (best.distance <= 2) {
    return { kind: 'typo', suggestion: best.domain, distance: best.distance };
  }
  return { kind: 'unknown' };
}

// Returns an array of `{ name, domainSegment, classification }` for vars whose
// post-collection first segment doesn't match a known Tailwind v4 domain.
// Names with no path segments after the collection are skipped (nothing to
// classify).
function checkVariableDomains(varNames) {
  const out = [];
  for (const name of varNames) {
    const segments = name.split('/');
    if (segments.length <= 1) continue;
    const domainSegment = segments[1]; // first segment AFTER collection
    const classification = classifyDomain(domainSegment);
    if (classification.kind !== 'known') {
      out.push({ name, domainSegment, classification });
    }
  }
  return out;
}

module.exports = {
  checkVariableNames, caseMatchesSegment, suggestName, toCase,
  checkVariableDomains, classifyDomain, TAILWIND_DOMAINS,
};
