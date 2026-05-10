'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli prints a not-implemented message and exits 2 when invoked with no args', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not implemented/);
});
