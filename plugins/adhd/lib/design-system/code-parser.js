'use strict';

const fs = require('node:fs');

const VAR_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
const VAR_REF_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)/;

function findBlock(css, openRe) {
  const m = openRe.exec(css);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  return { start, end: i, body: css.slice(start, i), after: i + 1 };
}

function findAllBlocks(css, openRe) {
  const out = [];
  const re = new RegExp(openRe.source, 'g');
  let m;
  while ((m = re.exec(css)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    out.push({ start, end: i, body: css.slice(start, i) });
    re.lastIndex = i + 1;
  }
  return out;
}

function parseEntries(body) {
  const out = {};
  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(body)) !== null) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function inferDomain(cssVarName) {
  const stripped = cssVarName.replace(/^--/, '');
  if (stripped.startsWith('color-')) return 'color';
  if (stripped.startsWith('space-')) return 'spacing';
  if (stripped.startsWith('radius-')) return 'radius';
  if (stripped.startsWith('shadow-')) return 'shadow';
  if (stripped.startsWith('font-')) return 'typography';
  // Heuristic for semantic colors that don't have a "color-" prefix
  if (/^(background|foreground|brand|surface|text|border|accent)/i.test(stripped)) return 'color';
  return 'unknown';
}

function pathFromCssVar(cssVarName) {
  // --color-gold-100 → gold/100
  // --brand-surface → brand/surface
  // --space-2 → 2
  const stripped = cssVarName.replace(/^--/, '');
  const domain = inferDomain(cssVarName);
  const domainPrefix = {
    color: 'color-', spacing: 'space-', radius: 'radius-', shadow: 'shadow-', typography: 'font-',
  }[domain];
  let rest = stripped;
  if (domainPrefix && stripped.startsWith(domainPrefix)) {
    rest = stripped.slice(domainPrefix.length);
  }
  return rest.replace(/-/g, '/');
}

function valueFromString(raw) {
  const trimmed = raw.trim();
  const refMatch = VAR_REF_RE.exec(trimmed);
  if (refMatch) {
    return { type: 'alias', target: pathFromCssVar(refMatch[1]) };
  }
  return { type: 'literal', value: trimmed };
}

function findExtractedDarkBlocks(css) {
  // Extract @media (prefers-color-scheme: dark) { :root { ... } } bodies
  const out = [];
  const mediaRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  let m;
  while ((m = mediaRe.exec(css)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const inner = css.slice(start, i);
    const rootInner = findAllBlocks(inner, /:root\s*\{/);
    for (const blk of rootInner) out.push(blk.body);
    mediaRe.lastIndex = i + 1;
  }
  return out;
}

function parseCodeDesignSystem(css) {
  // Source can be a path or raw CSS — autodetect.
  let source = css;
  if (typeof css === 'string' && css.length < 1024 && fs.existsSync(css)) {
    source = fs.readFileSync(css, 'utf8');
  }
  if (typeof source !== 'string') {
    throw new TypeError('parseCodeDesignSystem expects a CSS string or a file path');
  }

  const tokens = new Map(); // path → token

  const upsert = (cssVar, mode, valueRaw) => {
    const path = pathFromCssVar(cssVar);
    const domain = inferDomain(cssVar);
    if (domain === 'unknown') return;
    if (!tokens.has(path)) {
      tokens.set(path, { domain, path, values: {}, cssVar });
    }
    tokens.get(path).values[mode] = valueFromString(valueRaw);
  };

  // 1. @theme {} (NOT @theme inline)
  // We need to find `@theme {` but NOT match `@theme inline {`.
  // Strategy: find all `@theme` openings, ignore inline ones.
  const themeOpenRe = /@theme(\s+inline)?\s*\{/g;
  let m;
  while ((m = themeOpenRe.exec(source)) !== null) {
    const isInline = !!m[1];
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const body = source.slice(start, i);
    if (isInline) {
      // Skip — handled below
    } else {
      const entries = parseEntries(body);
      for (const [cssVar, raw] of Object.entries(entries)) {
        upsert(cssVar, 'default', raw);
      }
    }
    themeOpenRe.lastIndex = i + 1;
  }

  // 2. :root {} blocks NOT inside @media (prefers-color-scheme: dark)
  // Strategy: blank out the dark @media block bodies, then look for :root {}.
  const darkBlocks = findExtractedDarkBlocks(source);
  let codeWithoutDark = source;
  // Remove the dark media wrappers so we can find non-dark :root {} blocks
  codeWithoutDark = source.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[\s\S]*?\}\s*\}/g, '');
  // Also remove [data-theme="dark"] :root blocks for the light pass
  codeWithoutDark = codeWithoutDark.replace(/:root\[data-theme=["']dark["']\]\s*\{[^}]*\}/g, '');
  const lightRoots = findAllBlocks(codeWithoutDark, /:root\s*\{/);
  for (const blk of lightRoots) {
    const entries = parseEntries(blk.body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'light', raw);
    }
  }

  // 3. Dark blocks (both forms)
  for (const body of darkBlocks) {
    const entries = parseEntries(body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'dark', raw);
    }
  }
  const dataThemeDark = findAllBlocks(source, /:root\[data-theme=["']dark["']\]\s*\{/);
  for (const blk of dataThemeDark) {
    const entries = parseEntries(blk.body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'dark', raw);
    }
  }

  // 4. @theme inline {} → exposure layer
  const exposure = [];
  const themeOpenRe2 = /@theme\s+inline\s*\{/g;
  while ((m = themeOpenRe2.exec(source)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const body = source.slice(start, i);
    const entries = parseEntries(body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      const refMatch = VAR_REF_RE.exec(raw);
      if (refMatch) {
        // exposure-only, alias to existing var
        exposure.push({
          cssVar,
          target: refMatch[1].replace(/^--/, ''),
        });
      }
      // else ignore (raw values in @theme inline are unusual)
    }
    themeOpenRe2.lastIndex = i + 1;
  }

  return { tokens: Array.from(tokens.values()), exposure };
}

module.exports = { parseCodeDesignSystem, pathFromCssVar, inferDomain };
