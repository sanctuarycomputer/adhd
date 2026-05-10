'use strict';

/**
 * Parse CSS box-shadow / drop-shadow / text-shadow / inset-shadow values into
 * a normalized list of shadow objects suitable for Figma effect styles.
 *
 * Syntax (per shadow, comma-separated):
 *   [inset] <offset-x> <offset-y> [blur] [spread] <color>
 *
 * Color can be hex (#rgb, #rrggbb, #rrggbbaa), rgb(...), rgba(...), or oklch(...).
 * Length values can be 0 (unitless) or px (rem/em coerced to px at 16px).
 *
 * Returns: [{ inset, offsetX, offsetY, blur, spread, color: {r,g,b,a} }, ...]
 *
 * All numbers are pixels. Color channels are 0–1.
 */

// Split a multi-shadow string on top-level commas only — commas inside
// function calls like rgb(...) / rgba(...) / oklch(...) are preserved.
function splitTopLevelCommas(input) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') { depth++; buf += ch; continue; }
    if (ch === ')') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) {
      const t = buf.trim();
      if (t.length) out.push(t);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const t = buf.trim();
  if (t.length) out.push(t);
  return out;
}

// Tokenize a single shadow expression: split on whitespace but keep
// function calls (rgb(...), oklch(...), etc.) as single tokens.
function tokenize(input) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') { depth++; buf += ch; continue; }
    if (ch === ')') { depth--; buf += ch; continue; }
    if (/\s/.test(ch) && depth === 0) {
      if (buf.length) { out.push(buf); buf = ''; }
      continue;
    }
    buf += ch;
  }
  if (buf.length) out.push(buf);
  return out;
}

function lengthToPx(token) {
  if (token === '0') return 0;
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(token);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'px';
  if (unit === 'rem' || unit === 'em') return n * 16;
  return n;
}

function isLength(token) {
  return lengthToPx(token) !== null;
}

function hexToRgba(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length === 4) c = c.split('').map(x => x + x).join('');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const a = c.length === 8 ? parseInt(c.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

// Parse `rgb(R, G, B)` / `rgba(R, G, B, A)` / `rgb(R G B / A)` (modern).
function rgbToRgba(input) {
  const m = /^rgba?\(([^)]*)\)$/.exec(input.trim());
  if (!m) return null;
  const body = m[1].trim();
  // Modern syntax has either commas or `R G B / A` slash form.
  let parts;
  if (body.includes('/')) {
    const [rgbPart, aPart] = body.split('/').map(s => s.trim());
    const rgb = rgbPart.split(/\s+/).filter(Boolean);
    parts = [...rgb, aPart];
  } else if (body.includes(',')) {
    parts = body.split(',').map(s => s.trim());
  } else {
    parts = body.split(/\s+/).filter(Boolean);
  }
  if (parts.length < 3) return null;
  const parseChan = (s) => {
    if (s.endsWith('%')) return parseFloat(s) / 100;
    return parseFloat(s) / 255;
  };
  const parseAlpha = (s) => {
    if (s == null) return 1;
    if (s.endsWith('%')) return parseFloat(s) / 100;
    return parseFloat(s);
  };
  return {
    r: parseChan(parts[0]),
    g: parseChan(parts[1]),
    b: parseChan(parts[2]),
    a: parseAlpha(parts[3]),
  };
}

// oklch(L C H [ / A ]) → linear sRGB → gamma-corrected sRGB → {r,g,b,a} 0–1.
function oklchToRgba(input) {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/.exec(input.trim());
  if (!m) return null;
  let L = parseFloat(m[1]); if (m[1].endsWith('%')) L = L / 100;
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  let A = 1;
  if (m[4]) { A = parseFloat(m[4]); if (m[4].endsWith('%')) A = A / 100; }
  const a_ = C * Math.cos(H * Math.PI / 180);
  const b_ = C * Math.sin(H * Math.PI / 180);
  const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
  const m2 = L - 0.1055613458 * a_ - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a_ - 1.2914855480 * b_;
  const l = l_ * l_ * l_;
  const m3 = m2 * m2 * m2;
  const s = s_ * s_ * s_;
  const lr =  4.0767416621 * l - 3.3077115913 * m3 + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m3 - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m3 + 1.7076147010 * s;
  const gamma = (x) => x >= 0.0031308 ? 1.055 * Math.pow(x, 1/2.4) - 0.055 : 12.92 * x;
  return {
    r: Math.max(0, Math.min(1, gamma(lr))),
    g: Math.max(0, Math.min(1, gamma(lg))),
    b: Math.max(0, Math.min(1, gamma(lb))),
    a: A,
  };
}

const NAMED_COLORS = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
};

function parseColor(token) {
  const s = token.trim();
  if (s.startsWith('#')) return hexToRgba(s);
  if (s.startsWith('rgb')) return rgbToRgba(s);
  if (s.startsWith('oklch')) return oklchToRgba(s);
  if (NAMED_COLORS[s.toLowerCase()]) return NAMED_COLORS[s.toLowerCase()];
  return null;
}

function isColor(token) {
  return parseColor(token) !== null;
}

/**
 * Parse one CSS shadow expression (no top-level commas).
 *
 * Per CSS spec, the keyword `inset` may appear first or last. Lengths come
 * before the color in any order subject to: 2 lengths = (offsetX, offsetY),
 * 3 lengths = (offsetX, offsetY, blur), 4 lengths = (offsetX, offsetY, blur, spread).
 */
function parseSingleShadow(input) {
  const tokens = tokenize(input);
  let inset = false;
  const lengths = [];
  let color = null;

  for (const tok of tokens) {
    if (tok.toLowerCase() === 'inset') { inset = true; continue; }
    if (isLength(tok)) { lengths.push(lengthToPx(tok)); continue; }
    if (isColor(tok)) { color = parseColor(tok); continue; }
    // Unknown token — ignore (or throw? for now, ignore quietly).
  }

  if (lengths.length < 2) {
    throw new Error('Shadow needs at least offsetX and offsetY: ' + input);
  }
  const [offsetX, offsetY, blur = 0, spread = 0] = lengths;
  return {
    inset,
    offsetX,
    offsetY,
    blur,
    spread,
    color: color || { r: 0, g: 0, b: 0, a: 1 },
  };
}

/**
 * Parse a CSS box-shadow / text-shadow / drop-shadow / inset-shadow value
 * (possibly multi-shadow comma-separated).
 *
 * Returns an array of parsed shadow objects (never empty for valid input).
 */
function parseShadow(input) {
  if (input == null) return [];
  const trimmed = String(input).trim();
  if (!trimmed) return [];
  const parts = splitTopLevelCommas(trimmed);
  return parts.map(parseSingleShadow);
}

module.exports = {
  parseShadow,
  parseSingleShadow,
  splitTopLevelCommas,
  // Exposed for testing.
  tokenize,
  parseColor,
  lengthToPx,
};
