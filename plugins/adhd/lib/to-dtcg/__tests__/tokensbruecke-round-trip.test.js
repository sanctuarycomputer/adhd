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
// Recommended export settings: Color mode HEX, Use DTCG keys ON, Omit collection names
// OFF, Include figma metadata OFF, all "Include styles" toggles OFF.
//
// The round-trip is PARTIAL — TokensBrücke's import is lossy in known ways:
//   - Spacing units are stripped on import (`1rem` → `1px`).
//   - Shadow $type is downgraded to "string" (Figma has no native shadow variable type).
//   - Primitives in 2-mode collections get a phantom mode value (e.g., "#ffffff" for
//     the unspecified Light mode of gold-100). The default `$value` is correct.
//   - Top-level `$value` for semantic tokens defaults to the Dark mode value (TokensBrücke
//     picks Dark as the collection's default mode); cli.js sets it to the Light value.
//
// What DOES round-trip cleanly:
//   - Primitive color hex values (gold-100, gold-900, red-500).
//   - Top-level structure (color/spacing/shadow namespaces).
//   - Alias path format (`{color.gold.100}` syntax preserved with omit-collection-names OFF).
//   - `$extensions.mode.{light,dark}` encoding for semantic tokens.
//   - Mode alias values (the per-mode references inside `$extensions.mode`).

test('cli.js CSS output and TokensBrücke export agree on primitive color hex values', () => {
  const fromCss = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' }));

  const fromTokensBrucke = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'TokensBrücke.json'), 'utf8'));

  // With omit-collection-names OFF, both sides use color.gold.X and color.red.X paths.
  assert.equal(fromCss.color.gold['100'].$value, fromTokensBrucke.color.gold['100'].$value, 'gold-100 hex');
  assert.equal(fromCss.color.gold['900'].$value, fromTokensBrucke.color.gold['900'].$value, 'gold-900 hex');
  assert.equal(fromCss.color.red['500'].$value, fromTokensBrucke.color.red['500'].$value, 'red-500 hex');
});

test('Top-level structure matches: color, shadow, spacing namespaces present in both', () => {
  const fromCss = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' }));

  const fromTokensBrucke = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'TokensBrücke.json'), 'utf8'));

  for (const ns of ['color', 'shadow', 'spacing']) {
    assert.ok(fromCss[ns], `cli.js output should have '${ns}' namespace`);
    assert.ok(fromTokensBrucke[ns], `TokensBrücke export should have '${ns}' namespace`);
  }
});

test('Brand-surface mode aliases match exactly between cli.js and TokensBrücke', () => {
  const fromCss = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'css',
    '--input', path.join(fixturesDir, 'sample-globals.css'),
    '--tailwind-theme', path.join(fixturesDir, 'tailwind-v4-theme.css'),
  ], { encoding: 'utf8' }));

  const fromTokensBrucke = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'TokensBrücke.json'), 'utf8'));

  const cssSurface = fromCss.color.brand.surface;
  const tbSurface = fromTokensBrucke.color.brand.surface;

  // Both use $extensions.mode encoding with lowercase keys + bare alias values.
  // With omit-collection-names OFF, both use {color.gold.X} alias format — exact match.
  assert.equal(cssSurface.$extensions.mode.light, tbSurface.$extensions.mode.light, 'Light alias');
  assert.equal(cssSurface.$extensions.mode.dark, tbSurface.$extensions.mode.dark, 'Dark alias');

  // Both have $type: color.
  assert.equal(cssSurface.$type, 'color');
  assert.equal(tbSurface.$type, 'color');

  // Top-level $value differs by design: cli.js picks Light (the canonical default); TokensBrücke
  // picks whichever mode Figma reports as the collection default (typically Dark for our setup).
  // Both values are valid aliases pointing at gold-X.
  assert.match(cssSurface.$value, /^\{color\.gold\.\d+\}$/);
  assert.match(tbSurface.$value, /^\{color\.gold\.\d+\}$/);
});

test('Both export $extensions.mode encoding (matches our format choice)', () => {
  const fromTokensBrucke = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'TokensBrücke.json'), 'utf8'));
  // brand.surface has both light and dark modes
  assert.ok(fromTokensBrucke.color.brand.surface.$extensions.mode.light);
  assert.ok(fromTokensBrucke.color.brand.surface.$extensions.mode.dark);
});
