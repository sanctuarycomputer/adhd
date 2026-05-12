'use strict';

const HEX_3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_6 = /^#([0-9a-f]{6})$/i;
const HEX_8 = /^#([0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

function normalizeColor(input) {
  // Figma's raw color form — `{r, g, b, a}` with each channel 0..1. The
  // SKILL's serializer emits values straight from
  // `variable.valuesByMode[mode]` without converting; without this
  // branch, a Figma `#0a0a0a` color compared against code's `#0a0a0a`
  // hex falsely conflicts because the figma side is `{r:0.039,...}`.
  if (input && typeof input === 'object' && 'r' in input && 'g' in input && 'b' in input) {
    const to2 = (n) => Math.round(Math.max(0, Math.min(1, Number(n))) * 255).toString(16).padStart(2, '0');
    let hex = '#' + to2(input.r) + to2(input.g) + to2(input.b);
    if (input.a !== undefined && Number(input.a) < 1) {
      hex += to2(input.a);
    }
    return hex.toLowerCase();
  }
  if (typeof input !== 'string') {
    throw new TypeError('normalizeColor: expected string or color object, got ' + typeof input);
  }
  const trimmed = input.trim();

  const m3 = HEX_3.exec(trimmed);
  if (m3) {
    return ('#' + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3]).toLowerCase();
  }
  if (HEX_6.test(trimmed) || HEX_8.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const rgb = RGB_RE.exec(trimmed);
  if (rgb) {
    const r = Number(rgb[1]).toString(16).padStart(2, '0');
    const g = Number(rgb[2]).toString(16).padStart(2, '0');
    const b = Number(rgb[3]).toString(16).padStart(2, '0');
    if (rgb[4] !== undefined) {
      const a = Math.round(Number(rgb[4]) * 255).toString(16).padStart(2, '0');
      return ('#' + r + g + b + a).toLowerCase();
    }
    return ('#' + r + g + b).toLowerCase();
  }
  throw new Error('normalizeColor: unrecognized format "' + input + '"');
}

function normalizeDimension(input) {
  // The SKILL's serializer emits Figma's raw `valuesByMode` shape
  // unchanged — for spacing / radius / line-height variables that's
  // typically a bare number (`6` for 6px, `0` for 0px, `1.5` for a
  // unitless line-height ratio). Accept both forms so the comparator
  // doesn't crash mid-run on the first numeric value it encounters.
  if (typeof input === 'number') {
    return Number.isInteger(input) ? input + 'px' : String(input);
  }
  if (typeof input !== 'string') {
    throw new TypeError('normalizeDimension: expected string or number, got ' + typeof input);
  }
  const trimmed = input.trim();
  const remMatch = /^(-?[\d.]+)rem$/i.exec(trimmed);
  if (remMatch) {
    return Number(remMatch[1]) * 16 + 'px';
  }
  const pxMatch = /^(-?[\d.]+)px$/i.exec(trimmed);
  if (pxMatch) {
    return trimmed.toLowerCase();
  }
  // Unitless (e.g., line-height ratios)
  if (/^-?[\d.]+$/.test(trimmed)) {
    return trimmed;
  }
  // Fallback: pass through
  return trimmed;
}

function shadowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = ['offsetX', 'offsetY', 'blur', 'spread', 'color'];
  for (const k of keys) {
    if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  }
  return true;
}

function valuesMatch(figmaValue, localValue, domain) {
  switch (domain) {
    case 'color':
      try {
        return normalizeColor(figmaValue) === normalizeColor(localValue);
      } catch {
        return false;
      }
    case 'spacing':
    case 'radius':
      return normalizeDimension(figmaValue) === normalizeDimension(localValue);
    case 'typography':
      return normalizeDimension(figmaValue) === normalizeDimension(localValue);
    case 'shadow':
      return shadowEqual(figmaValue, localValue);
    default:
      return figmaValue === localValue;
  }
}

module.exports = { normalizeColor, normalizeDimension, valuesMatch };
