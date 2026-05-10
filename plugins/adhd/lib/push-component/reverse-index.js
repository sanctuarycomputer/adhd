'use strict';

function colorKey({ r, g, b, a }) {
  // Round to 2 decimals to tolerate 8-bit/float quantization drift
  // (e.g. 250/255 = 0.9803921 vs 0.98). The plan documented this as
  // "~3-decimal drift" but the canonical drift case is 2-decimal-equivalent.
  const to2 = (n) => Math.round(n * 100) / 100;
  return [to2(r), to2(g), to2(b), to2(a ?? 1)].join(',');
}

function effectSignature(effect) {
  // Stable signature for a single effect. 2-decimal quantization handles
  // Figma's 8-bit float drift the same way colorKey does.
  const to2 = (n) => Math.round(n * 100) / 100;
  const c = effect.color || { r: 0, g: 0, b: 0, a: 1 };
  const o = effect.offset || { x: 0, y: 0 };
  return [
    effect.type,
    to2(c.r), to2(c.g), to2(c.b), to2(c.a ?? 1),
    to2(o.x), to2(o.y),
    to2(effect.radius ?? 0),
    to2(effect.spread ?? 0),
  ].join('|');
}

function effectsArraySignature(effects) {
  return (effects || []).map(effectSignature).join(';;');
}

function buildReverseIndex(extract) {
  const index = {
    color: new Map(),       // colorKey → { id, name }
    color_rgba: [],         // [{ rgba, id, name }] for fuzzy distance lookup
    spacing: new Map(),     // number (px) → { id, name }
    radius: new Map(),
    typography: new Map(),  // font-size matches
    blur: new Map(),
    'border-width': new Map(),
    opacity: new Map(),
    effects: new Map(),     // effectsArraySignature → { id, name }  (effect styles)
  };
  for (const c of extract.collections || []) {
    if (!index[c.name]) continue;
    for (const v of c.variables) {
      for (const mv of Object.values(v.valuesByMode)) {
        if (mv.kind === 'color') {
          index.color.set(colorKey(mv), { id: v.id, name: v.name });
          index.color_rgba.push({
            rgba: { r: mv.r, g: mv.g, b: mv.b, a: mv.a ?? 1 },
            id: v.id,
            name: v.name,
          });
        } else if (mv.kind === 'literal' && typeof mv.value === 'number') {
          index[c.name].set(mv.value, { id: v.id, name: v.name });
        }
        // Aliases are not added — they point at the underlying primitive,
        // which is already indexed via its own color/literal entry.
      }
    }
  }
  for (const s of extract.effectStyles || []) {
    const sig = effectsArraySignature(s.effects);
    if (sig) index.effects.set(sig, { id: s.id, name: s.name });
  }
  return index;
}

function lookupColor(index, rgba) {
  return index.color.get(colorKey(rgba)) || null;
}

function lookupColorFuzzy(index, rgba, threshold = 0.02) {
  let best = null;
  let bestDist = Infinity;
  const a = rgba.a ?? 1;
  for (const entry of index.color_rgba) {
    const da = (entry.rgba.a ?? 1) - a;
    const dr = entry.rgba.r - rgba.r;
    const dg = entry.rgba.g - rgba.g;
    const db = entry.rgba.b - rgba.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db + da * da);
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist;
      best = entry;
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

function lookupNumber(index, domain, n) {
  if (!index[domain]) return null;
  return index[domain].get(n) || null;
}

function lookupEffect(index, effects) {
  const sig = effectsArraySignature(effects);
  return index.effects.get(sig) || null;
}

module.exports = {
  buildReverseIndex,
  lookupColor,
  lookupColorFuzzy,
  lookupNumber,
  lookupEffect,
  effectsArraySignature,
};
