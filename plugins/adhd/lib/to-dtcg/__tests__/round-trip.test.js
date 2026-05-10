'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('css output and figma output are equal for tokens both sources can represent', () => {
  const fromCss = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' }));

  const fromFigma = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'figma',
    '--input', path.join(fixturesDir, 'sample-figma-rest-shape.json'),
  ], { encoding: 'utf8' }));

  // Figma's variable system doesn't natively represent shadow tokens (they're
  // attached to layers as effects, not as variables). So the figma output
  // legitimately lacks a `shadow` key while the css output has one. Compare
  // only domains that both sources can produce.
  assert.deepEqual(fromCss.color, fromFigma.color);
  assert.deepEqual(fromCss.spacing, fromFigma.spacing);
});
