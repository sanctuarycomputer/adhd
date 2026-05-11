'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints subcommand usage and exits 0', () => {
  const r = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /parse-tokens/);
  assert.match(r.stdout, /parse-props/);
  assert.match(r.stdout, /slug/);
  assert.match(r.stdout, /patch-next-config/);
  assert.match(r.stdout, /patch-robots/);
  assert.match(r.stdout, /detect-install/);
  assert.match(r.stdout, /install/);
});

test('cli with no args exits 2', () => {
  assert.equal(spawnSync('node', [CLI], { encoding: 'utf8' }).status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  assert.equal(spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' }).status, 2);
});
