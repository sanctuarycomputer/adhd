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

// Normalize a collection name for domain-matching: lowercase, collapse
// separators (`+`, ` `, `-`, `_`) to `-`, drop the rest. "Color" → "color",
// "Type + Effects" → "type-effects", "Radius" → "radius".
function normalizeCollectionName(name) {
  return name.toLowerCase()
    .replace(/[\s+\-_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

// True when the collection name itself acts as the Tailwind domain — the
// variable name within doesn't need another domain prefix. `Color/gold`,
// `Radius/sm`, `Spacing/sm` are all valid. `Primitives/...` and
// `Semantic/...` are not (they're not domain names).
function collectionIsDomain(collection) {
  const norm = normalizeCollectionName(collection);
  const classification = classifyDomain(norm);
  return classification.kind === 'known' || classification.kind === 'synonym';
}

// Returns an array of `{ name, domainSegment, classification }` for vars whose
// post-collection first segment doesn't match a known Tailwind v4 domain.
// Skipped:
//   - Names with no path segments after the collection (nothing to classify).
//   - Names whose COLLECTION already names the domain (`Color/gold` ok —
//     "gold" doesn't need its own domain prefix).
function checkVariableDomains(varNames) {
  const out = [];
  for (const name of varNames) {
    const segments = name.split('/');
    if (segments.length <= 1) continue;
    if (collectionIsDomain(segments[0])) continue;
    const domainSegment = segments[1]; // first segment AFTER collection
    const classification = classifyDomain(domainSegment);
    if (classification.kind !== 'known') {
      out.push({ name, domainSegment, classification });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canonical target builder — gives each variable a SINGLE concrete rename
// target that combines the case + domain concerns. This is what
// `cli.js` emits in STRUCT011 messages: actionable end-state names, not
// per-segment hints.
//
// Three classes of result:
//   - `ok`         — name is already in the right shape; nothing to do.
//   - `rename`     — produced a single target; designer renames to that.
//   - `no-mapping` — no Tailwind v4 domain detected anywhere in the path,
//                    AND the collection isn't a recognized tier. Surface
//                    the canonical list so the designer picks one.
//
// Conventions assumed:
//   - "Primitives" / "Semantic" / "Tokens" / "Base" / "Theme" are TIER
//     collections — they bundle multiple domains by design, so the
//     internal structure should follow `<Tier>/<Domain>/<...>`. Renames
//     preserve the tier and just fix case + ensure the domain segment is
//     canonical.
//   - Otherwise, when the collection name itself is a Tailwind domain
//     (Color, Radius, Spacing, …), it's preserved.
//   - When the collection is unrecognized AND a rest segment names a
//     domain, the suggestion MOVES the variable into a domain-named
//     collection — e.g. "Type + Effects/Font-Size/Body" → "Text/body".

const TIER_COLLECTIONS = new Set([
  'primitives', 'semantic', 'tokens', 'base', 'theme',
]);

// Leaf-name keywords that hint at a specific Tailwind v4 domain. When the
// leaf hints at a DIFFERENT domain than the path's primary signal, we
// surface the ambiguity instead of confidently picking one.
// Example: "Type + Effects/Line-Height/Letter Space 0" — path says leading
// (via Line-Height), leaf says letter-spacing (tracking). The variable
// could be either; the designer has to decide.
const LEAF_DOMAIN_HINTS = [
  // The `spac(?:e|ing)` group covers both "letter space" (Figma designers
  // often write it this way) and "letter spacing" / "letter-spacing" (CSS
  // form). Anchoring with \b ensures we strip the full phrase on rename
  // suggestion, not just the prefix — otherwise "Letter Space 0" loses
  // "letter spac" and we suggest "Tracking/e-0".
  { pattern: /\bletter[\s\-_]?spac(?:e|ing)\b/i, domain: 'tracking' },
  { pattern: /\bline[\s\-_]?height\b/i, domain: 'leading'  },
  { pattern: /\bfont[\s\-_]?size\b/i,   domain: 'text'     },
  { pattern: /\bfont[\s\-_]?weight\b/i, domain: 'font-weight' },
  { pattern: /\bfont[\s\-_]?family\b/i, domain: 'font'     },
];

function leafHint(leaf) {
  for (const { pattern, domain } of LEAF_DOMAIN_HINTS) {
    if (pattern.test(leaf)) return domain;
  }
  return null;
}

// Specific concepts Tailwind v4 doesn't expose as a token domain. Detecting
// them lets the no-mapping message say "opacity is applied via class
// modifiers" instead of just listing the canonical domain set.
function detectKnownNonDomain(segments) {
  const joined = segments.join(' ').toLowerCase();
  if (/\bopacity\b/.test(joined)) {
    return {
      concept: 'opacity',
      hint: 'Tailwind v4 has no "opacity" domain — opacity is applied via class modifiers (e.g. `bg-white/50`), not stored as variables. Consider deleting this variable if it isn\'t actively consumed by Tailwind utilities.',
    };
  }
  return null;
}

function titleCaseDomain(d) {
  return d.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join('');
}

function suggestTargetName(name) {
  const segments = name.split('/');
  if (segments.length < 2) return { name, kind: 'ok' };

  const collection = segments[0];
  const rest = segments.slice(1);
  const collNorm = normalizeCollectionName(collection);

  // (1) Collection is a TIER (Primitives, Semantic, …). Preserve tier,
  // ensure the first rest segment is a canonical domain, kebab the leaves.
  if (TIER_COLLECTIONS.has(collNorm)) {
    const firstRestClass = classifyDomain(rest[0]);
    let normalizedRest = [...rest];
    if (firstRestClass.kind === 'synonym') {
      normalizedRest[0] = firstRestClass.suggestion;
    } else if (firstRestClass.kind === 'typo' || firstRestClass.kind === 'unknown') {
      // Tier + unrecognized inner: can't auto-rename safely. Hint the user.
      return {
        name, kind: 'no-mapping',
        reason: `Inside the "${collection}" tier, the segment "${rest[0]}" doesn't match any Tailwind v4 domain (color, spacing, text, font, font-weight, tracking, leading, radius, shadow, breakpoint, ease, animate).`,
      };
    }
    const kebabRest = normalizedRest.map(s => toCase(s, 'kebab-case')).filter(Boolean).join('/');
    const target = kebabRest ? `${collection}/${kebabRest}` : collection;
    return target === name ? { name, kind: 'ok' } : { name, kind: 'rename', target };
  }

  // (2) Collection IS a Tailwind domain or its synonym. Preserve the
  // collection name verbatim (designer's casing choice) and kebab-case the
  // rest. A canonical "synonym" rename still suggests the canonical form.
  const collectionClass = classifyDomain(collNorm);
  if (collectionClass.kind === 'known' || collectionClass.kind === 'synonym') {
    const canonicalCollection = collectionClass.kind === 'synonym'
      ? titleCaseDomain(collectionClass.suggestion)
      : collection;
    const kebabRest = rest.map(s => toCase(s, 'kebab-case')).filter(Boolean).join('/');
    const target = kebabRest ? `${canonicalCollection}/${kebabRest}` : canonicalCollection;
    return target === name ? { name, kind: 'ok' } : { name, kind: 'rename', target };
  }

  // (3) Unknown collection. Walk rest looking for a domain hint. If found,
  // suggest MOVING the variable to a domain-named collection.
  let targetDomain = null;
  let domainIndex = -1;
  for (let i = 0; i < rest.length; i++) {
    const c = classifyDomain(rest[i]);
    if (c.kind === 'known' || c.kind === 'synonym') {
      targetDomain = c.kind === 'known' ? rest[i].toLowerCase() : c.suggestion;
      domainIndex = i;
      break;
    }
  }
  if (!targetDomain) {
    // No path-based domain hint, but check for known non-Tailwind concepts
    // (like opacity) so we can surface concept-specific guidance instead of
    // the generic "expected one of: ...".
    const knownConcept = detectKnownNonDomain(rest);
    return {
      name, kind: 'no-mapping',
      reason: knownConcept
        ? knownConcept.hint
        : `No Tailwind v4 domain found in path. Expected one of: ${TAILWIND_DOMAINS.join(', ')}. Consider whether this variable maps to one of those domains, or if it should be removed.`,
    };
  }
  const collectionTitle = titleCaseDomain(targetDomain);
  const kept = rest.filter((_, i) => i !== domainIndex);
  const kebabRest = kept.map(s => toCase(s, 'kebab-case')).filter(Boolean).join('/');
  const target = kebabRest ? `${collectionTitle}/${kebabRest}` : collectionTitle;

  // Detect ambiguity: the leaf's own keywords hint at a DIFFERENT domain
  // than the path-derived one. Common case: a letter-spacing variable filed
  // inside a "Line-Height" folder. Surface both options instead of
  // confidently picking the wrong target.
  const leaf = rest[rest.length - 1];
  const hint = leafHint(leaf);
  if (hint && hint !== targetDomain) {
    const altTitle = titleCaseDomain(hint);
    // Drop the leaf-keyword phrase from the alternate-collection rename so
    // it doesn't repeat itself. For "Letter Space 0" moved to Tracking,
    // the rename target inside Tracking should be just "0" — not
    // "letter-space-0" which would be redundant with the collection name.
    const stripped = leaf
      .toLowerCase()
      .replace(LEAF_DOMAIN_HINTS.find(h => h.domain === hint).pattern, '')
      .trim();
    const altLeaf = toCase(stripped, 'kebab-case') || toCase(leaf, 'kebab-case');
    const keptForAlt = kept.slice(0, -1).map(s => toCase(s, 'kebab-case')).filter(Boolean);
    const altPath = [...keptForAlt, altLeaf].filter(Boolean).join('/');
    const alternate = altPath ? `${altTitle}/${altPath}` : altTitle;
    return {
      name, kind: 'ambiguous', target, alternate,
      primaryReason: `path suggests ${targetDomain}`,
      alternateReason: `leaf "${leaf}" suggests ${hint}`,
    };
  }
  return { name, kind: 'rename', target };
}

function buildVariableSuggestions(varNames) {
  return varNames.map(suggestTargetName).filter(s => s.kind !== 'ok');
}

module.exports = {
  checkVariableNames, caseMatchesSegment, suggestName, toCase,
  checkVariableDomains, classifyDomain, collectionIsDomain,
  normalizeCollectionName, TAILWIND_DOMAINS,
  suggestTargetName, buildVariableSuggestions, TIER_COLLECTIONS,
};
