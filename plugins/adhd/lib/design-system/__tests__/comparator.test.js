'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareDesignSystems } = require('../comparator');

const codeOnly = {
  tokens: [
    { domain: 'color', path: 'gold/100', values: { default: { type: 'literal', value: '#faf0c5' } } },
  ],
  exposure: [],
  styles: { effects: [], text: [] },
};

test('classifies a token as same when both sides match exactly', () => {
  const figma = JSON.parse(JSON.stringify(codeOnly));
  const r = compareDesignSystems(codeOnly, figma);
  assert.equal(r.same.length, 1);
  assert.equal(r.conflict.length, 0);
});

test('classifies as conflict when same path different value', () => {
  const figma = {
    ...codeOnly,
    tokens: [{ domain: 'color', path: 'gold/100', values: { default: { type: 'literal', value: '#000000' } } }],
  };
  const r = compareDesignSystems(codeOnly, figma);
  assert.equal(r.conflict.length, 1);
  assert.equal(r.conflict[0].path, 'gold/100');
  assert.equal(r.conflict[0].mode, 'default');
});

test('classifies as code-only when figma lacks the token', () => {
  const figma = { tokens: [], exposure: [], styles: { effects: [], text: [] } };
  const r = compareDesignSystems(codeOnly, figma);
  assert.equal(r.codeOnly.length, 1);
  assert.equal(r.figmaOnly.length, 0);
});

test('classifies as figma-only when code lacks the token', () => {
  const empty = { tokens: [], exposure: [], styles: { effects: [], text: [] } };
  const r = compareDesignSystems(empty, codeOnly);
  assert.equal(r.figmaOnly.length, 1);
  assert.equal(r.codeOnly.length, 0);
});

test('treats hex case as equal', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'x', values: { default: { type: 'literal', value: '#ABCDEF' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{ domain: 'color', path: 'x', values: { default: { type: 'literal', value: '#abcdef' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.same.length, 1);
});

test('treats matching aliases as equal (alias to alias)', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'alias', target: 'gold/100' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = JSON.parse(JSON.stringify(code));
  const r = compareDesignSystems(code, figma);
  assert.equal(r.same.length, 1);
});

test('alias vs literal in same token is a conflict (broken alias)', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'alias', target: 'gold/100' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'literal', value: '#faf0c5' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.conflict.length, 1);
});

test('exposure-only entries do not appear in any classification', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'brand/surface', values: { light: { type: 'alias', target: 'gold/100' } } }],
    exposure: [{ cssVar: '--color-brand-surface', target: 'brand-surface' }],
    styles: { effects: [], text: [] },
  };
  const figma = JSON.parse(JSON.stringify(code));
  figma.exposure = [];
  const r = compareDesignSystems(code, figma);
  // brand/surface is `same`; exposure is silently filtered out (never compared)
  assert.equal(r.same.length, 1);
  assert.equal(r.conflict.length, 0);
  assert.equal(r.codeOnly.length, 0);
  assert.equal(r.figmaOnly.length, 0);
});

test('effect styles: classifies code-only / figma-only / same by name', () => {
  const code = {
    tokens: [], exposure: [],
    styles: {
      effects: [{ name: 'md' }, { name: 'lg' }, { name: 'inset-shadow/xs' }],
      text: [],
    },
  };
  const figma = {
    tokens: [], exposure: [],
    styles: {
      effects: [{ name: 'md' }, { name: 'old-style' }],
      text: [],
    },
  };
  const r = compareDesignSystems(code, figma);
  assert.ok(r.styles);
  assert.ok(r.styles.effects);
  assert.equal(r.styles.effects.same.length, 1);
  assert.equal(r.styles.effects.same[0].name, 'md');
  assert.equal(r.styles.effects.codeOnly.length, 2);
  assert.deepEqual(
    r.styles.effects.codeOnly.map(s => s.name).sort(),
    ['inset-shadow/xs', 'lg'],
  );
  assert.equal(r.styles.effects.figmaOnly.length, 1);
  assert.equal(r.styles.effects.figmaOnly[0].name, 'old-style');
});

test('comparator returns styles.effects shape even when both sides have empty effects', () => {
  const empty = { tokens: [], exposure: [], styles: { effects: [], text: [] } };
  const r = compareDesignSystems(empty, empty);
  assert.deepEqual(r.styles.effects, { same: [], codeOnly: [], figmaOnly: [] });
});

