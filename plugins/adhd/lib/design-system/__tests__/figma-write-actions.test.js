'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFigmaActions } = require('../figma-write-actions');

test('emits create-variable action for code-only token (push)', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'color',
      path: 'gold/100',
      values: { default: { type: 'literal', value: '#faf0c5' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
  assert.equal(actions[0].collection, 'color');
  assert.equal(actions[0].path, 'gold/100');
});

test('emits update-variable action for resolved conflict (use code)', () => {
  const diff = {
    same: [], codeOnly: [], figmaOnly: [],
    conflict: [{
      domain: 'color',
      path: 'brand/surface',
      mode: 'light',
      code: { type: 'alias', target: 'gold/100' },
      figma: { type: 'alias', target: 'gold/200' },
    }],
  };
  const resolutions = [{ path: 'brand/surface', mode: 'light', winner: 'code' }];
  const actions = buildFigmaActions(diff, resolutions, 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'update-variable');
  assert.equal(actions[0].mode, 'light');
  assert.deepEqual(actions[0].newValue, { type: 'alias', target: 'gold/100' });
});

test('skips conflicts where user picked "figma" winner (push direction)', () => {
  const diff = {
    same: [], codeOnly: [], figmaOnly: [],
    conflict: [{
      domain: 'color', path: 'brand/surface', mode: 'light',
      code: { type: 'alias', target: 'gold/100' },
      figma: { type: 'alias', target: 'gold/200' },
    }],
  };
  const resolutions = [{ path: 'brand/surface', mode: 'light', winner: 'figma' }];
  const actions = buildFigmaActions(diff, resolutions, 'push');
  assert.equal(actions.length, 0);
});

test('push does NOT emit actions for figma-only tokens (additive policy)', () => {
  const diff = {
    same: [], conflict: [], codeOnly: [],
    figmaOnly: [{
      domain: 'color', path: 'extra/var', values: { default: { type: 'literal', value: '#fff' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 0);
});

test('pull direction inverts: emits actions for figma-only and overwrites code on resolved conflicts', () => {
  const diff = {
    same: [], codeOnly: [],
    figmaOnly: [{
      domain: 'color', path: 'extra', values: { default: { type: 'literal', value: '#fff' } },
    }],
    conflict: [{
      domain: 'color', path: 'brand/surface', mode: 'light',
      code: { type: 'literal', value: '#aaa' },
      figma: { type: 'literal', value: '#bbb' },
    }],
  };
  const resolutions = [{ path: 'brand/surface', mode: 'light', winner: 'figma' }];
  const actions = buildFigmaActions(diff, resolutions, 'pull');
  // Pull direction emits CODE actions, not Figma actions
  assert.ok(actions.find(a => a.kind === 'set-primitive' && a.cssVar.includes('extra')));
  assert.ok(actions.find(a => a.kind === 'set-semantic' && a.cssVar.includes('brand-surface')));
});
