'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseArgs } = require('../cli.js');

test('parseArgs: --source css --input foo.css', () => {
  const args = parseArgs(['--source', 'css', '--input', 'foo.css']);
  assert.equal(args.source, 'css');
  assert.equal(args.input, 'foo.css');
  assert.equal(args.tailwindTheme, undefined);
});

test('parseArgs: --source figma --input bar.json', () => {
  const args = parseArgs(['--source', 'figma', '--input', 'bar.json']);
  assert.equal(args.source, 'figma');
  assert.equal(args.input, 'bar.json');
});

test('parseArgs: --tailwind-theme none', () => {
  const args = parseArgs(['--source', 'css', '--input', 'a.css', '--tailwind-theme', 'none']);
  assert.equal(args.tailwindTheme, 'none');
});

test('parseArgs: --tailwind-theme path', () => {
  const args = parseArgs(['--source', 'css', '--input', 'a.css', '--tailwind-theme', '/x/theme.css']);
  assert.equal(args.tailwindTheme, '/x/theme.css');
});

test('parseArgs: missing --source throws', () => {
  assert.throws(() => parseArgs(['--input', 'a.css']), /--source is required/);
});

test('parseArgs: invalid --source value throws', () => {
  assert.throws(() => parseArgs(['--source', 'xml', '--input', 'a.css']), /--source must be "css" or "figma"/);
});

test('parseArgs: missing --input throws', () => {
  assert.throws(() => parseArgs(['--source', 'css']), /--input is required/);
});
