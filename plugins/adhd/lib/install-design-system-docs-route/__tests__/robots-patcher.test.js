'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { patchRobots } = require('../robots-patcher');

test('creates robots.txt content if input is empty', () => {
  const out = patchRobots('', '/-docs');
  assert.match(out, /User-agent: \*/);
  assert.match(out, /Disallow: \/-docs/);
});

test('creates robots.txt content if input is null/undefined', () => {
  const out = patchRobots(null, '/-docs');
  assert.match(out, /User-agent: \*/);
  assert.match(out, /Disallow: \/-docs/);
});

test('appends a Disallow line to an existing robots.txt', () => {
  const existing = `User-agent: *
Disallow: /admin
`;
  const out = patchRobots(existing, '/-docs');
  assert.match(out, /Disallow: \/admin/);
  assert.match(out, /Disallow: \/-docs/);
});

test('idempotent: re-patching an already-patched robots.txt returns unchanged', () => {
  const existing = `User-agent: *
Disallow: /-docs
`;
  const out = patchRobots(existing, '/-docs');
  assert.equal(out, existing);
});

test('idempotent: matching is exact (does not match /-docs-other)', () => {
  const existing = `User-agent: *
Disallow: /-docs-other
`;
  const out = patchRobots(existing, '/-docs');
  assert.match(out, /Disallow: \/-docs-other/);
  assert.match(out, /Disallow: \/-docs$/m);
});
