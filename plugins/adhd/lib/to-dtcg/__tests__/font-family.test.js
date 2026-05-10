'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { parseFontFamily } = require('../cli.js');

test('parseFontFamily: single family', () => {
  assert.deepEqual(parseFontFamily('sans-serif'), ['sans-serif']);
});

test('parseFontFamily: comma-separated stack', () => {
  assert.deepEqual(parseFontFamily('Inter, sans-serif'), ['Inter', 'sans-serif']);
});

test('parseFontFamily: quoted family names (double quotes)', () => {
  assert.deepEqual(parseFontFamily('"Geist Sans", system-ui'), ['Geist Sans', 'system-ui']);
});

test('parseFontFamily: quoted family names (single quotes)', () => {
  assert.deepEqual(parseFontFamily("'Helvetica Neue', serif"), ['Helvetica Neue', 'serif']);
});

test('parseFontFamily: extra whitespace tolerated', () => {
  assert.deepEqual(parseFontFamily('  Inter  ,   sans-serif  '), ['Inter', 'sans-serif']);
});

test('parseFontFamily: long Tailwind v4 default stack', () => {
  const raw = "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";
  assert.deepEqual(parseFontFamily(raw), [
    'ui-sans-serif',
    'system-ui',
    'sans-serif',
    'Apple Color Emoji',
    'Segoe UI Emoji',
  ]);
});
