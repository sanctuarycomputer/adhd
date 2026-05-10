#!/usr/bin/env node
'use strict';

/**
 * ADHD to-dtcg converter.
 *
 * Usage:
 *   node cli.js --source css --input <path> [--tailwind-theme <path|none>]
 *   node cli.js --source figma --input <path>
 *
 * Output: DTCG-formatted JSON to stdout (keys sorted, 2-space indent, trailing newline).
 * Exit codes: 0 = success, 1 = parse error, 2 = bad arguments.
 *
 * Spec: docs/superpowers/specs/2026-05-09-adhd-restructure-design.md
 */

// ============================================================
// OKLCH → hex conversion (vendored from colorjs.io, MIT)
// ============================================================
//
// Pipeline: OKLCH → OKLab → linear sRGB → companded sRGB → 8-bit hex.

function oklchToOklab(L, C, h) {
  const hRad = (h * Math.PI) / 180;
  return {
    L,
    a: C * Math.cos(hRad),
    b: C * Math.sin(hRad),
  };
}

function oklabToLinearSrgb({ L, a, b }) {
  // Inverse of OKLab forward matrix from Björn Ottosson's paper.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function linearToCompandedSrgb(c) {
  // sRGB transfer function (gamma encoding).
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp01(c) {
  return Math.max(0, Math.min(1, c));
}

function channelToHex(c) {
  const v = Math.round(clamp01(c) * 255);
  return v.toString(16).padStart(2, '0');
}

function oklchToHex(L, C, h) {
  const lab = oklchToOklab(L, C, h);
  const lin = oklabToLinearSrgb(lab);
  const r = linearToCompandedSrgb(lin.r);
  const g = linearToCompandedSrgb(lin.g);
  const b = linearToCompandedSrgb(lin.b);
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

// ============================================================
// CSS parsing
// ============================================================

const ADHD_PRIMITIVE_PREFIXES = [
  'color', 'spacing', 'radius', 'shadow', 'font', 'text', 'font-weight', 'leading',
];

const NAMESPACE_TO_DTCG_TYPE = {
  color: 'color',
  spacing: 'dimension',
  radius: 'dimension',
  shadow: 'shadow',
  font: 'fontFamily',
  text: 'dimension',
  'font-weight': 'fontWeight',
  leading: 'number',
};

const NAMESPACE_TO_DTCG_PATH = {
  color: 'color',
  spacing: 'spacing',
  radius: 'radius',
  shadow: 'shadow',
  font: 'font',
  text: 'text',
  'font-weight': 'fontWeight',
  leading: 'leading',
};

// Match a top-level `@theme {` block (NOT @theme inline / @theme default).
// Returns { body, end } or null. The caller should slice the input to skip past `end`.
function findAtThemeBlock(text, label /* 'theme' or 'theme inline' or 'theme default' */) {
  // Build a regex: `@theme\b(?: inline)?\s*{`. We match by exact label.
  const labelEsc = label === 'theme' ? '@theme(?!\\s+(inline|default))' :
                   label === 'theme inline' ? '@theme\\s+inline' :
                   '@theme\\s+default';
  const re = new RegExp(`${labelEsc}\\s*\\{`, 'g');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = matchClosingBrace(text, start);
  if (end < 0) return null;
  return { body: text.slice(start, end), end: end + 1 };
}

function matchClosingBrace(text, openIdx) {
  let depth = 1;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Find a top-level `:root {` block that is NOT inside `@media (prefers-color-scheme: dark)`.
function findRootBlock(text) {
  const re = /:root\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isInsideMediaDark(text, m.index)) continue;
    const start = m.index + m[0].length;
    const end = matchClosingBrace(text, start);
    if (end < 0) continue;
    return { body: text.slice(start, end), end: end + 1 };
  }
  return null;
}

function findMediaDarkBlock(text) {
  const mediaRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  const m = mediaRe.exec(text);
  if (!m) return null;
  const mediaBodyStart = m.index + m[0].length;
  const mediaBodyEnd = matchClosingBrace(text, mediaBodyStart);
  if (mediaBodyEnd < 0) return null;
  const mediaBody = text.slice(mediaBodyStart, mediaBodyEnd);
  const rootRe = /:root\s*\{/g;
  const rm = rootRe.exec(mediaBody);
  if (!rm) return null;
  const rootBodyStart = rm.index + rm[0].length;
  const rootBodyEnd = matchClosingBrace(mediaBody, rootBodyStart);
  if (rootBodyEnd < 0) return null;
  return { body: mediaBody.slice(rootBodyStart, rootBodyEnd) };
}

function isInsideMediaDark(text, idx) {
  const before = text.slice(0, idx);
  const lastMedia = before.lastIndexOf('@media');
  if (lastMedia < 0) return false;
  const mediaSlice = text.slice(lastMedia);
  const mediaMatch = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/.exec(mediaSlice);
  if (!mediaMatch) return false;
  const mediaBodyStart = lastMedia + mediaMatch[0].length;
  const mediaBodyEnd = matchClosingBrace(text, mediaBodyStart);
  if (mediaBodyEnd < 0) return false;
  return idx >= mediaBodyStart && idx < mediaBodyEnd;
}

// Parse `--name: value;` declarations from a block body. Handles multi-line values
// by matching up to the next `;`.
function parseDeclarations(body) {
  const out = [];
  const re = /(--[a-z][a-z0-9-]*)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({ name: m[1], value: m[2].trim() });
  }
  return out;
}

// Map a CSS variable name (e.g., --color-gold-100) to (namespace, dot-path-suffix).
// Returns null if the name isn't ADHD-managed.
function variableNameToDtcg(varName) {
  const stripped = varName.replace(/^--/, '');
  for (const prefix of ADHD_PRIMITIVE_PREFIXES) {
    if (stripped === prefix) continue;
    const prefixDash = prefix + '-';
    if (stripped.startsWith(prefixDash)) {
      const rest = stripped.slice(prefixDash.length);
      const restDots = rest.replace(/-/g, '.');
      return { namespace: prefix, dtcgPath: `${NAMESPACE_TO_DTCG_PATH[prefix]}.${restDots}` };
    }
  }
  return null;
}

// Given a CSS value, normalize for DTCG.
function normalizeCssValue(raw, namespace) {
  raw = raw.trim();
  // Alias?
  const aliasMatch = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(raw);
  if (aliasMatch) {
    const target = variableNameToDtcg(aliasMatch[1]);
    if (target) return `{${target.dtcgPath}}`;
    return raw;
  }
  // OKLCH?
  const oklchMatch = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(raw);
  if (oklchMatch) {
    const L = parseFloat(oklchMatch[1]) / 100;
    const C = parseFloat(oklchMatch[2]);
    const H = parseFloat(oklchMatch[3]);
    return oklchToHex(L, C, H);
  }
  return raw;
}

function parseCssTokens(cssText) {
  const result = {
    primitives: [],
    semanticLight: [],
    semanticDark: [],
  };
  const themeBlock = findAtThemeBlock(cssText, 'theme');
  if (themeBlock) {
    for (const decl of parseDeclarations(themeBlock.body)) {
      const mapped = variableNameToDtcg(decl.name);
      if (!mapped) continue;
      const dtcgType = NAMESPACE_TO_DTCG_TYPE[mapped.namespace];
      const value = normalizeCssValue(decl.value, mapped.namespace);
      result.primitives.push({ ...mapped, value, dtcgType });
    }
  }
  const rootBlock = findRootBlock(cssText);
  if (rootBlock) {
    for (const decl of parseDeclarations(rootBlock.body)) {
      if (variableNameToDtcg(decl.name)) continue; // skip primitive-prefixed
      const stripped = decl.name.replace(/^--/, '');
      const dtcgPath = `color.${stripped.replace(/-/g, '.')}`;
      const value = normalizeCssValue(decl.value, 'color');
      result.semanticLight.push({ namespace: 'color', dtcgPath, value, dtcgType: 'color' });
    }
  }
  const darkBlock = findMediaDarkBlock(cssText);
  if (darkBlock) {
    for (const decl of parseDeclarations(darkBlock.body)) {
      if (variableNameToDtcg(decl.name)) continue;
      const stripped = decl.name.replace(/^--/, '');
      const dtcgPath = `color.${stripped.replace(/-/g, '.')}`;
      const value = normalizeCssValue(decl.value, 'color');
      result.semanticDark.push({ namespace: 'color', dtcgPath, value, dtcgType: 'color' });
    }
  }
  return result;
}

// ============================================================
// DTCG output construction
// ============================================================

function setNested(obj, dotPath, leaf) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = leaf;
}

