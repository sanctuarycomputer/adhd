'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

// This test exercises the round-trip from cli.js's CSS source through TokensBrücke's
// import + export. The fixture `TokensBrücke.json` is a REAL DTCG export from a Figma
// file (https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd) that was populated
// by importing cli.js's CSS-source output via the TokensBrücke community plugin.
//
// The round-trip is PARTIAL — TokensBrücke's import is lossy:
//   - Spacing units are stripped on import (`1rem` → `1px`).
//   - Shadow $type is downgraded to "string" (Figma has no native shadow variable type).
//   - Primitives in 2-mode collections get a phantom mode value (e.g., "#ffffff" for the
//     unspecified Light mode of gold-100).
//   - Path prefix is dropped on export with omitCollectionNames=true (`{color.gold.100}`
//     becomes `{gold.100}`).
//
// This test verifies what DOES round-trip: the hex color values for primitive colors
// (gold/red palette tokens). Anything more ambitious would document a TokensBrücke
// limitation rather than a cli.js bug.

test('cli.js CSS output and TokensBrücke export agree on primitive color hex values', () => {
  const fromCss = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' }));

  const fromTokensBrucke = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'TokensBrücke.json'), 'utf8'));

  // Our cli.js path: color.gold.100 / color.gold.900 / color.red.500
  // TokensBrücke path (omitCollectionNames=true): gold.100 / gold.900 / red.500
  // Hex values should match.
  assert.equal(fromCss.color.gold['100'].$value, fromTokensBrucke.gold['100'].$value, 'gold-100 hex');
  assert.equal(fromCss.color.gold['900'].$value, fromTokensBrucke.gold['900'].$value, 'gold-900 hex');
  assert.equal(fromCss.color.red['500'].$value, fromTokensBrucke.red['500'].$value, 'red-500 hex');
});

test('TokensBrücke export captures the brand-surface semantic with mode aliases', () => {
  const fromTokensBrucke = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'TokensBrücke.json'), 'utf8'));
  const surface = fromTokensBrucke.brand.surface;

  assert.equal(surface.$type, 'color');
  // Both modes should be set as aliases. (The exact $value at the top level depends
  // on which mode TokensBrücke picks as default — which we don't control.)
  assert.match(surface.$extensions.mode.light, /^\{gold\.\d+\}$/);
  assert.match(surface.$extensions.mode.dark, /^\{gold\.\d+\}$/);
});

test('TokensBrücke export uses $extensions.mode encoding (matches our format choice)', () => {
  const fromTokensBrucke = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'TokensBrücke.json'), 'utf8'));
  // brand.surface has both light and dark modes
  assert.ok(fromTokensBrucke.brand.surface.$extensions.mode.light);
  assert.ok(fromTokensBrucke.brand.surface.$extensions.mode.dark);
});
