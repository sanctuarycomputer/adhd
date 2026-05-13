'use strict';

// Per-component fingerprints for pull-component / pull-all-components.
//
// After a successful pull we record an 8-char SHA-256 prefix in
// adhd.config.ts (next to `pulledAt`). On the next pull we hash the
// fresh Figma extract + the adhd-config fields that affect pull output
// (naming convention etc.) and compare. Match → early-exit, nothing
// changed since last pull, skip the parse/diff/write loop.
//
// Fail mode is intentionally false-positive: any change to anything in
// the hashed input forces a re-sync. False negatives (skip when output
// would differ) would be a silent correctness bug, so we'd rather pay
// for occasional redundant re-syncs.
//
// 8 hex characters = 32 bits of fingerprint space. Collisions across
// the dozens-to-hundreds of components a typical project tracks are
// astronomically unlikely; the lookup happens by component path
// anyway, so even a hash collision wouldn't cross-contaminate.

const crypto = require('node:crypto');

// Stable JSON: keys sorted at every level. JSON.stringify's iteration
// order is V8-stable in practice but not guaranteed by the spec; the
// canonical form removes that dependency.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

// Hash an arbitrary input (extract + relevant config bits, etc.) to an
// 8-hex-char Git-style short SHA. Caller controls what goes in.
function computeFingerprint(input) {
  const canonical = canonicalJson(input);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 8);
}

// Extract the adhd-config fields that change pull-component's OUTPUT
// (not just its execution). Anything in here goes into the fingerprint
// alongside the Figma extract — changing naming-convention or cssEntry
// must invalidate cached fingerprints because the same Figma input
// produces different code with the new config.
//
// Intentionally narrow: `figma.url` doesn't affect output (it's where
// to fetch from, not what to write); `--annotate` / `--allow-unbound`
// are flags that don't change a successful pull's generated code.
// Add fields here if/when they're observed to affect output.
function relevantConfigFields(config) {
  return {
    naming: config && config.naming != null ? config.naming : 'kebab-case',
    cssEntry: config && config.cssEntry ? String(config.cssEntry) : null,
  };
}

module.exports = { computeFingerprint, canonicalJson, relevantConfigFields };
