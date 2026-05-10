'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTheme } = require('../theme-parser');

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, '..', '__fixtures__', 'sample-globals.css'),
  'utf8',
);

test('parseTheme returns sections for primitives, exposure, light, dark', () => {
  const theme = parseTheme(FIXTURE);
  assert.ok(theme.primitives, 'has primitives');
  assert.ok(theme.exposure,   'has exposure');
  assert.ok(theme.light,      'has light');
  assert.ok(theme.dark,       'has dark');
});

test('parseTheme captures @theme {} entries as primitives', () => {
  const theme = parseTheme(`
    @theme {
      --color-brand-600: #5e3aee;
      --space-2xl: 2rem;
    }
  `);
  assert.equal(theme.primitives['--color-brand-600'], '#5e3aee');
  assert.equal(theme.primitives['--space-2xl'], '2rem');
});

test('parseTheme captures :root and :root[data-theme="dark"] separately', () => {
  const theme = parseTheme(`
    :root {
      --color-surface-elevated: #ffffff;
    }
    :root[data-theme="dark"] {
      --color-surface-elevated: #1a1a1a;
    }
  `);
  assert.equal(theme.light['--color-surface-elevated'], '#ffffff');
  assert.equal(theme.dark['--color-surface-elevated'],  '#1a1a1a');
});

test('parseTheme captures dark-mode values from @media (prefers-color-scheme: dark)', () => {
  const theme = parseTheme(`
    :root {
      --color-surface: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-surface: #1a1a1a;
      }
    }
  `);
  assert.equal(theme.light['--color-surface'], '#ffffff');
  assert.equal(theme.dark['--color-surface'],  '#1a1a1a');
});

test('parseTheme captures @theme inline {} entries as exposure', () => {
  const theme = parseTheme(`
    @theme inline {
      --color-button-bg: var(--color-surface-elevated);
    }
  `);
  assert.equal(theme.exposure['--color-button-bg'], 'var(--color-surface-elevated)');
});

test('parseTheme tolerates whitespace, comments, and ordering variations', () => {
  const theme = parseTheme(`
    /* primitives */
    @theme {
      --color-x: red;
    }
    /* exposure */
    @theme inline {  --y: 1px;  }
  `);
  assert.equal(theme.primitives['--color-x'], 'red');
  assert.equal(theme.exposure['--y'], '1px');
});
