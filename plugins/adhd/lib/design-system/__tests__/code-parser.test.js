'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCodeDesignSystem } = require('../code-parser');

test('parses primitives from @theme {} as default-mode literals', () => {
  const ds = parseCodeDesignSystem(`
    @theme {
      --color-gold-100: #faf0c5;
      --color-gold-900: #3f2909;
    }
  `);
  const gold100 = ds.tokens.find(t => t.path === 'gold/100' && t.domain === 'color');
  assert.ok(gold100);
  assert.deepEqual(gold100.values.default, { type: 'literal', value: '#faf0c5' });
  const gold900 = ds.tokens.find(t => t.path === 'gold/900' && t.domain === 'color');
  assert.deepEqual(gold900.values.default, { type: 'literal', value: '#3f2909' });
});

test('parses :root semantic vars as light-mode literals', () => {
  const ds = parseCodeDesignSystem(`
    :root {
      --background: #ffffff;
      --foreground: #171717;
    }
  `);
  const bg = ds.tokens.find(t => t.path === 'background');
  assert.ok(bg);
  assert.deepEqual(bg.values.light, { type: 'literal', value: '#ffffff' });
});

test('parses @media (prefers-color-scheme: dark) :root {} as dark-mode', () => {
  const ds = parseCodeDesignSystem(`
    :root { --background: #ffffff; }
    @media (prefers-color-scheme: dark) {
      :root { --background: #0a0a0a; }
    }
  `);
  const bg = ds.tokens.find(t => t.path === 'background');
  assert.deepEqual(bg.values.light, { type: 'literal', value: '#ffffff' });
  assert.deepEqual(bg.values.dark,  { type: 'literal', value: '#0a0a0a' });
});

test('parses :root[data-theme="dark"] as dark-mode (alternative form)', () => {
  const ds = parseCodeDesignSystem(`
    :root { --background: #ffffff; }
    :root[data-theme="dark"] { --background: #0a0a0a; }
  `);
  const bg = ds.tokens.find(t => t.path === 'background');
  assert.deepEqual(bg.values.light, { type: 'literal', value: '#ffffff' });
  assert.deepEqual(bg.values.dark,  { type: 'literal', value: '#0a0a0a' });
});

test('var(--x) references become aliases', () => {
  const ds = parseCodeDesignSystem(`
    :root {
      --brand-surface: var(--color-gold-100);
    }
    @media (prefers-color-scheme: dark) {
      :root { --brand-surface: var(--color-gold-900); }
    }
  `);
  const t = ds.tokens.find(x => x.path === 'brand/surface');
  assert.deepEqual(t.values.light, { type: 'alias', target: 'gold/100' });
  assert.deepEqual(t.values.dark,  { type: 'alias', target: 'gold/900' });
});

test('@theme inline entries land in ds.exposure, not ds.tokens', () => {
  const ds = parseCodeDesignSystem(`
    :root { --brand-surface: var(--color-gold-100); }
    @theme inline {
      --color-brand-surface: var(--brand-surface);
    }
  `);
  // Token lives in tokens (it has its own value)
  assert.ok(ds.tokens.find(t => t.path === 'brand/surface'));
  // Exposure is a separate metadata layer
  assert.ok(ds.exposure.find(e => e.cssVar === '--color-brand-surface' && e.target === 'brand-surface'));
  // Token list does NOT contain the exposure-only var
  assert.equal(ds.tokens.find(t => t.path === 'color/brand/surface'), undefined);
});

test('infers domain from variable name prefix', () => {
  const ds = parseCodeDesignSystem(`
    @theme {
      --color-x: red;
      --space-2: 8px;
      --radius-sm: 4px;
      --shadow-md: 0 1px 2px rgba(0,0,0,0.1);
    }
  `);
  const byPath = Object.fromEntries(ds.tokens.map(t => [t.path, t.domain]));
  assert.equal(byPath['x'], 'color');
  assert.equal(byPath['2'], 'spacing');
  assert.equal(byPath['sm'], 'radius');
  assert.equal(byPath['md'], 'shadow');
});

test('multi-hyphen semantic var names preserve internal hyphens (only first hyphen is path separator)', () => {
  const ds = parseCodeDesignSystem(`
    :root {
      --brand-surface-raised: var(--color-gold-200);
      --brand-on-surface: var(--color-gold-800);
    }
  `);
  // Should be brand/surface-raised (literal hyphen inside leaf), NOT brand/surface/raised
  assert.ok(ds.tokens.find(t => t.path === 'brand/surface-raised'),
    'Expected path to be brand/surface-raised; got: ' + ds.tokens.map(t => t.path).join(', '));
  assert.ok(ds.tokens.find(t => t.path === 'brand/on-surface'),
    'Expected path to be brand/on-surface');
  // Verify the var(--...) reference target uses the same hyphen-preserving rule
  const t = ds.tokens.find(x => x.path === 'brand/surface-raised');
  assert.deepEqual(t.values.light, { type: 'alias', target: 'gold/200' });
});
