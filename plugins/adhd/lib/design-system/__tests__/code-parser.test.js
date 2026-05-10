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

test('includeTailwindDefaults: returns >200 color tokens (full Tailwind palette)', () => {
  const ds = parseCodeDesignSystem('', { includeTailwindDefaults: true });
  const colorTokens = ds.tokens.filter(t => t.domain === 'color');
  assert.ok(colorTokens.length > 200,
    'expected >200 Tailwind color tokens, got ' + colorTokens.length);
});

test('includeTailwindDefaults: merges Tailwind defaults with user globals.css', () => {
  const ds = parseCodeDesignSystem(`
    @theme {
      --color-gold-100: #faf0c5;
    }
  `, { includeTailwindDefaults: true });
  // User's gold/100 present
  assert.ok(ds.tokens.find(t => t.path === 'gold/100'));
  // Tailwind's red/500 present too
  assert.ok(ds.tokens.find(t => t.path === 'red/500'));
});

test('includeTailwindDefaults: globals.css overrides take precedence over Tailwind defaults', () => {
  const ds = parseCodeDesignSystem(`
    @theme {
      --radius-sm: 999px;
    }
  `, { includeTailwindDefaults: true });
  const radiusSm = ds.tokens.find(t => t.path === 'sm' && t.domain === 'radius');
  assert.ok(radiusSm);
  assert.deepEqual(radiusSm.values.default, { type: 'literal', value: '999px' });
});

test('includeTailwindDefaults: --shadow-* tokens get domain shadow', () => {
  const ds = parseCodeDesignSystem('', { includeTailwindDefaults: true });
  const shadowMd = ds.tokens.find(t => t.path === 'md' && t.domain === 'shadow');
  assert.ok(shadowMd, 'expected --shadow-md to map to path md, domain shadow');
  // drop-shadow keeps family in path to avoid colliding with --shadow-*
  const dropShadowMd = ds.tokens.find(t => t.path === 'drop-shadow/md');
  assert.ok(dropShadowMd, 'expected --drop-shadow-md → drop-shadow/md');
  assert.equal(dropShadowMd.domain, 'shadow');
});

test('includeTailwindDefaults: --default-* meta vars are filtered out', () => {
  // The --default-* category in @theme default references other vars via
  // the special --theme(...) syntax and isn't standalone tokens.
  const ds = parseCodeDesignSystem('', { includeTailwindDefaults: true });
  const allCssVars = ds.tokens.map(t => t.cssVar).join(' ');
  assert.ok(!allCssVars.includes('--default-font-family'),
    'default-font-family should be filtered out');
  assert.ok(!allCssVars.includes('--default-transition-duration'),
    'default-transition-duration should be filtered out');
});

test('includeTailwindDefaults: previously-skipped categories now produce tokens', () => {
  const ds = parseCodeDesignSystem('', { includeTailwindDefaults: true });
  const byPath = Object.fromEntries(
    ds.tokens.map(t => [t.domain + ':' + t.path, t]),
  );
  assert.ok(byPath['breakpoint:md'], 'expected --breakpoint-md → domain breakpoint, path md');
  assert.ok(byPath['ease:out'], 'expected --ease-out → domain ease, path out');
  assert.equal(byPath['ease:in-out'].domain, 'ease');
  assert.equal(byPath['ease:in-out'].path, 'in-out', 'ease is a flat domain — leaf not split on hyphen');
  assert.ok(byPath['container:md']);
  assert.ok(byPath['blur:md']);
  assert.ok(byPath['perspective:near']);
  assert.ok(byPath['aspect:video']);
  assert.ok(byPath['animate:spin']);
});

test('includeTailwindDefaults: synthesizes opacity / border-width / z-index scales', () => {
  const ds = parseCodeDesignSystem('', { includeTailwindDefaults: true });
  const byPath = Object.fromEntries(
    ds.tokens.map(t => [t.domain + ':' + t.path, t]),
  );
  // Opacity: 21 values, 0 → 100 by 5, stored as 0–1 floats.
  const opacity = ds.tokens.filter(t => t.domain === 'opacity');
  assert.equal(opacity.length, 21);
  assert.equal(byPath['opacity:0'].values.default.value, '0');
  assert.equal(byPath['opacity:5'].values.default.value, '0.05');
  assert.equal(byPath['opacity:100'].values.default.value, '1');
  // Border-width: 5 values.
  const bw = ds.tokens.filter(t => t.domain === 'border-width');
  assert.equal(bw.length, 5);
  assert.equal(byPath['border-width:0'].values.default.value, '0px');
  assert.equal(byPath['border-width:8'].values.default.value, '8px');
  // Z-index: 6 values (0..50 by 10).
  const z = ds.tokens.filter(t => t.domain === 'z-index');
  assert.equal(z.length, 6);
  assert.equal(byPath['z-index:0'].values.default.value, '0');
  assert.equal(byPath['z-index:50'].values.default.value, '50');
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
