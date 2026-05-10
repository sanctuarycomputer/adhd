'use strict';

const { parseShadow } = require('./shadow-parser');

const DOMAIN_COLLECTION = {
  color: 'color',
  spacing: 'spacing',
  radius: 'radius',
  shadow: 'shadow',
  typography: 'typography',
  opacity: 'opacity',
  'border-width': 'border-width',
  'z-index': 'z-index',
  breakpoint: 'breakpoint',
  container: 'container',
  blur: 'blur',
  perspective: 'perspective',
  aspect: 'aspect',
  ease: 'ease',
  animate: 'animate',
};

const DOMAIN_PREFIX = {
  color: '--color-',
  spacing: '--spacing-',  // Matches Tailwind v4 (--spacing is the multiplier name).
  radius: '--radius-',
  shadow: '--shadow-',
  typography: '--font-',
  opacity: '--opacity-',
  'border-width': '--border-',
  'z-index': '--z-',
  breakpoint: '--breakpoint-',
  container: '--container-',
  blur: '--blur-',
  perspective: '--perspective-',
  aspect: '--aspect-',
  ease: '--ease-',
  animate: '--animate-',
};

// Domains whose values are FLOATs (dimensions or unitless numbers).
const FLOAT_DOMAINS = new Set([
  'spacing', 'radius', 'opacity', 'border-width', 'z-index',
  'breakpoint', 'container', 'blur', 'perspective',
]);
// Domains whose values are STRINGs (cubic-bezier, animation shorthand, ratio).
const STRING_DOMAINS = new Set(['aspect', 'ease', 'animate']);

// Convert dimension-bearing strings like "0.25rem" / "16px" / "1.5" → number (px).
// Returns null if the value is not a simple dimension/unitless number.
function dimensionToPx(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  // Reject expressions: calc(...), var(...), comma-separated lists, etc.
  if (/[(),]/.test(s)) return null;
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || '';
  if (unit === 'rem' || unit === 'em') return n * 16;
  return n; // px or unitless
}

// Decide the Figma variable type for a (domain, value) pair. Returns one of
// 'COLOR' | 'FLOAT' | 'STRING'. For aliases we trust the domain alone; literals
// dispatch on shape (numeric/dimension → FLOAT, anything else → STRING).
function figmaTypeForToken(domain, valueObj) {
  if (domain === 'color') return 'COLOR';
  // Aliases inherit the type of their domain (resolved later in Figma).
  if (valueObj && valueObj.type === 'alias') {
    if (FLOAT_DOMAINS.has(domain)) return 'FLOAT';
    if (STRING_DOMAINS.has(domain)) return 'STRING';
    if (domain === 'typography') return 'FLOAT'; // best guess; STRING handled when literal
    return 'STRING';
  }
  // Literal dispatch
  const raw = valueObj && valueObj.type === 'literal' ? valueObj.value : null;
  if (raw == null) return 'STRING';
  if (FLOAT_DOMAINS.has(domain)) {
    return dimensionToPx(raw) != null ? 'FLOAT' : 'STRING';
  }
  if (STRING_DOMAINS.has(domain)) return 'STRING';
  if (domain === 'typography') {
    // text/font-weight/leading/tracking can be numeric (FLOAT) or expression/string (STRING).
    return dimensionToPx(raw) != null ? 'FLOAT' : 'STRING';
  }
  return 'STRING';
}

// Resolve a literal value to the Figma-native scalar for FLOAT/STRING types.
// For COLOR we pass through and let the write script handle hex/oklch parsing.
function resolveFigmaValue(domain, valueObj) {
  if (!valueObj || valueObj.type !== 'literal') return null;
  if (domain === 'color') return valueObj.value;
  const px = dimensionToPx(valueObj.value);
  if (px != null) return px;
  return valueObj.value;
}

