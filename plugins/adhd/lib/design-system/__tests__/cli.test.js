'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints usage and exits 0', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /compare/);
  assert.match(result.stdout, /apply/);
});

test('cli with no args exits 2 with not-implemented message', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not implemented/);
});
