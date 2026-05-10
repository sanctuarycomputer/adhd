'use strict';

/**
 * JS string injected into use_figma. Reads `__ACTIONS__` (a JSON array
 * of { kind, ... }) and applies each one to the Figma file. Returns
 * { applied: [...], skipped: [...], errors: [...] }.
 *
 * The skill is responsible for substituting __ACTIONS__ with the
 * stringified actions JSON before passing to use_figma.
 */
const WRITE_SCRIPT = `
const actions = __ACTIONS__;

const SCOPES = {
  color: ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'],
  spacing: ['GAP', 'WIDTH_HEIGHT'],
  radius: ['CORNER_RADIUS'],
  typography: ['FONT_SIZE'],
};

function hex(h) {
  const c = h.replace('#', '');
  const r = parseInt(c.slice(0,2),16) / 255;
  const g = parseInt(c.slice(2,4),16) / 255;
  const b = parseInt(c.slice(4,6),16) / 255;
  return { r, g, b };
}

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const collectionByName = {};
for (const c of collections) collectionByName[c.name] = c;

async function ensureCollection(name, withModes) {
  if (collectionByName[name]) return collectionByName[name];
  const col = figma.variables.createVariableCollection(name);
  if (withModes && withModes.length > 1) {
    // Default has 1 mode; rename it and add the rest
    col.renameMode(col.modes[0].modeId, withModes[0]);
    for (let i = 1; i < withModes.length; i++) {
      col.addMode(withModes[i]);
    }
  } else if (withModes && withModes.length === 1) {
    col.renameMode(col.modes[0].modeId, withModes[0]);
  }
  collectionByName[name] = col;
  return col;
}

async function findVarByName(col, name) {
  for (const vid of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (v && v.name === name) return v;
  }
  return null;
}

const applied = [];
const errors = [];

for (const a of actions) {
  try {
    if (a.kind === 'create-variable') {
      const modesNeeded = Object.keys(a.valuesByMode);
      const useModes = modesNeeded.includes('default') ? ['Mode 1'] : modesNeeded.map(m => m.charAt(0).toUpperCase() + m.slice(1));
      const col = await ensureCollection(a.collection, useModes);
      const figmaModeIds = {};
      for (const m of col.modes) figmaModeIds[m.name.toLowerCase()] = m.modeId;
      const type = a.domain === 'color' ? 'COLOR' : 'FLOAT';
      const v = figma.variables.createVariable(a.path, col, type);
      v.scopes = SCOPES[a.domain] || ['ALL_SCOPES'];
      for (const [mode, val] of Object.entries(a.valuesByMode)) {
        const modeId = figmaModeIds[mode === 'default' ? 'mode 1' : mode];
        if (!modeId) { errors.push({action: a, err: 'No mode ' + mode}); continue; }
        if (val.type === 'literal') {
          const v2 = a.domain === 'color' ? hex(val.value) : Number(val.value.toString().replace(/px$/, ''));
          v.setValueForMode(modeId, v2);
        } else if (val.type === 'alias') {
          const target = await findVarByName(col, val.target);
          if (!target) { errors.push({action: a, err: 'Alias target not found: ' + val.target}); continue; }
          v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
        }
      }
      applied.push(a);
    } else if (a.kind === 'update-variable') {
      // Find the variable across collections
      let v = null;
      for (const c of collections) {
        v = await findVarByName(c, a.path);
        if (v) break;
      }
      if (!v) { errors.push({action: a, err: 'Variable not found: ' + a.path}); continue; }
      const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      const modeId = col.modes.find(m => m.name.toLowerCase() === a.mode || (a.mode === 'default' && m.name === 'Mode 1'))?.modeId;
      if (!modeId) { errors.push({action: a, err: 'Mode not found: ' + a.mode}); continue; }
      if (a.newValue.type === 'literal') {
        const v2 = a.domain === 'color' ? hex(a.newValue.value) : Number(a.newValue.value.toString().replace(/px$/, ''));
        v.setValueForMode(modeId, v2);
      } else if (a.newValue.type === 'alias') {
        const target = await findVarByName(col, a.newValue.target);
        if (!target) { errors.push({action: a, err: 'Alias target not found: ' + a.newValue.target}); continue; }
        v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
      }
      applied.push(a);
    } else {
      errors.push({action: a, err: 'Unknown kind: ' + a.kind});
    }
  } catch (err) {
    errors.push({action: a, err: err.message});
  }
}

return { applied, errors };
`;

module.exports = { WRITE_SCRIPT };
