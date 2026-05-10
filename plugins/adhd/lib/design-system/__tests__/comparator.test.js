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
