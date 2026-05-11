'use strict';

const { figmaToCssVar } = require('./name-normalizer');
const { valuesMatch } = require('./value-normalizer');

function inferDomain(token) {
  if (token.startsWith('color/') || token.includes('/color/')) return 'color';
  if (token.startsWith('space/') || token.includes('/space/')) return 'spacing';
  if (token.startsWith('radius/') || token.includes('/radius/')) return 'radius';
  if (token.startsWith('shadow/') || token.includes('/shadow/')) return 'shadow';
  if (token.startsWith('font/') || token.includes('/font/') ||
      token.includes('text-') || token.includes('line-height')) return 'typography';
  return 'unknown';
}

function strippedToken(figmaPath) {
  // Drop collection prefix; keep the rest as-is for human display.
  const segs = figmaPath.split('/');
  if (segs.length > 1) return segs.slice(1).join('/');
  return figmaPath;
}

function lookupLocal(theme, cssVar, mode) {
  // For semantic tokens with modes, look in light/dark; else look in primitives or exposure.
  if (mode === 'light') return theme.light?.[cssVar];
  if (mode === 'dark')  return theme.dark?.[cssVar];
  return theme.primitives?.[cssVar] ?? theme.exposure?.[cssVar];
}

function isLocalAlias(v) {
  return typeof v === 'string' && /^var\(--[A-Za-z0-9_-]+\)$/i.test(v.trim());
}

function isFigmaAlias(v) {
  return v != null && typeof v === 'object' && v.type === 'VARIABLE_ALIAS';
}

function compareOne(figmaPath, figmaValue, theme, mode) {
  const cssVar = figmaToCssVar(figmaPath);
  const token = strippedToken(figmaPath);
  const domain = inferDomain(token);
  const localValue = lookupLocal(theme, cssVar, mode);

  if (localValue === undefined || localValue === null) {
    return {
      token,
      status: 'missing',
      figma: figmaValue,
      local: null,
      mode,
      domain,
      hint: 'Run /adhd:pull-design-system to import this token.',
    };
  }
  // Both sides agree this is an alias relationship — no surface-value comparison
  // is meaningful. The primitive-level comparison catches real drift in the
  // underlying targets. Mixed alias-vs-literal still falls through to the value
  // comparison below (where it may produce a false-positive conflict until the
  // SKILL emits resolved figma values).
  if (isLocalAlias(localValue) && isFigmaAlias(figmaValue)) {
    return null;
  }
  if (valuesMatch(figmaValue, localValue, domain)) {
    return null; // same, no violation
  }
  return { token, status: 'conflict', figma: figmaValue, local: localValue, mode, domain };
}

function categorizeVariables(figmaVars, theme) {
  const out = [];
  for (const [figmaPath, value] of Object.entries(figmaVars)) {
    if (value && typeof value === 'object' && ('Light' in value || 'Dark' in value)) {
      // Semantic with modes
      if ('Light' in value) {
        const v = compareOne(figmaPath, value.Light, theme, 'light');
        if (v) out.push(v);
      }
      if ('Dark' in value) {
        const v = compareOne(figmaPath, value.Dark, theme, 'dark');
        if (v) out.push(v);
      }
    } else {
      // Primitive (no modes)
      const v = compareOne(figmaPath, value, theme, undefined);
      if (v) out.push(v);
    }
  }
  return out;
}

module.exports = { categorizeVariables };