function pathToCssVar(domain, path) {
  // gold/100 → --color-gold-100
  // brand/surface → --brand-surface (semantic colors don't use the color- prefix)
  const dashed = path.replace(/\//g, '-');
  if (domain === 'color' && (dashed.startsWith('brand') || /^(background|foreground|text|surface|accent|border)$/i.test(path))) {
    return '--' + dashed;
  }
  return DOMAIN_PREFIX[domain] + dashed;
}

function buildFigmaActions(diff, resolutions, direction) {
  const resolutionMap = new Map();
  for (const r of resolutions) {
    resolutionMap.set(r.path + ':' + (r.mode ?? 'default'), r.winner);
  }

  if (direction === 'push') {
    const actions = [];
    // Existing-effect-style names already in Figma (to dedupe creates).
    // Supports both the comparator's new shape (diff.styles.effects.figmaOnly)
    // and a flat legacy shape (diff.styles.figmaOnly) used in tests.
    const existingEffectNames = new Set([
      ...(((diff.styles && diff.styles.effects && diff.styles.effects.figmaOnly) || []).map(s => s.name)),
      ...(((diff.styles && diff.styles.figmaOnly) || []).map(s => s.name)),
      // Tokens that map to effect styles already on the Figma side. We don't
      // currently surface these via figmaOnly (they live in extract.effectStyles,
      // not extract.collections), but include here for forward-compat.
      ...(((diff.styles && diff.styles.effects && diff.styles.effects.same) || []).map(s => s.name)),
    ]);
    // Code-only: create in Figma
    for (const t of diff.codeOnly) {
      // Shadow tokens map to Figma effect styles, not variables. Parse the
      // CSS shadow string and emit a create-effect-style action.
      if (t.domain === 'shadow') {
        // Pick the canonical literal value (default or first available mode).
        const repValue = t.values.default || Object.values(t.values).find(v => v && v.type === 'literal');
        if (!repValue || repValue.type !== 'literal') {
          actions.push({ kind: 'skip-shadow', path: t.path, reason: 'No literal value to parse' });
          continue;
        }
        let parsed;
        try {
          parsed = parseShadow(repValue.value);
        } catch (err) {
          actions.push({ kind: 'skip-shadow', path: t.path, reason: 'parseShadow failed: ' + err.message });
          continue;
        }
        if (!parsed.length) {
          actions.push({ kind: 'skip-shadow', path: t.path, reason: 'parseShadow returned empty' });
          continue;
        }
        // Effect-style name = cssVar without the leading `--` (e.g. `shadow-md`,
        // `drop-shadow-md`, `inset-shadow-xs`, `text-shadow-sm`). This matches
        // Figma's convention of flat hyphenated names and avoids collisions
        // across families (e.g. `--shadow-2xs` vs `--drop-shadow-2xs` would
        // both become `2xs` if we used just the path).
        const cssVar = t.cssVar || '';
        const styleName = cssVar.replace(/^--/, '') || t.path;
        if (existingEffectNames.has(styleName)) {
          // Already in Figma — additive policy: skip.
          continue;
        }
        // Map CSS family → Figma effect type. `--text-shadow-*` doesn't have a
        // 1:1 Figma equivalent; we use DROP_SHADOW as the closest.
        const effectType = cssVar.startsWith('--inset-shadow-')
          ? 'INNER_SHADOW'
          : 'DROP_SHADOW';
        const effects = parsed.map(s => ({
          type: s.inset ? 'INNER_SHADOW' : effectType,
          color: s.color,
          offset: { x: s.offsetX, y: s.offsetY },
          radius: s.blur,
          spread: s.spread,
          visible: true,
          blendMode: 'NORMAL',
        }));
        actions.push({
          kind: 'create-effect-style',
          name: styleName,
          effects,
        });
        continue;
      }
      // Pick a representative value to determine the Figma variable type.
      // Modes within a single token always share the same type.
      const repValue = t.values.default || t.values.light || Object.values(t.values)[0];
      const type = figmaTypeForToken(t.domain, repValue);
      // Pre-resolve literal values for FLOAT/STRING types so the write
      // script doesn't need to re-parse rem/em.
      const resolvedByMode = {};
      for (const [mode, val] of Object.entries(t.values)) {
        if (val.type === 'literal' && type !== 'COLOR') {
          resolvedByMode[mode] = resolveFigmaValue(t.domain, val);
        }
      }
      actions.push({
        kind: 'create-variable',
        collection: DOMAIN_COLLECTION[t.domain],
        path: t.path,
        domain: t.domain,
        type,
        valuesByMode: t.values,
        resolvedByMode,
      });
    }
    // Conflicts where user picked "code": overwrite Figma
    for (const c of diff.conflict) {
      const winner = resolutionMap.get(c.path + ':' + c.mode);
      if (winner === 'code') {
        // Skip impossible writes: a conflict with `code === null` means this
        // mode exists in Figma but not in code (e.g., Figma has dark+light
        // modes but code stores the token mode-independently). "Use code" is
        // undefined in this case — we have nothing to write. The user must
        // pick "figma" to keep it, or add the mode to code first.
        if (!c.code) continue;
        const type = figmaTypeForToken(c.domain, c.code);
        const resolvedValue = c.code.type === 'literal' && type !== 'COLOR'
          ? resolveFigmaValue(c.domain, c.code)
          : null;
        actions.push({
          kind: 'update-variable',
          path: c.path,
          domain: c.domain,
          mode: c.mode,
          type,
          newValue: c.code,
          resolvedValue,
        });
      }
    }
    return actions;
  }

  if (direction === 'pull') {
    const actions = [];

    // Build a lookup from path → domain across BOTH sides so we can resolve
    // alias targets to the correct CSS var name. An alias target is just a
    // path string like 'gold/100'; without knowing its domain we'd produce
    // '--gold-100' instead of '--color-gold-100'.
    const pathDomain = new Map();
    const recordDomain = (t) => { if (t && !pathDomain.has(t.path)) pathDomain.set(t.path, t.domain); };
    for (const t of diff.same || []) recordDomain(t);
    for (const t of diff.codeOnly || []) recordDomain(t);
    for (const t of diff.figmaOnly || []) recordDomain(t);
    for (const c of diff.conflict || []) recordDomain({ path: c.path, domain: c.domain });

    const aliasCssVar = (target) => {
      const targetDomain = pathDomain.get(target) || 'unknown';
      if (targetDomain === 'unknown') {
        // Best-effort fallback: drop the slash, no domain prefix.
        return '--' + target.replace(/\//g, '-');
      }
      return pathToCssVar(targetDomain, target);
    };

    // Figma-only: add to code
    for (const t of diff.figmaOnly) {
      const cssVar = pathToCssVar(t.domain, t.path);
      for (const [mode, val] of Object.entries(t.values)) {
        if (mode === 'default') {
          actions.push({
            kind: 'set-primitive',
            cssVar,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? aliasCssVar(val.target) : null,
          });
        } else {
          actions.push({
            kind: 'set-semantic',
            cssVar, mode,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? aliasCssVar(val.target) : null,
          });
        }
      }
    }
    // Conflicts where user picked "figma": overwrite code
    for (const c of diff.conflict) {
      const winner = resolutionMap.get(c.path + ':' + c.mode);
      if (winner === 'figma') {
        // Skip impossible writes: a conflict with `figma === null` means this
        // mode exists in code but not in Figma. "Use figma" is undefined — we
        // have nothing to write. The user must pick "code" to keep it, or add
        // the mode to Figma first.
        if (!c.figma) continue;
        const cssVar = pathToCssVar(c.domain, c.path);
        const val = c.figma;
        if (c.mode === 'default') {
          actions.push({
            kind: 'set-primitive',
            cssVar,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? aliasCssVar(val.target) : null,
          });
        } else {
          actions.push({
            kind: 'set-semantic',
            cssVar, mode: c.mode,
            value: val.type === 'literal' ? val.value : null,
            valueAlias: val.type === 'alias' ? aliasCssVar(val.target) : null,
          });
        }
      }
    }
    return actions;
  }

  throw new Error('Unknown direction: ' + direction);
}

module.exports = {
  buildFigmaActions,
  pathToCssVar,
  figmaTypeForToken,
  dimensionToPx,
  resolveFigmaValue,
};
