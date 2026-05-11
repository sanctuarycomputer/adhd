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
