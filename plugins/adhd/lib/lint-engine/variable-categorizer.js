'use strict';

const { figmaToCssVar } = require('./name-normalizer');
const { valuesMatch } = require('./value-normalizer');

// Infer the Tailwind v4 domain from a full Figma variable path
// (e.g. `Color/primary`, `Primitives/spacing/4`). Lowercased + checked
// against the canonical domain names AND common alternates, so a
// designer's `Color/primary` matches the same domain as `color/primary`
// or `Primitives/color/primary`. Without lowercasing, the categorizer
// silently returned `unknown` for capitalized collections, which then
// bypassed the per-domain normalization in valuesMatch and produced
// false-positive conflicts (the original "primary" case from the user's
// reactor file).
function inferDomain(figmaPath) {
  if (!figmaPath) return 'unknown';
  const lc = String(figmaPath).toLowerCase();
  if (lc.startsWith('color/')   || lc.includes('/color/'))   return 'color';
  if (lc.startsWith('spacing/') || lc.includes('/spacing/')) return 'spacing';
  if (lc.startsWith('space/')   || lc.includes('/space/'))   return 'spacing';
  if (lc.startsWith('radius/')  || lc.includes('/radius/'))  return 'radius';
  if (lc.startsWith('shadow/')  || lc.includes('/shadow/'))  return 'shadow';
  if (lc.startsWith('font/')    || lc.includes('/font/') ||
      lc.includes('text-') || lc.includes('line-height')) return 'typography';
  return 'unknown';
}

function strippedToken(figmaPath) {
  // Drop collection prefix; keep the rest as-is for human display.
  const segs = figmaPath.split('/');
  if (segs.length > 1) return segs.slice(1).join('/');
  return figmaPath;
}

function lookupLocal(theme, cssVar, mode) {
  // For semantic tokens with modes, look in light/dark; else look in primitives or exposure.
  if (mode === 'light') return theme.light?.[cssVar];
  if (mode === 'dark')  return theme.dark?.[cssVar];
  return theme.primitives?.[cssVar] ?? theme.exposure?.[cssVar];
}

function isLocalAlias(v) {
  return typeof v === 'string' && /^var\(--[A-Za-z0-9_-]+\)$/i.test(v.trim());
}

// Follow a code-side `var(--X)` alias through the parsed theme until we
// reach a concrete literal (or a chain dead-end). Returns ALL possible
// terminal values — the alias might resolve to different literals in
// light vs dark modes; if the Figma side matches any of them we treat
// the variables as semantically equal. Returns null when the chain
// can't be resolved (variable not defined anywhere we know of, or
// infinite-loop guard tripped).
function resolveLocalAlias(value, theme, depth = 0) {
  if (depth > 8) return null;
  if (typeof value !== 'string') return [value];
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/i.exec(value.trim());
  if (!m) return [value]; // already a literal
  const target = m[1];
  const candidates = [];
  if (theme.primitives && theme.primitives[target] != null) candidates.push(theme.primitives[target]);
  if (theme.exposure   && theme.exposure[target]   != null) candidates.push(theme.exposure[target]);
  if (theme.light      && theme.light[target]      != null) candidates.push(theme.light[target]);
  if (theme.dark       && theme.dark[target]       != null) candidates.push(theme.dark[target]);
  if (candidates.length === 0) return null;
  const out = [];
  for (const c of candidates) {
    const next = resolveLocalAlias(c, theme, depth + 1);
    if (next) {
      for (const r of next) {
        if (!out.includes(r)) out.push(r);
      }
    }
  }
  return out.length > 0 ? out : null;
}

function isFigmaAlias(v) {
  return v != null && typeof v === 'object' && v.type === 'VARIABLE_ALIAS';
}

function compareOne(figmaPath, figmaValue, theme, mode) {
  const cssVar = figmaToCssVar(figmaPath);
  const token = strippedToken(figmaPath);
  // Pass the FULL figma path (not the collection-stripped token) so
  // inferDomain can use the collection name as a domain signal —
  // `color/primary` matches `color`, `Primitives/spacing/4` matches
  // `spacing` via the tier-collection branch.
  const domain = inferDomain(figmaPath);
  const localValue = lookupLocal(theme, cssVar, mode);

  if (localValue === undefined || localValue === null) {
    return {
      token,
      status: 'missing',
      figma: figmaValue,
      local: null,
      mode,
      domain,
      hint: 'Run /adhd:pull-tokens to import this token.',
    };
  }
  // Both sides agree this is an alias relationship — no surface-value comparison
  // is meaningful. The primitive-level comparison catches real drift in the
  // underlying targets.
  if (isLocalAlias(localValue) && isFigmaAlias(figmaValue)) {
    return null;
  }
  // Code side is a `var(--X)` alias and Figma side is a literal. Without
  // resolution this throws inside normalizeColor and falls back to "not
  // equal" — false-conflict on every shadcn-style setup where
  // `--color-primary: var(--primary)` exposes a semantic. Resolve the
  // chain across primitives/light/dark and accept any matching mode.
  if (isLocalAlias(localValue) && !isFigmaAlias(figmaValue)) {
    const resolved = resolveLocalAlias(localValue, theme);
    if (resolved && resolved.some(r => valuesMatch(figmaValue, r, domain))) {
      return null;
    }
    return { token, status: 'conflict', figma: figmaValue, local: localValue, mode, domain, resolvedLocal: resolved };
  }
  if (valuesMatch(figmaValue, localValue, domain)) {
    return null; // same, no violation
  }
  return { token, status: 'conflict', figma: figmaValue, local: localValue, mode, domain };
}

function categorizeVariables(figmaVars, theme) {
  const out = [];
  for (const [figmaPath, value] of Object.entries(figmaVars)) {
    if (value && typeof value === 'object' && ('Light' in value || 'Dark' in value)) {
      // Semantic with modes
      if ('Light' in value) {
        const v = compareOne(figmaPath, value.Light, theme, 'light');
        if (v) out.push(v);
      }
      if ('Dark' in value) {
        const v = compareOne(figmaPath, value.Dark, theme, 'dark');
        if (v) out.push(v);
      }
    } else {
      // Primitive (no modes)
      const v = compareOne(figmaPath, value, theme, undefined);
      if (v) out.push(v);
    }
  }
  return out;
}

module.exports = { categorizeVariables };
