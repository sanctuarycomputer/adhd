'use strict';

function valuesEqual(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'alias') {
    return a.target === b.target;
  }
  // literal
  const av = String(a.value).toLowerCase();
  const bv = String(b.value).toLowerCase();
  return av === bv;
}

function tokenKey(t) {
  // Use domain:path as the unique identifier so radius/xs and shadow/xs
  // (different domains, same leaf path) don't collide in the map.
  return t.domain + ':' + t.path;
}

function compareDesignSystems(code, figma) {
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

  return { same, conflict, codeOnly, figmaOnly, styles };
}

module.exports = { compareDesignSystems, valuesEqual };
