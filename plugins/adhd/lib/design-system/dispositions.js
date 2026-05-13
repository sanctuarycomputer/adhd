'use strict';

// Push-token dispositions — user-controlled per-domain policy for what
// gets pushed to Figma, and how. The /adhd:push-tokens wizard collects
// the seven choices interactively on EVERY push (no persistence —
// conscious decision each time, dispositions live in /tmp for the run).
//
// The categorical "Figma can't consume this anyway" filter (z-index,
// container queries, animate, ease, etc.) lives here. So does the
// design-decision filter ("push the full Tailwind color palette, or only
// my semantic colors?"). Tokens classified as 'skip' surface in the
// dry-run with their reason, but never become create-variable actions.

const UTILITY_DOMAINS = new Set([
  'z-index', 'animate', 'ease', 'aspect', 'perspective',
  'container', 'breakpoint', 'blur',
]);

// Defaults applied when a key is missing from `dispositions`. Mirrors
// the "recommended" answer in the wizard so a partial config still
// behaves predictably.
const DEFAULT_DISPOSITIONS = {
  color: 'all',
  typography: 'all',
  spacing: 'all',
  radiusAndBorder: 'push',
  shadow: 'effect-styles',
  opacity: 'skip',
  utilityDomains: 'skip',
};

// Return { action: 'push' | 'effect-style' | 'skip', reason? } for one
// token. `dispositions` is the parsed pushTokens object from
// adhd.config.ts; missing keys fall back to DEFAULT_DISPOSITIONS.
function classifyToken(token, dispositions) {
  const d = { ...DEFAULT_DISPOSITIONS, ...(dispositions || {}) };
  const dom = token.domain;
  const path = token.path || '';

  // Font families: always skip. Hardcoded — text styles are Figma's
  // native channel for typography choices, and pushing `--font-aeonik`
  // as a STRING variable competes with that workflow.
  if (dom === 'typography' && path.startsWith('font/')) {
    return { action: 'skip', reason: 'font-family — manage in Figma text styles, not variables' };
  }

  if (dom === 'color') {
    if (d.color === 'skip')          return { action: 'skip', reason: 'pushTokens.color = skip' };
    if (d.color === 'semantic-only' && token.fromTailwindDefault === true) {
      return { action: 'skip', reason: 'pushTokens.color = semantic-only — Tailwind palette stays in code' };
    }
    return { action: 'push' };
  }

  if (dom === 'typography') {
    if (d.typography === 'skip') return { action: 'skip', reason: 'pushTokens.typography = skip' };
    if (d.typography === 'sizes-and-weights') {
      if (path.startsWith('leading/') || path.startsWith('tracking/')) {
        return { action: 'skip', reason: 'pushTokens.typography = sizes-and-weights — leading/tracking skipped' };
      }
    }
    return { action: 'push' };
  }

  if (dom === 'spacing') {
    if (d.spacing === 'skip') return { action: 'skip', reason: 'pushTokens.spacing = skip' };
    if (d.spacing === 'authored-only' && token.fromTailwindDefault === true) {
      return { action: 'skip', reason: 'pushTokens.spacing = authored-only — Tailwind scale stays in code' };
    }
    return { action: 'push' };
  }

  if (dom === 'radius' || dom === 'border-width') {
    if (d.radiusAndBorder === 'skip') return { action: 'skip', reason: 'pushTokens.radiusAndBorder = skip' };
    return { action: 'push' };
  }

  if (dom === 'shadow') {
    if (d.shadow === 'skip') return { action: 'skip', reason: 'pushTokens.shadow = skip' };
    return { action: 'effect-style' };
  }

  if (dom === 'opacity') {
    if (d.opacity === 'skip') {
      return { action: 'skip', reason: 'pushTokens.opacity = skip — Tailwind applies opacity via /<percent> class modifiers' };
    }
    return { action: 'push' };
  }

  if (UTILITY_DOMAINS.has(dom)) {
    if (d.utilityDomains === 'skip') {
      return { action: 'skip', reason: `pushTokens.utilityDomains = skip — Figma doesn't consume ${dom} tokens` };
    }
    return { action: 'push' };
  }

  // Unknown domain: default to push so it surfaces. Better to let an
  // unrecognized domain through than silently drop user data.
  return { action: 'push' };
}

// Parse the `pushTokens: { ... }` block out of adhd.config.ts. Returns
// null when no block is present (which signals "run the wizard"). The
// schema is intentionally simple — one string value per key — so a
// permissive regex + key-quoting + JSON.parse handles it without
// requiring a TS evaluator at runtime.
function parsePushTokensFromConfig(configSrc) {
  if (!configSrc) return null;
  const open = /pushTokens\s*:\s*\{/.exec(configSrc);
  if (!open) return null;
  let depth = 1;
  let i = open.index + open[0].length;
  while (i < configSrc.length && depth > 0) {
    const ch = configSrc[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  const body = configSrc.slice(open.index + open[0].length, i);
  // Wrap THEN transform so the leading key has a `{` anchor for the
  // key-quoting regex. Doing the regex on the bare body would leave the
  // first key unquoted because there's no `[{,]` directly before it.
  const jsonish = ('{' + body + '}')
    .replace(/\/\/[^\n]*/g, '')          // strip line comments
    .replace(/'/g, '"')                  // single → double quotes
    .replace(/([{,]\s*)([a-zA-Z_][\w-]*)\s*:/g, '$1"$2":')  // quote keys
    .replace(/,\s*}/g, '}');             // trailing comma
  try { return JSON.parse(jsonish); }
  catch { return null; }
}

// Serialize a dispositions object into a TS object literal suitable for
// inserting into adhd.config.ts. Stable key order so diffs stay clean.
function formatPushTokensForConfig(dispositions) {
  const order = ['color', 'typography', 'spacing', 'radiusAndBorder', 'shadow', 'opacity', 'utilityDomains'];
  const lines = order
    .filter(k => k in dispositions)
    .map(k => `    ${k}: "${dispositions[k]}",`);
  return '  pushTokens: {\n' + lines.join('\n') + '\n  },';
}

module.exports = {
  classifyToken,
  parsePushTokensFromConfig,
  formatPushTokensForConfig,
  DEFAULT_DISPOSITIONS,
  UTILITY_DOMAINS,
};
