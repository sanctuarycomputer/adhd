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

function classify(name) {
  if (name.startsWith('color-')) {
    return { domain: 'colors', leaf: name.slice('color-'.length) };
  }
  if (name === 'spacing') {
    return { domain: 'spacing', leaf: null };
  }
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
  if (name.startsWith('radius-')) {
    return { domain: 'radius', leaf: name.slice('radius-'.length) };
  }
  if (name.startsWith('shadow-')) {
    return { domain: 'shadows', leaf: name.slice('shadow-'.length) };
  }
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
        case 'colors':
          out.colors.push({ name: cls.leaf, value });
          break;
        case 'spacing':
          out.spacing.multiplier = value;
          break;
        case 'typography':
          upsertTypography(cls.leaf, cls.kind, value);
          break;
        case 'radius':
          out.radius.push({ name: cls.leaf, value });
          break;
        case 'shadows':
          out.shadows.push({ name: cls.leaf, value });
          break;
        default:
          out.unknown.push({ name: '--' + name, value });
      }
    }
  }

  return out;
}

module.exports = { parseTokens };
