'use strict';

function colorToHex({ r, g, b, a }) {
  const to2 = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  let hex = '#' + to2(r) + to2(g) + to2(b);
  if (a !== undefined && a < 1) hex += to2(a);
  return hex.toLowerCase();
}

// Mirrors DOMAIN_COLLECTION in figma-write-actions.js — both sides must agree
// on the set of collections the engine cares about, otherwise variables we
// push end up parsed as `unknown` and re-surface as codeOnly on the next run.
const COLLECTION_DOMAIN = {
  color: 'color',
  spacing: 'spacing',
  radius: 'radius',
  shadow: 'shadow',
  typography: 'typography',
  opacity: 'opacity',
  'border-width': 'border-width',
  'z-index': 'z-index',
  breakpoint: 'breakpoint',
  container: 'container',
  blur: 'blur',
  perspective: 'perspective',
  aspect: 'aspect',
  ease: 'ease',
  animate: 'animate',
};

function inferDomain(collectionName) {
  return COLLECTION_DOMAIN[collectionName.toLowerCase()] || 'unknown';
}

function modeNameToCanonical(figmaModeName, isMultiMode) {
  if (!isMultiMode) return 'default';
  const lc = figmaModeName.toLowerCase();
  if (lc === 'light') return 'light';
  if (lc === 'dark')  return 'dark';
  return lc;
}

function valueFromFigma(rawByMode) {
  if (rawByMode.kind === 'alias') {
    return { type: 'alias', target: rawByMode.targetName ?? '<unknown>' };
  }
  if (rawByMode.kind === 'color') {
    return { type: 'literal', value: colorToHex(rawByMode) };
  }
  if (rawByMode.kind === 'literal') {
    const v = rawByMode.value;
    if (typeof v === 'number') return { type: 'literal', value: String(v) + 'px' };
    return { type: 'literal', value: String(v) };
  }
  return { type: 'literal', value: String(rawByMode) };
}

function parseFigmaDesignSystem(extract) {
  const tokens = [];
  for (const col of extract.collections) {
    const domain = inferDomain(col.name);
    if (domain === 'unknown') continue;
    const isMultiMode = col.modes.length > 1;
    for (const v of col.variables) {
      let values = {};
      for (const [modeName, rawByMode] of Object.entries(v.valuesByMode)) {
        const canonical = modeNameToCanonical(modeName, isMultiMode);
        values[canonical] = valueFromFigma(rawByMode);
      }
      // Collapse a multi-mode collection's variable to `default` if all modes hold
      // the same value. This mirrors how primitives are represented in code:
      // `@theme { --color-gold-100: #faf0c5 }` is mode-independent; in Figma we
      // store it in every mode of the multi-mode collection with identical values.
      const modeKeys = Object.keys(values);
      if (modeKeys.length > 1) {
        const first = JSON.stringify(values[modeKeys[0]]);
        const allSame = modeKeys.every(k => JSON.stringify(values[k]) === first);
        if (allSame) {
          values = { default: JSON.parse(first) };
        }
      }
      tokens.push({
        domain,
        path: v.name,
        values,
        figmaId: v.id,
        scopes: v.scopes,
      });
    }
  }

  return {
    tokens,
    exposure: [], // Figma has no exposure concept
    styles: {
      effects: extract.effectStyles ?? [],
      text:    extract.textStyles ?? [],
    },
  };
}

module.exports = { parseFigmaDesignSystem, colorToHex };
