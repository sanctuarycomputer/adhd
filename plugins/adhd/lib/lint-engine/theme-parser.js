'use strict';

const VAR_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

function parseSection(body) {
  const out = {};
  let match;
  VAR_RE.lastIndex = 0;
  while ((match = VAR_RE.exec(body)) !== null) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

// Find the body of the FIRST block whose opening token matches `openRe`,
// starting the search at `fromIndex`. Returns { body, end } where `end` is
// the index just past the closing `}`. Returns null if not found.
function findBlock(css, openRe, fromIndex = 0) {
  const re = new RegExp(openRe.source, openRe.flags.includes('g') ? openRe.flags : openRe.flags + 'g');
  re.lastIndex = fromIndex;
  const m = re.exec(css);
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
  return { body: css.slice(start, i), end: i + 1 };
}

// Find ALL non-overlapping blocks whose opening token matches `openRe`,
// across the entire CSS source. Returns an array of { body, start, end }.
function findAllBlocks(css, openRe) {
  const blocks = [];
  let from = 0;
  while (from < css.length) {
    const block = findBlock(css, openRe, from);
    if (!block) break;
    blocks.push(block);
    from = block.end;
  }
  return blocks;
}

// Strip top-level @media (prefers-color-scheme: dark) { ... } blocks from CSS,
// returning { stripped, darkBodies } where `darkBodies` is the concatenated
// inner contents of every such block. This lets us scan for `:root { ... }`
// in light context (the stripped source) and dark context (the dark bodies)
// separately, without a bracketed-attribute form interfering.
function extractDarkMediaBlocks(css) {
  const openRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  let stripped = '';
  const darkBodies = [];
  let cursor = 0;
  let m;
  while ((m = openRe.exec(css)) !== null) {
    const blockStart = m.index;
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    stripped += css.slice(cursor, blockStart);
    darkBodies.push(css.slice(bodyStart, i));
    cursor = i + 1;
    openRe.lastIndex = cursor;
  }
  stripped += css.slice(cursor);
  return { stripped, darkBodies: darkBodies.join('\n') };
}

function parseTheme(css) {
  // Pull out @media (prefers-color-scheme: dark) { ... } first so that any
  // :root inside it is accounted to the `dark` map, not `light`.
  const { stripped, darkBodies } = extractDarkMediaBlocks(css);

  // Primitives: every @theme { ... } block (excluding @theme inline).
  // We rely on a sentinel pattern: @theme { vs @theme inline {.
  const primitiveBlocks = findAllBlocks(stripped, /@theme\s*\{/);
  const primitives = {};
  for (const b of primitiveBlocks) Object.assign(primitives, parseSection(b.body));

  // Exposure: every @theme inline { ... } block. These will also be matched
  // by the primitives regex above, so we must subtract them: re-parse the
  // exposure blocks and remove their entries from primitives.
  const exposureBlocks = findAllBlocks(stripped, /@theme\s+inline\s*\{/);
  const exposure = {};
  for (const b of exposureBlocks) {
    const entries = parseSection(b.body);
    Object.assign(exposure, entries);
    for (const k of Object.keys(entries)) {
      if (primitives[k] === entries[k]) delete primitives[k];
    }
  }

  // Light: every :root { ... } block in the stripped CSS (no media query).
  // The bracketed form `:root[data-theme="dark"] {` must NOT count as light.
  const lightBlocks = findAllBlocks(stripped, /:root\s*\{/);
  const light = {};
  for (const b of lightBlocks) Object.assign(light, parseSection(b.body));

  // Dark: union of (a) :root[data-theme="dark"] { ... } anywhere, and
  // (b) any :root { ... } found inside @media (prefers-color-scheme: dark).
  const darkAttrBlocks = findAllBlocks(css, /:root\[data-theme="dark"\]\s*\{/);
  const darkMediaRootBlocks = findAllBlocks(darkBodies, /:root\s*\{/);
  const dark = {};
  for (const b of darkAttrBlocks) Object.assign(dark, parseSection(b.body));
  for (const b of darkMediaRootBlocks) Object.assign(dark, parseSection(b.body));

  return { primitives, exposure, light, dark };
}

module.exports = { parseTheme };