function buildDtcgFromCssTokens(tokens) {
  const root = {};
  for (const t of tokens.primitives) {
    setNested(root, t.dtcgPath, { $type: t.dtcgType, $value: t.value });
  }
  const semByPath = new Map();
  for (const t of tokens.semanticLight) {
    semByPath.set(t.dtcgPath, { type: t.dtcgType, light: t.value, dark: undefined });
  }
  for (const t of tokens.semanticDark) {
    const existing = semByPath.get(t.dtcgPath) || { type: t.dtcgType, light: undefined, dark: undefined };
    existing.dark = t.value;
    semByPath.set(t.dtcgPath, existing);
  }
  for (const [dotPath, sem] of semByPath) {
    const leaf = {
      $type: sem.type,
      $extensions: {
        'com.figma': {
          modes: {},
        },
      },
    };
    if (sem.light !== undefined) leaf.$extensions['com.figma'].modes.Light = { $value: sem.light };
    if (sem.dark !== undefined) leaf.$extensions['com.figma'].modes.Dark = { $value: sem.dark };
    setNested(root, dotPath, leaf);
  }
  return root;
}

// Sort all object keys alphabetically (recursively). Arrays preserve order.
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
  return out;
}

function stringifyDtcgStable(obj) {
  return JSON.stringify(sortKeysDeep(obj), null, 2) + '\n';
}

