'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VAR_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
const VAR_REF_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)/;

// Categories from Tailwind's @theme default that we DON'T push to Figma in v1.
// (breakpoints, containers, ease, blur, perspective, animate, aspect, default-* meta)
const NON_PUSHABLE_PREFIXES = [
  'breakpoint-', 'container-', 'ease-', 'blur-',
  'perspective-', 'animate-', 'aspect-', 'default-',
];

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
  // Drop non-pushable categories first (Tailwind defaults we deliberately ignore).
  for (const p of NON_PUSHABLE_PREFIXES) {
    if (stripped.startsWith(p)) return 'unknown';
  }
  // Skip Tailwind v4 sub-property companion vars (e.g. --text-xs--line-height,
  // --font-sans--font-feature-settings). These are typography metadata, not
  // independent tokens worth pushing as their own Figma variable in v1.
  if (stripped.includes('--')) return 'unknown';

  if (stripped.startsWith('color-')) return 'color';
  if (stripped === 'spacing' || stripped.startsWith('space-')) return 'spacing';
  if (stripped.startsWith('radius-')) return 'radius';
  if (
    stripped.startsWith('shadow-') ||
    stripped.startsWith('drop-shadow-') ||
    stripped.startsWith('inset-shadow-') ||
    stripped.startsWith('text-shadow-')
  ) return 'shadow';
  if (
    stripped.startsWith('font-') ||
    stripped.startsWith('text-') ||
    stripped.startsWith('leading-') ||
    stripped.startsWith('tracking-')
  ) return 'typography';
  // Heuristic for semantic colors that don't have a "color-" prefix
  if (/^(background|foreground|brand|surface|text|border|accent)/i.test(stripped)) return 'color';
  return 'unknown';
}

function pathFromCssVar(cssVarName) {
  // --color-gold-100 → gold/100   (split on FIRST hyphen after domain prefix)
  // --brand-surface → brand/surface
  // --brand-surface-raised → brand/surface-raised  (literal hyphen preserved inside leaf)
  // --brand-on-surface → brand/on-surface
  // --space-2 → 2 (single segment after domain prefix)
  // --background → background (no hyphens)
  const stripped = cssVarName.replace(/^--/, '');
  const domain = inferDomain(cssVarName);

  // Special case: lone `--spacing` (Tailwind multiplier) → 'spacing' path.
  if (stripped === 'spacing') return 'spacing';

  // Multi-prefix domains keep the family name in the path so they don't collide
  // (e.g. --drop-shadow-xs → drop-shadow/xs, --font-weight-bold → font-weight/bold,
  // --text-xs → text/xs). Single-prefix domains drop the prefix entirely.
  // Order matters: longer prefixes must be tried before shorter ones.
  const SINGLE_PREFIX = {
    color: 'color-', spacing: 'space-', radius: 'radius-', shadow: 'shadow-',
  };
  // Multi-family prefixes keep the family name in the path so they don't
  // collide. Order matters: longer prefixes tried first.
  const KEEP_PREFIX = {
    shadow: ['drop-shadow-', 'inset-shadow-', 'text-shadow-'],
    typography: ['font-weight-', 'font-', 'text-', 'leading-', 'tracking-'],
  };

  let rest = stripped;
  if (KEEP_PREFIX[domain]) {
    for (const p of KEEP_PREFIX[domain]) {
      if (stripped.startsWith(p)) {
        // Replace the trailing hyphen of the family with a slash, e.g.
        // 'font-weight-' + 'bold' → 'font-weight/bold'.
        return p.slice(0, -1) + '/' + stripped.slice(p.length);
      }
    }
  }
  if (SINGLE_PREFIX[domain] && stripped.startsWith(SINGLE_PREFIX[domain])) {
    rest = stripped.slice(SINGLE_PREFIX[domain].length);
  }
  // Split on FIRST hyphen only — first part is "group", rest is "leaf" (with literal hyphens preserved).
  // This mirrors Figma's convention: `/` separates path segments, `-` is literal within a segment.
  const firstHyphen = rest.indexOf('-');
  if (firstHyphen === -1) return rest;
  return rest.slice(0, firstHyphen) + '/' + rest.slice(firstHyphen + 1);
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

function stripKeyframes(body) {
  // Remove all @keyframes <name> { ... } blocks from a CSS body. Bracket-aware.
  let out = '';
  let i = 0;
  while (i < body.length) {
    const idx = body.indexOf('@keyframes', i);
    if (idx === -1) { out += body.slice(i); break; }
    out += body.slice(i, idx);
    // skip past `@keyframes <name> {`
    const open = body.indexOf('{', idx);
    if (open === -1) { i = body.length; break; }
    let depth = 1;
    let j = open + 1;
    while (j < body.length && depth > 0) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') depth--;
      if (depth === 0) break;
      j++;
    }
    i = j + 1;
  }
  return out;
}

function loadTailwindDefaultsBody() {
  const file = path.join(__dirname, 'tailwind-defaults.css');
  const css = fs.readFileSync(file, 'utf8');
  // Find `@theme default {` — careful NOT to match `@theme default inline reference {`.
  const re = /@theme\s+default\s*\{/g;
  const m = re.exec(css);
  if (!m) return '';
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  return stripKeyframes(css.slice(start, i));
}

function parseCodeDesignSystem(css, opts = {}) {
  // Source can be a path or raw CSS — autodetect.
  let source = css;
  if (typeof css === 'string' && css.length < 1024 && fs.existsSync(css)) {
    source = fs.readFileSync(css, 'utf8');
  }
  if (typeof source !== 'string') {
    throw new TypeError('parseCodeDesignSystem expects a CSS string or a file path');
  }

  const tokens = new Map(); // domain+path → token

  const upsert = (cssVar, mode, valueRaw) => {
    const path = pathFromCssVar(cssVar);
    const domain = inferDomain(cssVar);
    if (domain === 'unknown') return;
    const key = domain + ':' + path;
    if (!tokens.has(key)) {
      tokens.set(key, { domain, path, values: {}, cssVar });
    }
    tokens.get(key).values[mode] = valueFromString(valueRaw);
  };

  // 0. Tailwind defaults (optional). Merged FIRST so that user's globals.css
  // can override at the same path.
  if (opts.includeTailwindDefaults) {
    const body = loadTailwindDefaultsBody();
    const entries = parseEntries(body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'default', raw);
    }
  }

  // 1. @theme {} (NOT @theme inline, NOT @theme default — those are handled separately)
  // Strategy: find all `@theme` openings; ignore inline + default variants here.
  const themeOpenRe = /@theme(\s+inline|\s+default(?:\s+inline\s+reference)?)?\s*\{/g;
  let m;
  while ((m = themeOpenRe.exec(source)) !== null) {
    const variant = m[1] ? m[1].trim() : '';
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
    if (variant === '') {
      const entries = parseEntries(stripKeyframes(body));
      for (const [cssVar, raw] of Object.entries(entries)) {
        upsert(cssVar, 'default', raw);
      }
    }
    // 'inline' is handled in step 4 below; 'default' / 'default inline reference'
    // we ignore at the user level (Tailwind's vendored defaults handled above).
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
