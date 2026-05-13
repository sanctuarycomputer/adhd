'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyToCss } = require('../code-writer');

const STARTER_CSS = `@import "tailwindcss";

@theme {
  --color-gold-100: #faf0c5;
}

:root {
  --background: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
  }
}

@theme inline {
  --color-background: var(--background);
}
`;

test('updates an existing primitive in @theme', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-primitive', cssVar: '--color-gold-100', value: '#fffacd' },
  ]);
  assert.match(out, /--color-gold-100:\s*#fffacd;/);
});

test('adds a new primitive to @theme', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-primitive', cssVar: '--color-gold-200', value: '#f5dd87' },
  ]);
  assert.match(out, /--color-gold-200:\s*#f5dd87;/);
  // Existing entry preserved
  assert.match(out, /--color-gold-100:\s*#faf0c5;/);
});

test('updates a light-mode semantic var in :root', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--background', mode: 'light', value: '#fefefe' },
  ]);
  assert.match(out, /:root\s*\{[^}]*--background:\s*#fefefe;/);
});

test('updates a dark-mode semantic var inside @media block', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--background', mode: 'dark', value: '#000000' },
  ]);
  assert.match(out, /prefers-color-scheme:\s*dark[^}]+--background:\s*#000000;/s);
});

test('adds an exposure alias to @theme inline if it does not exist', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-exposure', cssVar: '--color-foreground', target: 'foreground' },
  ]);
  assert.match(out, /@theme\s+inline[^}]+--color-foreground:\s*var\(--foreground\);/s);
});

test('preserves existing entries when adding new ones', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--foreground', mode: 'light', value: '#171717' },
  ]);
  assert.match(out, /--background:\s*#ffffff;/);  // preserved
  assert.match(out, /--foreground:\s*#171717;/);  // added
});

test('aliases write as var() references', () => {
  const out = applyToCss(STARTER_CSS, [
    { kind: 'set-semantic', cssVar: '--brand-surface', mode: 'light', valueAlias: '--color-gold-100' },
  ]);
  assert.match(out, /:root\s*\{[^}]*--brand-surface:\s*var\(--color-gold-100\);/);
});
