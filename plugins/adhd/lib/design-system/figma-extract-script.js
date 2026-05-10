'use strict';

/**
 * JS string injected into use_figma. Returns the full design-system
 * state of the file: every variable in every collection (with its
 * per-mode values), every effect style, every text style.
 */
const EXTRACT_SCRIPT = `
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const colOut = [];
for (const c of collections) {
  const modes = c.modes.map(m => ({ id: m.modeId, name: m.name }));
  const vars = [];
  for (const vid of c.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (!v) continue;
    const valuesByMode = {};
    for (const m of c.modes) {
      const raw = v.valuesByMode[m.modeId];
      if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
        const target = await figma.variables.getVariableByIdAsync(raw.id);
        valuesByMode[m.name] = { kind: 'alias', targetName: target ? target.name : null, targetId: raw.id };
      } else if (raw && typeof raw === 'object' && 'r' in raw) {
        valuesByMode[m.name] = { kind: 'color', r: raw.r, g: raw.g, b: raw.b, a: 'a' in raw ? raw.a : 1 };
      } else {
        valuesByMode[m.name] = { kind: 'literal', value: raw };
      }
    }
    vars.push({
      id: v.id, name: v.name, resolvedType: v.resolvedType,
      scopes: v.scopes, valuesByMode,
    });
  }
  colOut.push({ id: c.id, name: c.name, modes, variables: vars });
}

const effectStyles = (await figma.getLocalEffectStylesAsync()).map(s => ({
  id: s.id, name: s.name, effects: s.effects,
}));
const textStyles = (await figma.getLocalTextStylesAsync()).map(s => ({
  id: s.id, name: s.name,
  fontName: s.fontName, fontSize: s.fontSize,
  lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
}));

return { collections: colOut, effectStyles, textStyles };
`;

module.exports = { EXTRACT_SCRIPT };
