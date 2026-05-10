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
  spacing: '--space-',
  radius: '--radius-',
  shadow: '--shadow-',
  typography: '--font-',
};

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
      actions.push({
        kind: 'create-variable',
        collection: DOMAIN_COLLECTION[t.domain],
        path: t.path,
        domain: t.domain,
        valuesByMode: t.values,
      });
    }
    // Conflicts where user picked "code": overwrite Figma
    for (const c of diff.conflict) {
      const winner = resolutionMap.get(c.path + ':' + c.mode);
      if (winner === 'code') {
        actions.push({
          kind: 'update-variable',
          path: c.path,
          domain: c.domain,
          mode: c.mode,
          newValue: c.code,
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

module.exports = { buildFigmaActions, pathToCssVar };
