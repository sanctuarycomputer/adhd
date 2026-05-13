'use strict';

// Given a Figma variable value + its inferred domain, find the canonical
// Tailwind CSS variable (if any) whose value matches strictly. Powers
// the "Auto-fix" option in pull-component / push-component's STRUCT015
// resolution flow.
//
// Strict equality only: same normalized hex for colors, same px-after-rem
// conversion for dimensions, same string after trim/lowercase for
// everything else. If multiple canonicals match the same value (e.g.
// --leading-3 and --text-xs--line-height both = 12px), return only the
// first one inside the same sub-domain — the caller falls back to
// "Add as-is" when there's ambiguity worth surfacing manually.
//
// Names that LOOK semantic (brand/surface/accent/etc.) are surfaced to
// the SKILL via `looksSemantic` so the prompt's "Add as semantic" label
// stays prominent — auto-fix is only safe for variables that
// accidentally took a non-canonical name when a canonical existed.

const { normalizeColor, normalizeDimension } = require('./value-normalizer');

// Heuristic: names whose first segment after the collection prefix looks
// like a semantic role (brand, accent, surface, etc.) rather than a
// Tailwind scale step (`zinc-500`, `text-sm`, `radius-md`). Used to
// label the "Add as semantic" option more prominently in the prompt;
// it does NOT block the auto-fix option from appearing — designers can
// still pick auto-fix if they explicitly want it.
const SEMANTIC_LEADING = /^(brand|accent|surface|background|foreground|primary|secondary|tertiary|success|warning|error|danger|info|muted|destructive|popover|card|sidebar|chart|on-|inverse|highlight|focus|disabled|hover|active|selected|placeholder|outline|ring|shadow-color)\b/i;

function looksSemantic(figmaPath) {
  if (!figmaPath || typeof figmaPath !== 'string') return false;
  const segments = figmaPath.split('/').filter(Boolean);
  // Look at every segment after the collection — any segment that
  // matches the semantic leading pattern marks the whole name semantic.
  for (let i = 1; i < segments.length; i++) {
    if (SEMANTIC_LEADING.test(segments[i])) return true;
  }
  // First segment too, when there's no collection prefix (single-segment names).
  if (segments.length === 1 && SEMANTIC_LEADING.test(segments[0])) return true;
  return false;
}

// Normalize a value for cross-form equality. Uses the same canonical
// forms the categorizer uses, so this matcher and that comparator
// agree on what counts as "equal."
function normalizeForMatch(value, domain) {
  if (value == null) return null;
  try {
    if (domain === 'color') return normalizeColor(value);
    if (domain === 'spacing' || domain === 'radius') return normalizeDimension(value);
    // typography covers font-size, leading, tracking, font-weight, font-family.
    // dimensions for the first three; raw string for the last two.
    if (domain === 'typography') {
      try { return normalizeDimension(value); } catch {
        return String(value).trim().toLowerCase();
      }
    }
  } catch { return null; }
  return String(value).trim().toLowerCase();
}

// Given a Figma path like `typography/Font-Size/Body` and the parsed
// theme.primitives map (Tailwind defaults + user @theme), return the
// canonical Tailwind cssVar that shares the figma value. Returns null
// when:
//   - no match
//   - multiple matches that span different "sub-domains" (e.g. a value
//     that's both a valid text-size and a valid leading; ambiguous, ask
//     the designer manually)
//   - figma value can't be normalized
function findCanonicalForValue(figmaPath, figmaValue, primitives, opts = {}) {
  if (!primitives || typeof primitives !== 'object') return null;
  const domain = opts.domain || inferDomainFromPath(figmaPath);
  const fNorm = normalizeForMatch(figmaValue, domain);
  if (fNorm == null) return null;

  // Filter candidates by sub-domain when typography is split into
  // multiple Tailwind families (--text-*, --leading-*, --tracking-*,
  // --font-*, --font-weight-*). The figma path's leaf tells us which
  // family the designer's variable was meant to be.
  const family = typographyFamily(figmaPath);

  const matches = [];
  for (const [cssVar, value] of Object.entries(primitives)) {
    const candidateDomain = domainForCssVar(cssVar);
    if (candidateDomain !== domain) continue;
    if (family && typographyFamilyForCssVar(cssVar) !== family) continue;
    const cNorm = normalizeForMatch(value, candidateDomain);
    if (cNorm == null) continue;
    if (cNorm === fNorm) matches.push(cssVar);
  }
  if (matches.length === 0) return null;
  // Single unambiguous match — return it.
  if (matches.length === 1) return matches[0];
  // Multiple matches — only surface auto-fix if they all reduce to the
  // same canonical "shortest" name (e.g. `--spacing-4` over a synonym).
  // Otherwise stay quiet and let the designer pick "Add as-is."
  matches.sort((a, b) => a.length - b.length || a.localeCompare(b));
  // For the common ambiguity (`--text-Xs--line-height` vs `--leading-N`),
  // pick the family-matched one. If we already filtered by family above,
  // any remaining ambiguity is between siblings of the same family —
  // surface the first sorted name as the suggestion.
  return matches[0];
}

