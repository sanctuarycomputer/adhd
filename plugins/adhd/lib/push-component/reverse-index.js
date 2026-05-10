'use strict';

function colorKey({ r, g, b, a }) {
  // Round to 2 decimals to tolerate 8-bit/float quantization drift
  // (e.g. 250/255 = 0.9803921 vs 0.98). The plan documented this as
  // "~3-decimal drift" but the canonical drift case is 2-decimal-equivalent.
  const to2 = (n) => Math.round(n * 100) / 100;
  return [to2(r), to2(g), to2(b), to2(a ?? 1)].join(',');
}

function buildReverseIndex(extract) {
  const index = {
    color: new Map(),      // colorKey → { id, name }
    spacing: new Map(),    // number (px) → { id, name }
    radius: new Map(),
    typography: new Map(), // for font-size matches
    blur: new Map(),
    'border-width': new Map(),
    opacity: new Map(),
  };
  for (const c of extract.collections) {
    if (!index[c.name]) continue;
    for (const v of c.variables) {
      for (const mv of Object.values(v.valuesByMode)) {
        if (mv.kind === 'color') {
          index.color.set(colorKey(mv), { id: v.id, name: v.name });
        } else if (mv.kind === 'literal' && typeof mv.value === 'number') {
          index[c.name].set(mv.value, { id: v.id, name: v.name });
        }
        // Aliases are not added — they point at the underlying primitive,
        // which is already indexed via its own color/literal entry.
      }
    }
  }
  return index;
}

function lookupColor(index, rgba) {
  return index.color.get(colorKey(rgba)) || null;
}

function lookupNumber(index, domain, n) {
  if (!index[domain]) return null;
  return index[domain].get(n) || null;
}

module.exports = { buildReverseIndex, lookupColor, lookupNumber };
