'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints subcommand usage and exits 0', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /parse/);
  assert.match(result.stdout, /generate-preview/);
  assert.match(result.stdout, /consolidation-script/);
  assert.match(result.stdout, /preflight/);
});

test('cli with no args exits 2 with usage', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  const result = spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
