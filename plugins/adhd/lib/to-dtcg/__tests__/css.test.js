'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('css source: produces expected DTCG byte-for-byte', () => {
  const out = execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', 'none',
  ], { encoding: 'utf8' });

  const expected = fs.readFileSync(path.join(fixturesDir, 'sample.dtcg.json'), 'utf8');
  assert.equal(out, expected);
});