// Parse Tailwind v4 theme.css `@theme default {}` block.
function parseTailwindTheme(themeText) {
  // Tailwind v4's theme.css uses `@theme default { ... }`.
  const block = findAtThemeBlock(themeText, 'theme default');
  if (!block) return [];
  const out = [];
  // theme.css contains multi-line values (e.g., font-sans across multiple lines).
  // Our parseDeclarations regex matches up to the next `;`, which handles multi-line.
  for (const decl of parseDeclarations(block.body)) {
    const mapped = variableNameToDtcg(decl.name);
    if (!mapped) continue;
    const value = normalizeCssValue(decl.value, mapped.namespace);
    out.push({ ...mapped, value, dtcgType: NAMESPACE_TO_DTCG_TYPE[mapped.namespace] });
  }
  return out;
}

// ============================================================
// Figma MCP response parsing
// ============================================================

function rgbObjectToHex({ r, g, b, a }) {
  const ch = (c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0');
  if (a !== undefined && a < 1) {
    const aCh = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
    return `#${ch(r)}${ch(g)}${ch(b)}${aCh}`;
  }
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

function figmaVariableNameToDtcg(name) {
  // "colors/gold/100" → { namespace: "color", dtcgPath: "color.gold.100" }
  // "colors/brand/surface" → { namespace: "color", dtcgPath: "color.brand.surface" }
  // "spacing/4" → { namespace: "spacing", dtcgPath: "spacing.4" }
  const parts = name.split('/');
  if (parts.length < 2) return null;
  const figmaNs = parts[0];
  const FIGMA_NS_TO_NS = {
    colors: 'color',
    spacing: 'spacing',
    radius: 'radius',
    shadow: 'shadow',
    font: 'font',
    text: 'text',
    'font-weight': 'font-weight',
    leading: 'leading',
  };
  const namespace = FIGMA_NS_TO_NS[figmaNs];
  if (!namespace) return null;
  const dtcgPath = NAMESPACE_TO_DTCG_PATH[namespace] + '.' + parts.slice(1).join('.');
  return { namespace, dtcgPath };
}

function parseFigmaResponse(json) {
  if (!json || !json.meta) {
    throw new Error('Invalid Figma response: missing `meta`');
  }
  const collections = json.meta.variableCollections || {};
  const variables = json.meta.variables || {};

  // Build collection ID → { name, modes: [{ id, name }] }
  const collById = {};
  for (const id of Object.keys(collections)) {
    const c = collections[id];
    collById[id] = { name: c.name, modes: c.modes || [] };
  }

  // Validate required collections.
  const primitives = Object.values(collById).find((c) => c.name === 'Primitives');
  const semantic = Object.values(collById).find((c) => c.name === 'Semantic');
  if (!primitives) throw new Error('Figma file missing `Primitives` collection');
  if (!semantic) throw new Error('Figma file missing `Semantic` collection');
  if (semantic.modes.length !== 2) {
    throw new Error(`Semantic collection must have exactly 2 modes (Light, Dark); found ${semantic.modes.length}`);
  }
  const semanticModeNames = semantic.modes.map((m) => m.name).sort().join(',');
  if (semanticModeNames !== 'Dark,Light') {
    throw new Error(`Semantic collection modes must be named exactly Light and Dark; found ${semantic.modes.map((m) => m.name).join(', ')}`);
  }

  // Build variable ID → variable info, including dtcgPath.
  const varInfo = {};
  for (const id of Object.keys(variables)) {
    const v = variables[id];
    const mapped = figmaVariableNameToDtcg(v.name);
    if (!mapped) continue;
    varInfo[id] = { ...mapped, raw: v };
  }

  // Resolve a variable value (may be alias) to a DTCG value string.
  function resolveValue(value, namespace) {
    if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
      const target = varInfo[value.id];
      if (!target) throw new Error(`Unresolved alias: ${value.id}`);
      return `{${target.dtcgPath}}`;
    }
    if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
      return rgbObjectToHex(value);
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value;
    throw new Error(`Unsupported value: ${JSON.stringify(value)}`);
  }

  const out = { primitives: [], semanticLight: [], semanticDark: [] };
  for (const id of Object.keys(varInfo)) {
    const info = varInfo[id];
    const v = info.raw;
    const collection = collById[v.variableCollectionId];
    if (!collection) continue;
    const dtcgType = NAMESPACE_TO_DTCG_TYPE[info.namespace];

    if (collection.name === 'Primitives') {
      // Single mode.
      const modeId = collection.modes[0]?.modeId;
      const value = resolveValue(v.valuesByMode[modeId], info.namespace);
      out.primitives.push({ ...info, value, dtcgType });
    } else if (collection.name === 'Semantic') {
      // Two modes named Light + Dark.
      for (const m of collection.modes) {
        const value = resolveValue(v.valuesByMode[m.modeId], info.namespace);
        if (m.name === 'Light') out.semanticLight.push({ ...info, value, dtcgType });
        else if (m.name === 'Dark') out.semanticDark.push({ ...info, value, dtcgType });
        else throw new Error(`Unexpected Semantic mode: ${m.name}`);
      }
    }
  }
  return out;
}

function parseArgs(argv) {
  const out = { source: undefined, input: undefined, tailwindTheme: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--source') { out.source = value; i++; }
    else if (flag === '--input') { out.input = value; i++; }
    else if (flag === '--tailwind-theme') { out.tailwindTheme = value; i++; }
    else { throw new Error(`Unknown argument: ${flag}`); }
  }
  if (!out.source) throw new Error('--source is required (must be "css" or "figma")');
  if (out.source !== 'css' && out.source !== 'figma') {
    throw new Error('--source must be "css" or "figma"');
  }
  if (!out.input) throw new Error('--input is required');
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`cli.js: ${err.message}\n`);
    process.exit(2);
  }
  try {
    let dtcg;
    if (args.source === 'css') {
      const cssText = require('fs').readFileSync(args.input, 'utf8');
      const tokens = parseCssTokens(cssText);
      if (args.tailwindTheme && args.tailwindTheme !== 'none') {
        const themeText = require('fs').readFileSync(args.tailwindTheme, 'utf8');
        const themeTokens = parseTailwindTheme(themeText);
        const seen = new Set(tokens.primitives.map(p => p.dtcgPath));
        for (const t of themeTokens) {
          if (!seen.has(t.dtcgPath)) tokens.primitives.push(t);
        }
      }
      dtcg = buildDtcgFromCssTokens(tokens);
    } else if (args.source === 'figma') {
      const json = JSON.parse(require('fs').readFileSync(args.input, 'utf8'));
      const tokens = parseFigmaResponse(json);
      dtcg = buildDtcgFromCssTokens(tokens); // same shape input
    }
    process.stdout.write(stringifyDtcgStable(dtcg));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`cli.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  parseArgs,
  oklchToHex,
  parseCssTokens,
  parseFigmaResponse,
  buildDtcgFromCssTokens,
  stringifyDtcgStable,
  variableNameToDtcg,
  normalizeCssValue,
  rgbObjectToHex,
};