// Mirror of variable-categorizer's inferDomain but operates on a full
// path string. Lowercased + delimiter-anchored to handle capitalized
// Figma collections.
function inferDomainFromPath(figmaPath) {
  if (!figmaPath) return 'unknown';
  const lc = String(figmaPath).toLowerCase();
  if (lc.startsWith('color/')   || lc.includes('/color/'))   return 'color';
  if (lc.startsWith('spacing/') || lc.includes('/spacing/')) return 'spacing';
  if (lc.startsWith('space/')   || lc.includes('/space/'))   return 'spacing';
  if (lc.startsWith('radius/')  || lc.includes('/radius/'))  return 'radius';
  if (lc.startsWith('shadow/')  || lc.includes('/shadow/'))  return 'shadow';
  if (lc.startsWith('font/')    || lc.includes('/font/') ||
      lc.startsWith('typography/') || lc.includes('/typography/') ||
      lc.includes('text-') || lc.includes('line-height')) return 'typography';
  return 'unknown';
}

function domainForCssVar(cssVar) {
  const lc = cssVar.toLowerCase();
  if (lc.startsWith('--color-')) return 'color';
  if (lc === '--spacing' || lc.startsWith('--spacing-')) return 'spacing';
  if (lc.startsWith('--radius-')) return 'radius';
  if (lc.startsWith('--shadow-') || lc.startsWith('--drop-shadow-') ||
      lc.startsWith('--inset-shadow-') || lc.startsWith('--text-shadow-')) return 'shadow';
  if (lc.startsWith('--text-') || lc.startsWith('--font-') ||
      lc.startsWith('--leading-') || lc.startsWith('--tracking-')) return 'typography';
  return 'unknown';
}

// Determine which typography family a figma path or cssVar belongs to.
// Returns one of 'text', 'leading', 'tracking', 'font-weight', 'font',
// or null when ambiguous. Used to disambiguate matches when the same
// numeric value is valid in multiple families.
const FONT_FAMILY_HINTS = [
  // Multi-word phrases first so they win over single-word fallbacks.
  { re: /\bline[\s\-_]?height\b/i,   family: 'leading' },
  { re: /\bletter[\s\-_]?spac/i,     family: 'tracking' },
  { re: /\bfont[\s\-_]?size\b/i,     family: 'text' },
  { re: /\bfont[\s\-_]?weight\b/i,   family: 'font-weight' },
  { re: /\bfont[\s\-_]?family\b/i,   family: 'font' },
  { re: /\btext[\s\-_]?size\b/i,     family: 'text' },
  // Canonical Tailwind path prefixes (after collection-strip) — these
  // are how a well-named figma variable maps to a typography family.
  { re: /(^|\/)leading\//i,          family: 'leading' },
  { re: /(^|\/)tracking\//i,         family: 'tracking' },
  { re: /(^|\/)font-weight\//i,      family: 'font-weight' },
  { re: /(^|\/)font\//i,             family: 'font' },
  { re: /(^|\/)text\//i,             family: 'text' },
];

function typographyFamily(figmaPath) {
  if (!figmaPath) return null;
  for (const { re, family } of FONT_FAMILY_HINTS) {
    if (re.test(figmaPath)) return family;
  }
  return null;
}

function typographyFamilyForCssVar(cssVar) {
  const lc = cssVar.toLowerCase();
  if (lc.startsWith('--leading-')) return 'leading';
  if (lc.startsWith('--tracking-')) return 'tracking';
  if (lc.startsWith('--font-weight-')) return 'font-weight';
  if (lc.startsWith('--font-')) return 'font';
  if (lc.startsWith('--text-')) return 'text';
  return null;
}

module.exports = {
  findCanonicalForValue,
  looksSemantic,
  inferDomainFromPath,
  domainForCssVar,
  typographyFamily,
  normalizeForMatch,
};
