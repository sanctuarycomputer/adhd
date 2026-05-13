'use strict';

const { pathToCssVar } = require('./figma-write-actions');

// CSS variable names are lossy: a Figma variable named `Color/gold-25`
// (single leaf with an internal hyphen) and one named `Color/gold/25`
// (two-segment path) both pull to `--color-gold-25` in globals.css.
// The path reconstruction on push always picks the slash interpretation
// (`gold/25`), so the same underlying variable looks like a fresh
// codeOnly token to the comparator and push would duplicate it in Figma.
// Canonicalize to the CSS-var form so both interpretations match.
function tokenCanonicalKey(t) {
  try { return pathToCssVar(t.domain, t.path); }
  catch { return null; }
}

// Same canonicalization for alias targets — Figma stores `target.name`
// verbatim ("neutral-0"), code stores the parsed path ("neutral/0"). They
// describe the same variable; collapse to a hyphenated form so a
// round-tripped alias compares equal regardless of which side authored it.
function canonicalizeAliasTarget(target) {
  if (target == null) return '';
  return String(target).replace(/\//g, '-').toLowerCase();
}

// Convert "0.25rem" / "16px" / "1.5" → number (px). Returns null if not a
// simple dimension/unitless number. Mirrors dimensionToPx in figma-write-actions.
function dimensionToPx(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/[(),]/.test(s)) return null;
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || '';
  if (unit === 'rem' || unit === 'em') return n * 16;
  return n;
}

// Expand short hex (#rgb / #rgba) to long form and lowercase. Returns null
// when the input isn't a recognizable hex color.
function normalizeHex(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s.startsWith('#')) return null;
  const hex = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return '#' + hex.split('').map(c => c + c).join('');
  }
  if (/^[0-9a-f]{4}$/.test(hex)) {
    return '#' + hex.split('').map(c => c + c).join('');
  }
  if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) return '#' + hex;
  return null;
}

// Canonicalize a literal value for cross-side comparison. Code stores raw CSS
// strings ("0.25rem", "#fff"); Figma stores numeric px ("4px" via figma-parser)
// or already-canonical hex. Without normalization the comparator would flag
// every such pair as a conflict even when the actual values agree.
function canonicalLiteral(raw) {
  if (raw == null) return '';
  const s = String(raw).trim().toLowerCase();
  const hex = normalizeHex(s);
  if (hex) return hex;
  const px = dimensionToPx(s);
  if (px != null) return px + 'px';
  return s;
}

function valuesEqual(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'alias') {
    return canonicalizeAliasTarget(a.target) === canonicalizeAliasTarget(b.target);
  }
  // literal
  return canonicalLiteral(a.value) === canonicalLiteral(b.value);
}

function tokenKey(t) {
  // Use domain:path as the unique identifier so radius/xs and shadow/xs
  // (different domains, same leaf path) don't collide in the map.
  return t.domain + ':' + t.path;
}

function compareDesignSystems(code, figma) {
  // `codeOnly` always surfaces every token from the code side, including
  // Tailwind defaults. Filtering by intent (push the palette vs only my
  // semantics) lives one layer up in the dispositions wizard — that's
  // where designer policy belongs. The `fromTailwindDefault` marker
  // travels through so the action builder can apply per-domain rules.
  const same = [];
  const conflict = [];
  const codeOnly = [];
  const figmaOnly = [];

  const codeByKey = new Map(code.tokens.map(t => [tokenKey(t), t]));
  const figmaByKey = new Map(figma.tokens.map(t => [tokenKey(t), t]));

  // Tokens that exist on both sides
  for (const [key, codeTok] of codeByKey) {
    const figmaTok = figmaByKey.get(key);
    const path = codeTok.path;
    if (!figmaTok) {
      codeOnly.push(codeTok);
      continue;
    }
    // Compare per mode
    const allModes = new Set([
      ...Object.keys(codeTok.values),
      ...Object.keys(figmaTok.values),
    ]);
    let anyConflict = false;
    let anySame = false;
    for (const mode of allModes) {
      const codeVal = codeTok.values[mode];
      const figmaVal = figmaTok.values[mode];
      if (codeVal && figmaVal) {
        if (valuesEqual(codeVal, figmaVal)) {
          anySame = true;
        } else {
          anyConflict = true;
          conflict.push({
            path, mode,
            domain: codeTok.domain,
            code: codeVal,
            figma: figmaVal,
          });
        }
      } else if (codeVal && !figmaVal) {
        anyConflict = true;
        conflict.push({
          path, mode,
          domain: codeTok.domain,
          code: codeVal,
          figma: null,
        });
      } else if (figmaVal && !codeVal) {
        anyConflict = true;
        conflict.push({
          path, mode,
          domain: codeTok.domain,
          code: null,
          figma: figmaVal,
        });
      }
    }
    if (anySame) {
      same.push(codeTok);
    }
  }

  // Tokens only on the figma side
  for (const [key, figmaTok] of figmaByKey) {
    if (!codeByKey.has(key)) {
      figmaOnly.push(figmaTok);
    }
  }

  // Reclaim cross-tokenization duplicates. The per-domain matching above
  // keys on `domain:path` with the literal path strings — `gold/25` and
  // `gold-25` are distinct keys even though they describe the same Figma
  // variable. Canonicalize both sides to the CSS-var form and pair them
  // up: any (codeOnly, figmaOnly) pair that resolves to the same CSS var
  // moves into `same`. Without this step, push would create a duplicate
  // variable in Figma every time pull pulled a single-leaf hyphenated name.
  const figmaByCanon = new Map();
  for (const t of figmaOnly) {
    const key = tokenCanonicalKey(t);
    if (key) figmaByCanon.set(key, t);
  }
  const survivedCodeOnly = [];
  const matchedFigma = new Set();
  for (const t of codeOnly) {
    const key = tokenCanonicalKey(t);
    if (key && figmaByCanon.has(key)) {
      same.push(t);
      matchedFigma.add(figmaByCanon.get(key));
    } else {
      survivedCodeOnly.push(t);
    }
  }
  const survivedFigmaOnly = figmaOnly.filter(t => !matchedFigma.has(t));

  // codeOnly carries everything — the dispositions wizard filters at the
  // action-builder layer. The `fromTailwindDefault` marker is preserved
  // on each token so domain-aware dispositions (color: semantic-only,
  // spacing: authored-only) can apply the right per-token rule.
  const filteredCodeOnly = survivedCodeOnly;

  // ── Effect styles ──────────────────────────────────────────────────────
  // Diff by name only. Each side may not have styles at all (older callers).
  // The full effect-payload comparison is intentionally not attempted: Figma
  // and code use different units / representations, and the push policy is
  // "additive" — we only need to know which names already exist to avoid
  // double-creating, and which names exist in code but not Figma to push.
  const codeEffects = (code.styles && code.styles.effects) || [];
  const figmaEffects = (figma.styles && figma.styles.effects) || [];
  const codeEffectNames = new Set(codeEffects.map(s => s.name));
  const figmaEffectNames = new Set(figmaEffects.map(s => s.name));
  const styles = {
    effects: {
      same: codeEffects.filter(s => figmaEffectNames.has(s.name)),
      codeOnly: codeEffects.filter(s => !figmaEffectNames.has(s.name)),
      figmaOnly: figmaEffects.filter(s => !codeEffectNames.has(s.name)),
    },
  };

  return { same, conflict, codeOnly: filteredCodeOnly, figmaOnly: survivedFigmaOnly, styles };
}

module.exports = { compareDesignSystems, valuesEqual };
