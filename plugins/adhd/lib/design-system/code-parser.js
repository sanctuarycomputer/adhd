'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VAR_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
const VAR_REF_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)/;

// `--default-*` vars in Tailwind's @theme default reference other vars via the
// special --theme(...) syntax (e.g. `--default-font-family: --theme(--font-sans, initial)`).
// They aren't standalone tokens and don't translate to Figma variables, so we filter them.
const NON_PUSHABLE_PREFIXES = [
  'default-',
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
  // Tailwind v4 has some `--x--y` companion vars. We allow specific ones we
  // want to surface as Figma variables (line-height pairings) and reject the
  // rest (font-feature-settings, font-variation-settings — metadata).
  if (stripped.includes('--')) {
    if (/^text-[a-z0-9]+--line-height$/.test(stripped)) return 'typography';
    return 'unknown';
  }

  if (stripped.startsWith('color-')) return 'color';
  if (stripped === 'spacing' || stripped.startsWith('space-') || stripped.startsWith('spacing-')) return 'spacing';
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
  // Utility / non-visual-token Tailwind categories. Each maps to its own Figma
  // collection on push (see DOMAIN_COLLECTION in figma-write-actions.js).
  if (stripped.startsWith('opacity-')) return 'opacity';
  if (stripped.startsWith('border-')) return 'border-width';
  if (stripped.startsWith('z-')) return 'z-index';
  if (stripped.startsWith('breakpoint-')) return 'breakpoint';
  if (stripped.startsWith('container-')) return 'container';
  if (stripped.startsWith('blur-')) return 'blur';
  if (stripped.startsWith('perspective-')) return 'perspective';
  if (stripped.startsWith('aspect-')) return 'aspect';
  if (stripped.startsWith('ease-')) return 'ease';
  if (stripped.startsWith('animate-')) return 'animate';
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
  // Order matters when multiple match (longest first wins via the lookup loop below).
  const SINGLE_PREFIX_ORDERED = {
    color: ['color-'],
    spacing: ['spacing-', 'space-'],  // Prefer 'spacing-' (Tailwind v4 native) over the older 'space-'.
    radius: ['radius-'],
    shadow: ['shadow-'],
    opacity: ['opacity-'],
    'border-width': ['border-'],
    'z-index': ['z-'],
    breakpoint: ['breakpoint-'],
    container: ['container-'],
    blur: ['blur-'],
    perspective: ['perspective-'],
    aspect: ['aspect-'],
    ease: ['ease-'],
    animate: ['animate-'],
  };
  // Multi-family prefixes keep the family name in the path so they don't
  // collide. Order matters: longer prefixes tried first.
  const KEEP_PREFIX = {
    shadow: ['drop-shadow-', 'inset-shadow-', 'text-shadow-'],
    typography: ['font-weight-', 'font-', 'text-', 'leading-', 'tracking-'],
  };

  // Special case: --text-X--line-height → text/X/line-height
  // (Tailwind v4 ships a line-height value paired with every font-size.)
  const lhMatch = /^text-([a-z0-9]+)--line-height$/.exec(stripped);
  if (lhMatch) return 'text/' + lhMatch[1] + '/line-height';

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
  if (SINGLE_PREFIX_ORDERED[domain]) {
    for (const p of SINGLE_PREFIX_ORDERED[domain]) {
      if (stripped.startsWith(p)) {
        rest = stripped.slice(p.length);
        break;
      }
    }
  }
  // Flat-scale domains keep their leaf as a single segment — e.g. `ease-in-out`
  // is one name, not `in/out`. Skip the hyphen-split for these.
  const FLAT_DOMAINS = new Set([
    'opacity', 'border-width', 'z-index', 'breakpoint', 'container',
    'blur', 'perspective', 'aspect', 'ease', 'animate',
  ]);
  if (FLAT_DOMAINS.has(domain)) return rest;
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

// Convert a CSS length string ("0.625rem", "16px", "1.5") to pixels.
// rem/em use a 16px base — Tailwind v4's default and the figma-write-
// actions's convention. Returns null if the input isn't a simple length.
function lengthToPx(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || '';
  if (unit === 'rem' || unit === 'em') return n * 16;
  return n;
}

// Try to resolve a CSS value expression to a literal `<N>px` string by
// looking up referenced variables in `rawVars`. Handles the patterns
// designers actually write in `@theme inline {}`:
//
//   var(--name)                          → resolve --name (recursive)
//   calc(var(--name) ± Npx | ± Nrem)     → arithmetic
//   calc(var(--name) * N | / N)          → arithmetic
//   plain literals ("0.5rem", "8px")     → returned as `<N>px`
//
// Returns null when the expression contains anything more elaborate (two
// vars, nested calcs, percentage math, etc.) — caller falls back to the
// existing behavior (skipping the override). Recursion is bounded by
// `depth` to prevent cycles in pathological aliases.
function resolveToPxLiteral(raw, rawVars, depth = 0) {
  if (depth > 8) return null;
  const s = String(raw || '').trim();
  if (!s) return null;

  // Plain literal — already a length.
  const direct = lengthToPx(s);
  if (direct != null) return direct + 'px';

  // var(--name) alone.
  const varOnly = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)$/.exec(s);
  if (varOnly) {
    const target = rawVars.get(varOnly[1]);
    if (target == null) return null;
    return resolveToPxLiteral(target, rawVars, depth + 1);
  }

  // calc(<var-or-num> <op> <var-or-num>) — restricted form.
  const calc = /^calc\(\s*(.+?)\s*\)$/.exec(s);
  if (calc) {
    const inner = calc[1];
    // Two operands separated by + - * /. Operators must have surrounding
    // whitespace per the CSS spec (calc(8px+4px) is invalid).
    const opSplit = /^(.+?)\s+([+\-*/])\s+(.+)$/.exec(inner);
    if (!opSplit) return null;
    const [, lhsRaw, op, rhsRaw] = opSplit;
    const lhs = resolveToPxLiteral(lhsRaw, rawVars, depth + 1);
    const rhs = resolveToPxLiteral(rhsRaw, rawVars, depth + 1);
    // For * and /, one side is a plain number (no unit). For +/-, both
    // must resolve to lengths.
    const lhsNum = lhs ? lengthToPx(lhs) : lengthToPx(lhsRaw);
    const rhsNum = rhs ? lengthToPx(rhs) : lengthToPx(rhsRaw);
    if (lhsNum == null || rhsNum == null) return null;
    let val;
    switch (op) {
      case '+': val = lhsNum + rhsNum; break;
      case '-': val = lhsNum - rhsNum; break;
      case '*': val = lhsNum * rhsNum; break;
      case '/': val = rhsNum === 0 ? null : lhsNum / rhsNum; break;
      default:  return null;
    }
    if (val == null || !Number.isFinite(val)) return null;
    return val + 'px';
  }

  return null;
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

// The Tailwind v4 spacing scale, synthesized from the --spacing multiplier.
// Decimal names use underscore (Figma rejects '.' in variable names).
const TAILWIND_SPACING_SCALE = {
  '0': 0, 'px': 1,
  '0_5': 2, '1': 4, '1_5': 6, '2': 8, '2_5': 10, '3': 12, '3_5': 14,
  '4': 16, '5': 20, '6': 24, '7': 28, '8': 32, '9': 36, '10': 40,
  '11': 44, '12': 48, '14': 56, '16': 64, '20': 80, '24': 96,
  '28': 112, '32': 128, '36': 144, '40': 160, '44': 176, '48': 192,
  '52': 208, '56': 224, '60': 240, '64': 256, '72': 288, '80': 320, '96': 384,
};

// Bookend radius values not in theme.css's --radius-{xs..4xl} set.
const TAILWIND_RADIUS_EXTRAS = { 'none': 0, 'full': 9999 };

// Tailwind v4 opacity scale (utility-class names → 0–1 float for Figma).
// Note: Figma stores opacity as 0–1, not 0–100.
const TAILWIND_OPACITY_SCALE = (() => {
  const out = {};
  for (let i = 0; i <= 100; i += 5) out[String(i)] = i / 100;
  return out;
})();

// Tailwind v4 border-width scale (px). `auto` and percentage values excluded.
const TAILWIND_BORDER_WIDTH_SCALE = {
  '0': 0, '1': 1, '2': 2, '4': 4, '8': 8,
};

// Tailwind v4 z-index scale. `auto` skipped (not a number).
const TAILWIND_Z_INDEX_SCALE = {
  '0': 0, '10': 10, '20': 20, '30': 30, '40': 40, '50': 50,
};

// Tailwind v4 aspect-ratio utility classes that aren't variables in theme.css.
// `aspect-video` lives in theme.css (--aspect-video: 16 / 9). The others
// resolve to literal aspect-ratio values directly in the utility classes.
const TAILWIND_ASPECT_EXTRAS = {
  'square': '1 / 1',
  'auto':   'auto',
};

function synthesizeTailwindUtilityScale() {
  const out = [];
  const push = (domain, name, value, cssVarPrefix) => {
    out.push({
      domain,
      path: name,
      values: { default: { type: 'literal', value: String(value) } },
      cssVar: cssVarPrefix + name,
      synthetic: true,
    });
  };
  for (const [name, px] of Object.entries(TAILWIND_SPACING_SCALE)) {
    push('spacing', name, px + 'px', '--spacing-');
  }
  for (const [name, px] of Object.entries(TAILWIND_RADIUS_EXTRAS)) {
    push('radius', name, px + 'px', '--radius-');
  }
  for (const [name, v] of Object.entries(TAILWIND_OPACITY_SCALE)) {
    push('opacity', name, v, '--opacity-');
  }
  for (const [name, px] of Object.entries(TAILWIND_BORDER_WIDTH_SCALE)) {
    push('border-width', name, px + 'px', '--border-');
  }
  for (const [name, v] of Object.entries(TAILWIND_Z_INDEX_SCALE)) {
    push('z-index', name, v, '--z-');
  }
  for (const [name, v] of Object.entries(TAILWIND_ASPECT_EXTRAS)) {
    push('aspect', name, v, '--aspect-');
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
  // Every `--name: rawValue` declaration we see, regardless of domain.
  // Powers `@theme inline {}` expression resolution: when a designer writes
  // `--radius-sm: calc(var(--radius) - 4px)`, we need to look up --radius's
  // literal to compute the resolved 6px and override the Tailwind default.
  // Storing raw strings (not parsed values) keeps the resolver simple.
  const rawVars = new Map();

  const upsert = (cssVar, mode, valueRaw, meta) => {
    rawVars.set(cssVar, valueRaw);
    const path = pathFromCssVar(cssVar);
    const domain = inferDomain(cssVar);
    if (domain === 'unknown') return;
    const key = domain + ':' + path;
    if (!tokens.has(key)) {
      tokens.set(key, { domain, path, values: {}, cssVar });
    }
    const tok = tokens.get(key);
    tok.values[mode] = valueFromString(valueRaw);
    // Origin marker — set ONLY when the token first lands (so a later
    // user-globals upsert clears it back to "authored"). The comparator
    // uses this to exclude pure-default tokens from codeOnly: pushing the
    // entire Tailwind palette into Figma is rarely what the user wants,
    // and the additive policy lets implicit defaults stay implicit on
    // both sides. Tokens in `same` or `conflict` still surface — those
    // are real state.
    if (meta && meta.fromTailwindDefault) {
      if (!('fromTailwindDefault' in tok)) tok.fromTailwindDefault = true;
    } else {
      // Any user-authored upsert overrides the default flag.
      tok.fromTailwindDefault = false;
    }
  };

  // 0. Tailwind defaults (optional). Merged FIRST so that user's globals.css
  // can override at the same path.
  if (opts.includeTailwindDefaults) {
    const body = loadTailwindDefaultsBody();
    const entries = parseEntries(body);
    for (const [cssVar, raw] of Object.entries(entries)) {
      upsert(cssVar, 'default', raw, { fromTailwindDefault: true });
    }
    // Tailwind v4 doesn't ship explicit `--spacing-N` or `--radius-{none,full}`
    // variables — most utility classes derive from --spacing at build time
    // (e.g. `p-4` resolves to `calc(var(--spacing) * 4)`). For Figma these
    // need to be explicit so designers can pick them. Synthesize them.
    const synthetic = synthesizeTailwindUtilityScale();
    for (const t of synthetic) {
      const key = t.domain + ':' + t.path;
      if (!tokens.has(key)) {
        t.fromTailwindDefault = true;
        tokens.set(key, t);
      }
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
      // @theme inline can ALSO carry value overrides — most often as
      // calc()/var() expressions that resolve to a concrete length at
      // runtime (e.g. `--radius-sm: calc(var(--radius) - 4px)`). Without
      // this resolution step, the parser would silently fall back to the
      // Tailwind default for --radius-sm, producing false conflicts
      // against Figma's resolved value. We try to resolve every inline
      // entry to a literal `<N>px` string and override the default; if
      // the expression is too complex, we leave the default alone.
      const resolved = resolveToPxLiteral(raw, rawVars);
      if (resolved != null) {
        upsert(cssVar, 'default', resolved);
      }
    }
    themeOpenRe2.lastIndex = i + 1;
  }

  // Synthesize a `styles.effects` list from shadow-domain tokens so the
  // comparator can diff against Figma's effect styles by name. The actual
  // effect payload is parsed lazily by figma-write-actions when needed.
  const tokenList = Array.from(tokens.values());
  // Use cssVar-without-the-leading-`--` as the effect-style name so it
  // doesn't collide across families (e.g. --shadow-2xs vs --text-shadow-2xs).
  const shadowTokens = tokenList.filter(t => t.domain === 'shadow');
  const styles = {
    effects: shadowTokens.map(t => ({ name: (t.cssVar || '').replace(/^--/, '') || t.path })),
    text: [],
  };

  return { tokens: tokenList, exposure, styles };
}

module.exports = { parseCodeDesignSystem, pathFromCssVar, inferDomain, synthesizeTailwindUtilityScale };
