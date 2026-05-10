'use strict';

const DOMAIN_COLLECTION = {
  color: 'color',
  spacing: 'spacing',
  radius: 'radius',
  shadow: 'shadow',
  typography: 'typography',
};

const DOMAIN_PREFIX = {
  color: '--color-',
  spacing: '--spacing-',  // Matches Tailwind v4 (--spacing is the multiplier name).
  radius: '--radius-',
  shadow: '--shadow-',
  typography: '--font-',
};

// Convert dimension-bearing strings like "0.25rem" / "16px" / "1.5" → number (px).
// Returns null if the value is not a simple dimension/unitless number.
function dimensionToPx(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  // Reject expressions: calc(...), var(...), comma-separated lists, etc.
  if (/[(),]/.test(s)) return null;
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || '';
  if (unit === 'rem' || unit === 'em') return n * 16;
  return n; // px or unitless
}

// Decide the Figma variable type for a (domain, value) pair. Returns one of
// 'COLOR' | 'FLOAT' | 'STRING'. For aliases we trust the domain alone; literals
// dispatch on shape (numeric/dimension → FLOAT, anything else → STRING).
function figmaTypeForToken(domain, valueObj) {
  if (domain === 'color') return 'COLOR';
  // Aliases inherit the type of their domain (resolved later in Figma).
  if (valueObj && valueObj.type === 'alias') {
    if (domain === 'spacing' || domain === 'radius') return 'FLOAT';
    if (domain === 'typography') return 'FLOAT'; // best guess; STRING handled when literal
    return 'STRING';
  }
  // Literal dispatch
  const raw = valueObj && valueObj.type === 'literal' ? valueObj.value : null;
  if (raw == null) return 'STRING';
  if (domain === 'spacing' || domain === 'radius') {
    return dimensionToPx(raw) != null ? 'FLOAT' : 'STRING';
  }
  if (domain === 'typography') {
    // text/font-weight/leading/tracking can be numeric (FLOAT) or expression/string (STRING).
    return dimensionToPx(raw) != null ? 'FLOAT' : 'STRING';
  }
  return 'STRING';
}

// Resolve a literal value to the Figma-native scalar for FLOAT/STRING types.
// For COLOR we pass through and let the write script handle hex/oklch parsing.
function resolveFigmaValue(domain, valueObj) {
  if (!valueObj || valueObj.type !== 'literal') return null;
  if (domain === 'color') return valueObj.value;
  const px = dimensionToPx(valueObj.value);
  if (px != null) return px;
  return valueObj.value;
}

function pathToCssVar(domain, path) {
  // gold/100 → --color-gold-100
  // brand/surface → --brand-surface (semantic colors don't use the color- prefix)
  const dashed = path.replace(/\//g, '-');
  if (domain === 'color' && (dashed.startsWith('brand') || /^(background|foreground|text|surface|accent|border)$/i.test(path))) {
    return '--' + dashed;
  }
  return DOMAIN_PREFIX[domain] + dashed;
}

function buildFigmaActions(diff, resolutions, direction) {
  const resolutionMap = new Map();
  for (const r of resolutions) {
    resolutionMap.set(r.path + ':' + (r.mode ?? 'default'), r.winner);
  }

  if (direction === 'push') {
    const actions = [];
    // Code-only: create in Figma
    for (const t of diff.codeOnly) {
      // v1: skip shadow tokens — they're composite values that belong in
      // Figma effect styles, not variables. Emit a skip-shadow marker.
      if (t.domain === 'shadow') {
        // eslint-disable-next-line no-console
        console.warn('[adhd] Skipping shadow token "' + t.path + '" — shadows are deferred to effect styles in v2.');
        actions.push({
          kind: 'skip-shadow',
          path: t.path,
          reason: 'Shadow tokens are deferred (composite values; planned for v2 as Figma effect styles).',
        });
        continue;
      }
      // Pick a representative value to determine the Figma variable type.
      // Modes within a single token always share the same type.
      const repValue = t.values.default || t.values.light || Object.values(t.values)[0];
      const type = figmaTypeForToken(t.domain, repValue);
      // Pre-resolve literal values for FLOAT/STRING types so the write
      // script doesn't need to re-parse rem/em.
      const resolvedByMode = {};
      for (const [mode, val] of Object.entries(t.values)) {
        if (val.type === 'literal' && type !== 'COLOR') {
          resolvedByMode[mode] = resolveFigmaValue(t.domain, val);
        }
      }
      actions.push({
        kind: 'create-variable',
        collection: DOMAIN_COLLECTION[t.domain],
        path: t.path,
        domain: t.domain,
        type,
        valuesByMode: t.values,
        resolvedByMode,
      });
    }
    // Conflicts where user picked "code": overwrite Figma
    for (const c of diff.conflict) {
      const winner = resolutionMap.get(c.path + ':' + c.mode);
      if (winner === 'code') {
        const type = figmaTypeForToken(c.domain, c.code);
        const resolvedValue = c.code.type === 'literal' && type !== 'COLOR'
          ? resolveFigmaValue(c.domain, c.code)
          : null;
        actions.push({
          kind: 'update-variable',
          path: c.path,
          domain: c.domain,
          mode: c.mode,
          type,
          newValue: c.code,
          resolvedValue,
        });
      }
    }
    return actions;
  }

  if (direction === 'pull') {
    const actions = [];
    // Figma-only: add to code
    for (const t of diff.figmaOnly) {
      const cssVar = pathToCssVar(t.domain, t.path);
      const isPrimitive = ('default' in t.values);
      for (const [mode, val] of Object.entries(t.values)) {
        if (mode === 'default') {
          actions.push({
            kind: 'set-primitive',
            cssVar,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        } else {
          actions.push({
            kind: 'set-semantic',
            cssVar, mode,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        }
      }
    }
    // Conflicts where user picked "figma": overwrite code
    for (const c of diff.conflict) {
      const winner = resolutionMap.get(c.path + ':' + c.mode);
      if (winner === 'figma') {
        const cssVar = pathToCssVar(c.domain, c.path);
        const val = c.figma;
        if (c.mode === 'default') {
          actions.push({
            kind: 'set-primitive',
            cssVar,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        } else {
          actions.push({
            kind: 'set-semantic',
            cssVar, mode: c.mode,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? '--' + val.target.replace(/\//g, '-') : null,
          });
        }
      }
    }
    return actions;
  }

  throw new Error('Unknown direction: ' + direction);
}

module.exports = {
  buildFigmaActions,
  pathToCssVar,
  figmaTypeForToken,
  dimensionToPx,
  resolveFigmaValue,
};
