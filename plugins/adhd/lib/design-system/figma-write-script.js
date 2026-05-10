'use strict';

/**
 * JS string injected into use_figma. Reads `__ACTIONS__` (a JSON array
 * of { kind, ... }) and applies each one to the Figma file. Returns
 * { applied: [...], skipped: [...], errors: [...] }.
 *
 * The skill is responsible for substituting __ACTIONS__ with the
 * stringified actions JSON before passing to use_figma.
 *
 * The script handles three Figma variable types:
 *  - COLOR: hex (#rrggbb / #rrggbbaa) or oklch(...) → {r,g,b,a} 0–1.
 *  - FLOAT: numeric scalar (action.resolvedByMode[mode] already in px).
 *  - STRING: opaque string (font-family list, calc(...) expression, etc.).
 *
 * Shadow tokens are deferred (kind: 'skip-shadow') — they belong in Figma
 * effect styles, not variables, and are planned for v2.
 */
const WRITE_SCRIPT = `
const actions = __ACTIONS__;

const SCOPES = {
  color: ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'],
  spacing: ['GAP', 'WIDTH_HEIGHT'],
  radius: ['CORNER_RADIUS'],
  // Typography scopes vary by sub-family; we set permissive defaults and
  // narrow per token via tokenScopesFor().
  typography: ['ALL_SCOPES'],
};

// Narrow typography scopes from the Figma path (e.g. 'text/xs' → FONT_SIZE,
// 'font/sans' → FONT_FAMILY). Keep ALL_SCOPES as fallback.
function tokenScopesFor(domain, path) {
  if (domain !== 'typography') return SCOPES[domain] || ['ALL_SCOPES'];
  if (path.startsWith('text/')) return ['FONT_SIZE'];
  if (path.startsWith('font-weight/')) return ['FONT_WEIGHT'];
  if (path.startsWith('font/')) return ['FONT_FAMILY'];
  if (path.startsWith('leading/')) return ['LINE_HEIGHT'];
  if (path.startsWith('tracking/')) return ['LETTER_SPACING'];
  return ['ALL_SCOPES'];
}

// hex (#rgb / #rrggbb / #rrggbbaa) → {r,g,b,a} in 0–1.
function hexToRgb(h) {
  let c = h.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const r = parseInt(c.slice(0,2),16) / 255;
  const g = parseInt(c.slice(2,4),16) / 255;
  const b = parseInt(c.slice(4,6),16) / 255;
  const a = c.length === 8 ? parseInt(c.slice(6,8),16) / 255 : 1;
  return { r, g, b, a };
}

// oklch(L C H [ / A ]) → linear sRGB → gamma-corrected sRGB → {r,g,b,a} 0–1.
// Math kept inline so it runs in the Figma plugin sandbox (no require).
function oklchToRgb(input) {
  const m = /^oklch\\(\\s*([\\d.]+%?)\\s+([\\d.]+)\\s+([\\d.]+)\\s*(?:\\/\\s*([\\d.]+%?))?\\s*\\)$/.exec(input.trim());
  if (!m) throw new Error('Not an oklch string: ' + input);
  let L = parseFloat(m[1]); if (m[1].endsWith('%')) L = L / 100;
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  let A = 1;
  if (m[4]) { A = parseFloat(m[4]); if (m[4].endsWith('%')) A = A / 100; }
  const a_ = C * Math.cos(H * Math.PI / 180);
  const b_ = C * Math.sin(H * Math.PI / 180);
  const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
  const m2 = L - 0.1055613458 * a_ - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a_ - 1.2914855480 * b_;
  const l = l_ * l_ * l_;
  const m3 = m2 * m2 * m2;
  const s = s_ * s_ * s_;
  const lr =  4.0767416621 * l - 3.3077115913 * m3 + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m3 - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m3 + 1.7076147010 * s;
  const gamma = (x) => x >= 0.0031308 ? 1.055 * Math.pow(x, 1/2.4) - 0.055 : 12.92 * x;
  return {
    r: Math.max(0, Math.min(1, gamma(lr))),
    g: Math.max(0, Math.min(1, gamma(lg))),
    b: Math.max(0, Math.min(1, gamma(lb))),
    a: A,
  };
}

function parseColorString(raw) {
  const s = String(raw).trim();
  if (s.startsWith('#')) return hexToRgb(s);
  if (s.startsWith('oklch')) return oklchToRgb(s);
  // Fallback: treat as 6-char hex without #.
  if (/^[0-9a-fA-F]{6}$/.test(s)) return hexToRgb('#' + s);
  throw new Error('Unsupported color value: ' + raw);
}

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const collectionByName = {};
for (const c of collections) collectionByName[c.name] = c;

async function ensureCollection(name, withModes) {
  if (collectionByName[name]) return collectionByName[name];
  const col = figma.variables.createVariableCollection(name);
  if (withModes && withModes.length > 1) {
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
const skipped = [];
const errors = [];

for (const a of actions) {
  try {
    if (a.kind === 'skip-shadow') {
      skipped.push({ action: a, reason: a.reason || 'shadow deferred to v2' });
      continue;
    }
    if (a.kind === 'create-variable') {
      const modesNeeded = Object.keys(a.valuesByMode);
      const useModes = modesNeeded.includes('default') ? ['Mode 1'] : modesNeeded.map(m => m.charAt(0).toUpperCase() + m.slice(1));
      const col = await ensureCollection(a.collection, useModes);
      const figmaModeIds = {};
      for (const m of col.modes) figmaModeIds[m.name.toLowerCase()] = m.modeId;
      // Type: prefer explicit a.type from buildFigmaActions; fall back to
      // domain-based heuristic for backwards-compat.
      const type = a.type || (a.domain === 'color' ? 'COLOR' : 'FLOAT');
      const v = figma.variables.createVariable(a.path, col, type);
      v.scopes = tokenScopesFor(a.domain, a.path);
      for (const [mode, val] of Object.entries(a.valuesByMode)) {
        // mode=default means mode-independent: write to ALL modes of the
        // destination collection. Handles the case where a primitive (no modes
        // in code) is being added to an existing multi-mode collection.
        let targetModeIds;
        if (mode === 'default') {
          targetModeIds = col.modes.map(m => m.modeId);
        } else {
          const modeId = figmaModeIds[mode];
          if (!modeId) { errors.push({action: a, err: 'No mode ' + mode}); continue; }
          targetModeIds = [modeId];
        }
        if (val.type === 'literal') {
          let resolved;
          if (type === 'COLOR') {
            resolved = parseColorString(val.value);
          } else if (type === 'FLOAT') {
            // Prefer pre-resolved value (rem→px done in actions builder).
            resolved = a.resolvedByMode && (mode in a.resolvedByMode)
              ? Number(a.resolvedByMode[mode])
              : Number(String(val.value).replace(/px$/, ''));
            if (Number.isNaN(resolved)) {
              errors.push({action: a, err: 'Could not resolve FLOAT value: ' + val.value});
              continue;
            }
          } else {
            // STRING
            resolved = a.resolvedByMode && (mode in a.resolvedByMode)
              ? String(a.resolvedByMode[mode])
              : String(val.value);
          }
          for (const modeId of targetModeIds) {
            v.setValueForMode(modeId, resolved);
          }
        } else if (val.type === 'alias') {
          const target = await findVarByName(col, val.target);
          if (!target) { errors.push({action: a, err: 'Alias target not found: ' + val.target}); continue; }
          for (const modeId of targetModeIds) {
            v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
          }
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
      const type = a.type || (a.domain === 'color' ? 'COLOR' : 'FLOAT');
      if (a.newValue.type === 'literal') {
        let resolved;
        if (type === 'COLOR') {
          resolved = parseColorString(a.newValue.value);
        } else if (type === 'FLOAT') {
          resolved = a.resolvedValue != null
            ? Number(a.resolvedValue)
            : Number(String(a.newValue.value).replace(/px$/, ''));
          if (Number.isNaN(resolved)) {
            errors.push({action: a, err: 'Could not resolve FLOAT value: ' + a.newValue.value});
            continue;
          }
        } else {
          resolved = a.resolvedValue != null
            ? String(a.resolvedValue)
            : String(a.newValue.value);
        }
        v.setValueForMode(modeId, resolved);
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

return { applied, skipped, errors };
`;

module.exports = { WRITE_SCRIPT };
