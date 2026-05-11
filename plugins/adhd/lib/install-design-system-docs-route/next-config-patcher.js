'use strict';

// Detection: look for the sentinel "design-system.tsx" pageExtension entry
// inside the conditional. This is the unique fingerprint of OUR patch.
const PATCHED_SENTINEL = /pageExtensions:\s*process\.env\.NODE_ENV\s*===\s*['"]production['"][\s\S]*?'design-system\.tsx'/;

// Detection: any other pageExtensions definition.
const EXISTING_PAGE_EXTENSIONS_RE = /pageExtensions:\s*\[/;

const PATCH_BLOCK = `  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],`;

function isPatched(source) {
  return PATCHED_SENTINEL.test(source);
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

function patchNextConfig(source, opts = {}) {
  if (isPatched(source)) return source;

  // Detect existing different pageExtensions
  if (EXISTING_PAGE_EXTENSIONS_RE.test(source)) {
    if (opts.detectOnly) {
      const existing = /pageExtensions:[^,\n]+,?/.exec(source)[0];
      return { conflict: true, existing };
    }
    // Caller hasn't checked; we still refuse to silently merge.
    throw new Error('next.config already sets pageExtensions to a different value. Run with detectOnly: true to inspect and prompt the user.');
  }

  const insertAt = findConfigObjectStart(source);
  if (insertAt === -1) {
    throw new Error('Could not locate the config object in next.config. Manual edit required.');
  }

  // Insert the patch block immediately inside the object literal, before existing
  // properties. This puts it at the top of the config for visibility.
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt);
  // Add a newline if needed for clean formatting
  const sep = after.startsWith('\n') ? '' : '\n';
  return before + sep + PATCH_BLOCK + '\n' + after.replace(/^\n/, '');
}

module.exports = { patchNextConfig, isPatched };
