'use strict';

// Detection: look for any pageExtensions entry that mentions our sentinel
// "design-system.tsx" — that's the unique fingerprint of OUR patch, regardless
// of which env-var condition guards it ('NODE_ENV' vs 'VERCEL_ENV').
const PATCHED_SENTINEL_RE = /pageExtensions:[\s\S]*?'design-system\.tsx'/;

// Detection: any other pageExtensions definition (array form).
const EXISTING_PAGE_EXTENSIONS_RE = /pageExtensions:\s*\[/;

// Captures the full `pageExtensions: ...,` declaration for conflict reporting.
const EXISTING_PAGE_EXTENSIONS_VALUE_RE = /pageExtensions:[^,\n]+,?/;

// Render-mode → conditional source. The "everywhere" mode is handled by NOT
// calling the patcher at all (files use plain `.tsx` extensions and ship to
// production). The two excluding modes only differ in which env vars they read.
const PATCH_BLOCKS = {
  'dev-only': `  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],`,
  // Vercel-preview-aware: excludes on Vercel's production environment AND on
  // any non-Vercel production deploy (Netlify, fly.io, CI, etc.). Vercel
  // preview deploys have VERCEL_ENV='preview', which doesn't satisfy either
  // disjunct, so the route renders there.
  'vercel-preview': `  pageExtensions:
    process.env.VERCEL_ENV === 'production' ||
    (!process.env.VERCEL && process.env.NODE_ENV === 'production')
      ? ['ts', 'tsx']
      : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],`,
};

function isPatched(source) {
  return PATCHED_SENTINEL_RE.test(source);
}

function findConfigObjectStart(source) {
  // Look for either:
  //   const nextConfig: NextConfig = {
  //   const nextConfig = {
  //   export default {
  //   module.exports = {
  const patterns = [
    /const\s+nextConfig(?:\s*:\s*[^=]+)?\s*=\s*\{/,
    /export\s+default\s*\{/,
    /module\.exports\s*=\s*\{/,
  ];
  for (const re of patterns) {
    const m = re.exec(source);
    if (m) return m.index + m[0].length; // position after the opening `{`
  }
  return -1;
}

function patchNextConfig(source, options = {}) {
  if (isPatched(source)) return source;

  // Detect existing different pageExtensions
  if (EXISTING_PAGE_EXTENSIONS_RE.test(source)) {
    if (options.detectOnly) {
      const existing = EXISTING_PAGE_EXTENSIONS_VALUE_RE.exec(source)[0];
      return { conflict: true, existing };
    }
    // Caller hasn't checked; we still refuse to silently merge.
    throw new Error('next.config already sets pageExtensions to a different value. Run with detectOnly: true to inspect and prompt the user.');
  }

  const renderMode = options.renderMode || 'dev-only';
  const block = PATCH_BLOCKS[renderMode];
  if (!block) {
    throw new Error(`Unknown renderMode: ${renderMode}. Expected one of: ${Object.keys(PATCH_BLOCKS).join(', ')}.`);
  }

  const insertAt = findConfigObjectStart(source);
  if (insertAt === -1) {
    throw new Error('Could not locate the config object in next.config. Manual edit required.');
  }

  // Insert the patch block immediately inside the object literal, before existing
  // properties. This puts it at the top of the config for visibility.
  const before = source.slice(0, insertAt);
  // Strip any leading newline from the tail so it isn't duplicated; we always
  // emit exactly one `\n` on each side of the block for clean formatting.
  const after = source.slice(insertAt).replace(/^\n/, '');
  return before + '\n' + block + '\n' + after;
}

module.exports = { patchNextConfig, isPatched };
