'use strict';

// Returns the body text of every `@theme { ... }` block found in `css`.
// A Tailwind v4 `@theme` block contains flat `--name: value;` declarations
// only (no nested rules), so a naive brace counter is sufficient — we don't
// need the string/comment-aware scanner used in lib/pull-component.
// `@theme inline { ... }` and other modifiers between `@theme` and `{` are
// supported by skipping forward to the first `{`.
function extractAllThemeBodies(css) {
  const bodies = [];
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf('@theme', i);
    if (idx === -1) break;
    // Skip forward to the block-opening `{`, tolerating modifiers like `inline`.
    let j = idx + '@theme'.length;
    while (j < css.length && css[j] !== '{' && css[j] !== ';') j++;
    if (css[j] !== '{') {
      i = j + 1;
      continue;
    }
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

// Matches a single `--name: value;` declaration. The `name` capture excludes
// the leading `--`; the `value` capture is everything up to the next `;`.
const DECL_RE = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

// Tailwind v4 typography pairs size + line-height under the same family name
// via a `--line-height` suffix on the variable:
//   --text-xs: 0.75rem;             ← size
//   --text-xs--line-height: 1rem;   ← line-height of the same `xs` row
// We split on the suffix so callers see one row per family name.
const LINE_HEIGHT_SUFFIX = '--line-height';

// Prefix-to-domain mapping. Order is significant: longer/more-specific prefixes
// must precede shorter ones (e.g. `font-weight-` before `font-`, `inset-shadow-`
// before `shadow-`). Each entry maps to a flat array of `{ name, value }` rows.
const PREFIX_MAP = [
  ['color-', 'colors'],
  ['font-weight-', 'fontWeights'],
  ['font-', 'fonts'],
  ['inset-shadow-', 'shadows'],
  ['drop-shadow-', 'shadows'],
  ['shadow-', 'shadows'],
  ['radius-', 'radius'],
  ['tracking-', 'tracking'],
  ['leading-', 'leading'],
  ['breakpoint-', 'breakpoints'],
  ['ease-', 'easings'],
  ['animate-', 'animations'],
];

function classify(name) {
  if (name === 'spacing') {
    return { domain: 'spacing', leaf: null };
  }
  // Typography (`text-*`) is special because of the `--line-height` suffix pairing.
  if (name.startsWith('text-')) {
    const rest = name.slice('text-'.length);
    if (rest.endsWith(LINE_HEIGHT_SUFFIX)) {
      return {
        domain: 'typography',
        leaf: rest.slice(0, -LINE_HEIGHT_SUFFIX.length),
        kind: 'lineHeight',
      };
    }
    return { domain: 'typography', leaf: rest, kind: 'size' };
  }
  for (const [prefix, domain] of PREFIX_MAP) {
    if (name.startsWith(prefix)) {
      return { domain, leaf: name.slice(prefix.length) };
    }
  }
  return { domain: 'unknown' };
}

function parseTokens(globalsCss) {
  const out = {
    colors: [],
    spacing: { multiplier: null },
    typography: [], // [{ name, size, lineHeight }]
    fonts: [],
    fontWeights: [],
    radius: [],
    shadows: [],
    tracking: [],
    leading: [],
    breakpoints: [],
    easings: [],
    animations: [],
    unknown: [],
  };
  // Tracks typography rows by family name so size + line-height (which arrive
  // as two separate declarations) merge into a single output row.
  const typographyByName = new Map();

  function upsertTypography(leaf, kind, value) {
    let row = typographyByName.get(leaf);
    if (!row) {
      row = { name: leaf, size: null, lineHeight: null };
      typographyByName.set(leaf, row);
      out.typography.push(row);
    }
    if (kind === 'lineHeight') row.lineHeight = value;
    else row.size = value;
  }

  for (const body of extractAllThemeBodies(globalsCss)) {
    // Reset lastIndex because DECL_RE is module-scoped and stateful (`/g`).
    DECL_RE.lastIndex = 0;
    let m;
    while ((m = DECL_RE.exec(body)) !== null) {
      const name = m[1];
      const value = m[2].trim();
      const cls = classify(name);
      switch (cls.domain) {
        case 'spacing':
          out.spacing.multiplier = value;
          break;
        case 'typography':
          upsertTypography(cls.leaf, cls.kind, value);
          break;
        case 'unknown':
          out.unknown.push({ name: '--' + name, value });
          break;
        default:
          // All other domains share the same flat `{ name, value }` row shape
          // and a 1:1 mapping from PREFIX_MAP's domain key to an `out` bucket.
          if (Array.isArray(out[cls.domain])) {
            out[cls.domain].push({ name: cls.leaf, value });
          } else {
            out.unknown.push({ name: '--' + name, value });
          }
      }
    }
  }

  return out;
}

module.exports = { parseTokens };