test('comparing per mode independently — token can be same in light, conflict in dark', () => {
  const code = {
    tokens: [{
      domain: 'color', path: 'brand/surface',
      values: {
        light: { type: 'alias', target: 'gold/100' },
        dark:  { type: 'alias', target: 'gold/900' },
      },
    }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{
      domain: 'color', path: 'brand/surface',
      values: {
        light: { type: 'alias', target: 'gold/100' },
        dark:  { type: 'alias', target: 'gold/100' }, // wrong dark!
      },
    }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.same.length, 1, 'light is same');
  assert.equal(r.conflict.length, 1, 'dark is a conflict');
  assert.equal(r.conflict[0].mode, 'dark');
});

// ── Regression: literal value normalization across CSS/Figma representations ──
// Code stores raw CSS strings ("0.25rem", "#fff"); Figma extract converts FLOAT
// variables to numeric and the figma-parser re-emits them with a "px" suffix
// ("4px"). Before normalization these strict-string-compared as conflicts,
// burying real conflicts under a flood of phantom ones.
test('valuesEqual: "0.25rem" and "4px" are equal (rem → px conversion)', () => {
  const code = {
    tokens: [{ domain: 'spacing', path: '1', values: { default: { type: 'literal', value: '0.25rem' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{ domain: 'spacing', path: '1', values: { default: { type: 'literal', value: '4px' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.conflict.length, 0, 'rem and px should canonicalize to the same px value');
  assert.equal(r.same.length, 1);
});

test('valuesEqual: short hex "#fff" equals long hex "#ffffff"', () => {
  const code = {
    tokens: [{ domain: 'color', path: 'white', values: { default: { type: 'literal', value: '#fff' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{ domain: 'color', path: 'white', values: { default: { type: 'literal', value: '#ffffff' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.conflict.length, 0, 'short hex should canonicalize to long hex');
  assert.equal(r.same.length, 1);
});

test('valuesEqual: still flags real value differences after normalization', () => {
  const code = {
    tokens: [{ domain: 'spacing', path: '1', values: { default: { type: 'literal', value: '0.25rem' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const figma = {
    tokens: [{ domain: 'spacing', path: '1', values: { default: { type: 'literal', value: '8px' } } }],
    exposure: [], styles: { effects: [], text: [] },
  };
  const r = compareDesignSystems(code, figma);
  assert.equal(r.conflict.length, 1, 'genuinely different values must still conflict');
  assert.equal(r.same.length, 0);
});

test('codeOnly: includeTailwindDefaultsInCodeOnly=true keeps the full palette in codeOnly (seed mode)', () => {
  // The seed-the-design-system mode: designers want every Tailwind
  // utility available as a Figma variable. Comparator should NOT filter
  // origin-tagged tokens out of codeOnly when the flag is set.
  const code = {
    tokens: [
      { domain: 'color', path: 'zinc/500', values: { default: { type: 'literal', value: '#71717a' } }, fromTailwindDefault: true },
      { domain: 'color', path: 'brand',    values: { default: { type: 'literal', value: '#5e3aee' } }, fromTailwindDefault: false },
    ],
    styles: { effects: [] },
  };
  const figma = { tokens: [], styles: { effects: [] } };
  const diff = compareDesignSystems(code, figma, { includeTailwindDefaultsInCodeOnly: true });
  // Both tokens surface in codeOnly.
  assert.equal(diff.codeOnly.length, 2);
  const paths = diff.codeOnly.map(t => t.path).sort();
  assert.deepEqual(paths, ['brand', 'zinc/500']);
});

test('codeOnly: filters out Tailwind-default-origin tokens (additive policy)', () => {
  // Pushing the full Tailwind palette into Figma is rarely intended — both
  // sides assume the defaults implicitly. The comparator drops
  // Tailwind-default-origin tokens from codeOnly so push doesn't create
  // hundreds of redundant variables. User-authored tokens at the same path
  // keep the flag cleared during parse and DO surface.
  const code = {
    tokens: [
      { domain: 'color', path: 'zinc/500', values: { default: { type: 'literal', value: '#71717a' } }, fromTailwindDefault: true },
      { domain: 'color', path: 'brand',     values: { default: { type: 'literal', value: '#5e3aee' } }, fromTailwindDefault: false },
    ],
    styles: { effects: [] },
  };
  const figma = { tokens: [], styles: { effects: [] } };
  const diff = compareDesignSystems(code, figma);
  // Only the user-authored token surfaces in codeOnly.
  assert.equal(diff.codeOnly.length, 1);
  assert.equal(diff.codeOnly[0].path, 'brand');
});

test('Tailwind-default-origin token with a Figma value mismatch still surfaces as conflict', () => {
  // The filter is codeOnly-specific. If Figma has a different value for a
  // Tailwind default (designer overrode `--color-zinc-500`), that's real
  // state and stays in `conflict`.
  const code = {
    tokens: [
      { domain: 'color', path: 'zinc/500', values: { default: { type: 'literal', value: '#71717a' } }, fromTailwindDefault: true },
    ],
    styles: { effects: [] },
  };
  const figma = {
    tokens: [
      { domain: 'color', path: 'zinc/500', values: { default: { type: 'literal', value: '#888888' } } },
    ],
    styles: { effects: [] },
  };
  const diff = compareDesignSystems(code, figma);
  assert.equal(diff.codeOnly.length, 0);
  assert.equal(diff.conflict.length, 1);
  assert.equal(diff.conflict[0].path, 'zinc/500');
});


