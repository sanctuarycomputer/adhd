'use strict';

// Extracts a single @theme block's body, or null. Brace-balanced across nested objects.
function extractAllThemeBodies(css) {
  const bodies = [];
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf('@theme', i);
    if (idx === -1) break;
    // Skip whitespace + optional modifiers like @theme inline
    let j = idx + '@theme'.length;
    while (j < css.length && css[j] !== '{' && css[j] !== ';') j++;
    if (css[j] !== '{') { i = j + 1; continue; }
    // Brace-balanced scan
    let depth = 1;
    let k = j + 1;
    while (k < css.length && depth > 0) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
      if (depth > 0) k++;
    }
    bodies.push(css.slice(j + 1, k));
    i = k + 1;
  }
  return bodies;
}

const DECL_RE = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

function classify(name) {
  if (name.startsWith('color-')) return { domain: 'colors', leaf: name.slice('color-'.length) };
  if (name === 'spacing') return { domain: 'spacing', leaf: null };
  if (name.startsWith('text-')) {
    // text-xs or text-xs--line-height
    const rest = name.slice('text-'.length);
    const lhIdx = rest.indexOf('--line-height');
    if (lhIdx >= 0) return { domain: 'typography', leaf: rest.slice(0, lhIdx), kind: 'lineHeight' };
    return { domain: 'typography', leaf: rest, kind: 'size' };
  }
  if (name.startsWith('radius-')) return { domain: 'radius', leaf: name.slice('radius-'.length) };
  if (name.startsWith('shadow-')) return { domain: 'shadows', leaf: name.slice('shadow-'.length) };
  return { domain: 'unknown' };
}

function parseTokens(globalsCss) {
  const out = {
    colors: [],
    spacing: { multiplier: null },
    typography: [], // [{ name, size, lineHeight }]
    radius: [],
    shadows: [],
    unknown: [],
  };
  const typographyByName = new Map();

  for (const body of extractAllThemeBodies(globalsCss)) {
    DECL_RE.lastIndex = 0;
    let m;
    while ((m = DECL_RE.exec(body)) !== null) {
      const name = m[1];
      const value = m[2].trim();
      const cls = classify(name);
      if (cls.domain === 'colors') {
        out.colors.push({ name: cls.leaf, value });
      } else if (cls.domain === 'spacing') {
        out.spacing.multiplier = value;
      } else if (cls.domain === 'typography') {
        let row = typographyByName.get(cls.leaf);
        if (!row) {
          row = { name: cls.leaf, size: null, lineHeight: null };
          typographyByName.set(cls.leaf, row);
          out.typography.push(row);
        }
        if (cls.kind === 'lineHeight') row.lineHeight = value;
        else row.size = value;
      } else if (cls.domain === 'radius') {
        out.radius.push({ name: cls.leaf, value });
      } else if (cls.domain === 'shadows') {
        out.shadows.push({ name: cls.leaf, value });
      } else {
        out.unknown.push({ name: '--' + name, value });
      }
    }
  }

  return out;
}

module.exports = { parseTokens };
