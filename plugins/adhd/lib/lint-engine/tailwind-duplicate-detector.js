'use strict';

// STRUCT013 — Figma variable duplicates a Tailwind v4 default.
//
// After a designer has pushed the full Tailwind token system into Figma,
// they may have legacy custom variables sitting alongside the canonical
// Tailwind ones with the same value. STRUCT013 surfaces those duplicates
// so designers (or `/adhd:lint --fix`) can rebind every layer that uses
// the duplicate to the canonical Tailwind variable, then delete the
// duplicate.
//
// **Strict match only.** Both the variable's NORMALIZED NAME and its
// VALUE must align with a Tailwind default — value-only matches like
// `Color/MyZinc = #71717a` happening to equal `--color-zinc-500` would
// trample the designer's semantic intent (e.g. "this is my brand's zinc,
// not a generic gray-500"). Strict mode trades recall for precision.
//
// Tier collections (Primitives / Semantic / Tokens / Base / Theme) are
// invisible — `Primitives/color/zinc/500` matches `--color-zinc-500`
// just like `Color/zinc-500` does. Same convention STRUCT011 uses.

const { TIER_COLLECTIONS, normalizeCollectionName } = require('./variable-namer');

function toKebab(seg) {
  return seg
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .replace(/([0-9])([a-zA-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

// `<collection>/<...rest>` → kebab-flat name, with tier collections
// stripped. `Color/zinc-500` → `color-zinc-500`. `Primitives/color/zinc/500`
// → `color-zinc-500`. Returns null when there's no rest segment to
// normalize.
function normalizeFigmaVarName(name) {
  if (!name || typeof name !== 'string') return null;
  const segments = name.split('/');
  if (segments.length < 2) return null;
  const collection = segments[0];
  const collNorm = normalizeCollectionName(collection);
  const path = TIER_COLLECTIONS.has(collNorm) ? segments.slice(1) : segments;
  const kebab = path.map(toKebab).filter(Boolean).join('-');
  return kebab || null;
}

function normalizeCssVarName(cssVar) {
  if (!cssVar) return null;
  return cssVar.replace(/^--/, '').toLowerCase();
}

// Cheap string parity for high-confidence equality. Resolved values from
// the SKILL's serializer arrive as strings (`'#71717a'`, `'0.25rem'`,
// `'oklch(0.62 0.18 264)'`). Lowercase, collapse internal whitespace.
// False negatives here are fine — strict mode favors precision; if a
// match is missed, the variable still shows up as a normal (non-STRUCT013)
// variable and nothing bad happens.
function normalizeValue(v) {
  if (v == null) return null;
  if (typeof v !== 'string') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return v.trim().toLowerCase().replace(/\s+/g, '');
}

// Returns an array of { figmaName, normalizedName, value, tailwindCssVar }
// for every Figma variable whose normalized name AND value match a
// Tailwind v4 default primitive.
//
// `varDefs`: { '<collection>/<name>': '<resolvedValue>' } — from the
//   lint SKILL's serializer (or MCP `get_variable_defs`).
// `tailwindDefaults`: { '--<cssVarName>': '<value>' } — from
//   parseTheme(tailwind-defaults.css).primitives.
function detectTailwindDuplicates(varDefs, tailwindDefaults) {
  if (!varDefs || !tailwindDefaults) return [];
  const twByNorm = new Map();
  for (const [cssVar, value] of Object.entries(tailwindDefaults)) {
    const norm = normalizeCssVarName(cssVar);
    if (!norm) continue;
    twByNorm.set(norm, { cssVar: '--' + norm, value: normalizeValue(value) });
  }
  const out = [];
  for (const [figmaName, value] of Object.entries(varDefs)) {
    const norm = normalizeFigmaVarName(figmaName);
    if (!norm) continue;
    const tw = twByNorm.get(norm);
    if (!tw) continue;
    if (tw.value !== normalizeValue(value)) continue;
    out.push({
      figmaName,
      normalizedName: norm,
      value,
      tailwindCssVar: tw.cssVar,
    });
  }
  return out;
}

module.exports = {
  detectTailwindDuplicates,
  normalizeFigmaVarName,
  normalizeCssVarName,
  normalizeValue,
};
