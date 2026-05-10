'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('css output and figma output are byte-equal', () => {
  const fromCss = execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' });

  const fromFigma = execFileSync('node', [
    cliPath,
    '--source', 'figma',
    '--input', path.join(fixturesDir, 'sample-figma-response.json'),
  ], { encoding: 'utf8' });

  assert.equal(fromCss, fromFigma);
});
