'use strict';

// Detection: any of our markers — "design-system.tsx" in pageExtensions OR
// the tokens-page tracing line. EITHER means we've patched. Re-runs are a
// no-op once any marker is present; to switch modes, the user removes the
// patch block manually and re-runs.
const PATCHED_SENTINEL_RE = /'design-system\.tsx'|adhd:sync-docs — file-tracing/;

// Detection: any OTHER pageExtensions definition (array form not matching ours).
const EXISTING_PAGE_EXTENSIONS_RE = /pageExtensions:\s*\[/;

// Captures the full `pageExtensions: ...,` declaration for conflict reporting.
const EXISTING_PAGE_EXTENSIONS_VALUE_RE = /pageExtensions:[^,\n]+,?/;

// Render-mode → pageExtensions conditional. "everywhere" doesn't get a
// pageExtensions block — files are plain `.tsx` and ship to prod normally.
const PAGE_EXTENSIONS_BLOCKS = {
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

// Builds the outputFileTracingIncludes block that ships globals.css alongside
// the tokens-page function bundle. Without this, Vercel/serverless runtimes
// don't include the CSS source file (it's normally compiled into static
// assets), so the runtime fs.readFile in the page throws ENOENT, readCss
// swallows it as null, and every token swatch falls through to the empty
// state — even though globals.css is full of declarations. Tracing makes
// the file part of the deployed function bundle.
function buildTracingBlock(routeUrl, cssEntry) {
  // Tracing key matches Next.js's app-router pattern for the page that does
  // the fs.readFile — `<routeUrl>/tokens/[domain]`. Vercel matches by route.
  const key = `${routeUrl}/tokens/[domain]`;
  return `  // adhd:sync-docs — file-tracing for tokens route (so globals.css ships with the serverless function)
  outputFileTracingIncludes: {
    ${JSON.stringify(key)}: [${JSON.stringify('./' + cssEntry)}],
  },`;
}

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

  const renderMode = options.renderMode || 'dev-only';
  const { routeUrl, cssEntry } = options;

  // pageExtensions block: only the two excluding render modes emit one.
  // "everywhere" mode ships files in plain .tsx, no gate needed.
  let pageExtensionsBlock = null;
  if (renderMode !== 'everywhere') {
    pageExtensionsBlock = PAGE_EXTENSIONS_BLOCKS[renderMode];
    if (!pageExtensionsBlock) {
      throw new Error(`Unknown renderMode: ${renderMode}. Expected one of: ${[...Object.keys(PAGE_EXTENSIONS_BLOCKS), 'everywhere'].join(', ')}.`);
    }
    // Detect existing different pageExtensions before we try to add ours.
    if (EXISTING_PAGE_EXTENSIONS_RE.test(source)) {
      if (options.detectOnly) {
        const existing = EXISTING_PAGE_EXTENSIONS_VALUE_RE.exec(source)[0];
        return { conflict: true, existing };
      }
      throw new Error('next.config already sets pageExtensions to a different value. Run with detectOnly: true to inspect and prompt the user.');
    }
  }

  // Tracing block: emitted whenever we have route + css info AND the page
  // might be served by a serverless function. Dev-only mode runs locally
  // via `next dev` (project root is cwd, no tracing needed); the other two
  // modes deploy to Vercel/serverless where tracing IS needed.
  let tracingBlock = null;
  if (renderMode !== 'dev-only' && routeUrl && cssEntry) {
    tracingBlock = buildTracingBlock(routeUrl, cssEntry);
  }

  if (!pageExtensionsBlock && !tracingBlock) {
    // Nothing to patch — "everywhere" mode with no route info (legacy callers).
    return source;
  }

  const insertAt = findConfigObjectStart(source);
  if (insertAt === -1) {
    throw new Error('Could not locate the config object in next.config. Manual edit required.');
  }

  const blocks = [pageExtensionsBlock, tracingBlock].filter(Boolean).join('\n');
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt).replace(/^\n/, '');
  return before + '\n' + blocks + '\n' + after;
}

module.exports = { patchNextConfig, isPatched };
