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

function compareDesignSystems(code, figma) {
  const same = [];
  const conflict = [];
  const codeOnly = [];
  const figmaOnly = [];

  const codeByPath = new Map(code.tokens.map(t => [t.path, t]));
  const figmaByPath = new Map(figma.tokens.map(t => [t.path, t]));

  // Tokens that exist on both sides
  for (const [path, codeTok] of codeByPath) {
    const figmaTok = figmaByPath.get(path);
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
  for (const [path, figmaTok] of figmaByPath) {
    if (!codeByPath.has(path)) {
      figmaOnly.push(figmaTok);
    }
  }

  return { same, conflict, codeOnly, figmaOnly };
}

module.exports = { compareDesignSystems, valuesEqual };
