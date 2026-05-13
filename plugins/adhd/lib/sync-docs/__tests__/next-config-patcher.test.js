'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { patchNextConfig, isPatched } = require('../next-config-patcher');

const TS_MINIMAL = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.pravatar.cc" }],
  },
};

export default nextConfig;
`;

const TS_ALREADY_PATCHED = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.pravatar.cc" }],
  },
};

export default nextConfig;
`;

const TS_WITH_DIFFERENT_PAGE_EXTENSIONS = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: ['mdx', 'ts', 'tsx'],
};

export default nextConfig;
`;

test('patches a minimal next.config.ts with the conditional pageExtensions block', () => {
  const out = patchNextConfig(TS_MINIMAL);
  assert.match(out, /pageExtensions:\s*process\.env\.NODE_ENV/);
  assert.match(out, /'design-system\.tsx'/);
  // Existing config preserved
  assert.match(out, /images:/);
  assert.match(out, /remotePatterns:/);
});

test('isPatched returns true after patching', () => {
  const out = patchNextConfig(TS_MINIMAL);
  assert.equal(isPatched(out), true);
});

test('patchNextConfig is idempotent when already patched', () => {
  const out = patchNextConfig(TS_ALREADY_PATCHED);
  assert.equal(out, TS_ALREADY_PATCHED);
});

test('isPatched returns false on an unpatched file', () => {
  assert.equal(isPatched(TS_MINIMAL), false);
});

test('patchNextConfig refuses to silently overwrite an existing different pageExtensions; returns { conflict: true }', () => {
  const r = patchNextConfig(TS_WITH_DIFFERENT_PAGE_EXTENSIONS, { detectOnly: true });
  assert.equal(r.conflict, true);
  assert.match(r.existing, /pageExtensions:\s*\['mdx'/);
});

test('patches with the dev-only conditional by default', () => {
  // Default renderMode is dev-only — gates the page-extension swap on NODE_ENV.
  const out = patchNextConfig(TS_MINIMAL);
  assert.match(out, /process\.env\.NODE_ENV === 'production'/);
  assert.doesNotMatch(out, /VERCEL_ENV/);
});

test('patches with the Vercel-preview conditional when renderMode: "vercel-preview"', () => {
  // The compound condition excludes on Vercel production AND on any non-Vercel
  // production deploy, while letting Vercel preview deploys render the route.
  const out = patchNextConfig(TS_MINIMAL, { renderMode: 'vercel-preview' });
  assert.match(out, /process\.env\.VERCEL_ENV === 'production'/);
  // Also includes the !VERCEL && NODE_ENV='production' fallback for non-Vercel hosts.
  assert.match(out, /!process\.env\.VERCEL/);
  assert.match(out, /process\.env\.NODE_ENV === 'production'/);
  assert.match(out, /'design-system\.tsx'/);
});

test('isPatched recognizes EITHER conditional shape as already-patched (idempotency)', () => {
  const devOnly = patchNextConfig(TS_MINIMAL, { renderMode: 'dev-only' });
  const vercelPreview = patchNextConfig(TS_MINIMAL, { renderMode: 'vercel-preview' });
  assert.equal(isPatched(devOnly), true);
  assert.equal(isPatched(vercelPreview), true);
  // Re-running on a Vercel-preview-patched file is a no-op
  assert.equal(patchNextConfig(vercelPreview, { renderMode: 'vercel-preview' }), vercelPreview);
  // Re-running with a DIFFERENT renderMode on an already-patched file is also a
  // no-op (sentinel detection ignores which env var gates the conditional). To
  // switch modes, the user removes the marker line and re-syncs.
  assert.equal(patchNextConfig(vercelPreview, { renderMode: 'dev-only' }), vercelPreview);
});

test('patchNextConfig throws on an unknown renderMode', () => {
  assert.throws(
    () => patchNextConfig(TS_MINIMAL, { renderMode: 'preview' }),
    /Unknown renderMode: preview/,
  );
});

test('vercel-preview mode also emits outputFileTracingIncludes when routeUrl + cssEntry are passed', () => {
  // Without tracing, Vercel/serverless deploys don't bundle globals.css with
  // the tokens function, fs.readFile throws ENOENT, and the page shows empty
  // states for every token domain. This was the user's reported bug.
  const out = patchNextConfig(TS_MINIMAL, {
    renderMode: 'vercel-preview',
    routeUrl: '/-docs',
    cssEntry: 'app/globals.css',
  });
  assert.match(out, /pageExtensions:/);
  assert.match(out, /outputFileTracingIncludes:/);
  assert.match(out, /"\/-docs\/tokens\/\[domain\]":\s*\["\.\/app\/globals\.css"\]/);
});

test('everywhere mode emits ONLY outputFileTracingIncludes (no pageExtensions gate)', () => {
  // "everywhere" ships files as plain .tsx with no extension gate, but the
  // tokens page still runs on the serverless function in prod — it still
  // needs the CSS source traced.
  const out = patchNextConfig(TS_MINIMAL, {
    renderMode: 'everywhere',
    routeUrl: '/-docs',
    cssEntry: 'src/app/globals.css',
  });
  assert.match(out, /outputFileTracingIncludes:/);
  assert.match(out, /"\/-docs\/tokens\/\[domain\]":\s*\["\.\/src\/app\/globals\.css"\]/);
  // No pageExtensions block in this mode.
  assert.doesNotMatch(out, /pageExtensions:/);
});

test('dev-only mode does NOT emit tracing (page runs locally; no serverless bundle to trace)', () => {
  const out = patchNextConfig(TS_MINIMAL, {
    renderMode: 'dev-only',
    routeUrl: '/-docs',
    cssEntry: 'app/globals.css',
  });
  assert.match(out, /pageExtensions:/);
  assert.doesNotMatch(out, /outputFileTracingIncludes:/);
});

test('isPatched recognizes a tracing-only "everywhere" patch as already-patched', () => {
  const out = patchNextConfig(TS_MINIMAL, {
    renderMode: 'everywhere',
    routeUrl: '/-docs',
    cssEntry: 'app/globals.css',
  });
  assert.equal(isPatched(out), true);
  // Re-running on the patched output is a no-op.
  assert.equal(
    patchNextConfig(out, { renderMode: 'everywhere', routeUrl: '/-docs', cssEntry: 'app/globals.css' }),
    out,
  );
});

test('tracing key uses the supplied routeUrl, not a hardcoded path', () => {
  // Some users pick a different route URL (e.g. /design-system). The tracing
  // key must match THEIR route, not the default.
  const out = patchNextConfig(TS_MINIMAL, {
    renderMode: 'vercel-preview',
    routeUrl: '/design-system',
    cssEntry: 'app/globals.css',
  });
  assert.match(out, /"\/design-system\/tokens\/\[domain\]"/);
});
