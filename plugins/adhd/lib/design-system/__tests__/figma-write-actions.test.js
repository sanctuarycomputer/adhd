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

test('spacing token with 0.25rem produces FLOAT create-variable with resolved value 4px', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'spacing',
      path: 'spacing',
      values: { default: { type: 'literal', value: '0.25rem' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
  assert.equal(actions[0].type, 'FLOAT');
  assert.equal(actions[0].resolvedByMode.default, 4);
});

test('font-family typography token produces STRING create-variable', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'typography',
      path: 'font/sans',
      values: {
        default: { type: 'literal', value: 'ui-sans-serif, system-ui, sans-serif' },
      },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
  assert.equal(actions[0].type, 'STRING');
  assert.equal(
    actions[0].resolvedByMode.default,
    'ui-sans-serif, system-ui, sans-serif',
  );
});

test('shadow token produces a create-effect-style action', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'shadow',
      path: 'md',
      cssVar: '--shadow-md',
      values: {
        default: { type: 'literal', value: '0 4px 6px rgba(0,0,0,0.1)' },
      },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-effect-style');
  // Effect-style name comes from the cssVar (without --) for collision safety
  // across shadow families.
  assert.equal(actions[0].name, 'shadow-md');
  assert.equal(actions[0].effects.length, 1);
  assert.equal(actions[0].effects[0].type, 'DROP_SHADOW');
  assert.equal(actions[0].effects[0].offset.x, 0);
  assert.equal(actions[0].effects[0].offset.y, 4);
  assert.equal(actions[0].effects[0].radius, 6);
  assert.equal(actions[0].effects[0].spread, 0);
  assert.equal(actions[0].effects[0].visible, true);
  assert.equal(actions[0].effects[0].blendMode, 'NORMAL');
});

test('inset-shadow token produces INNER_SHADOW effects', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'shadow',
      path: 'inset-shadow/2xs',
      cssVar: '--inset-shadow-2xs',
      values: {
        default: { type: 'literal', value: 'inset 0 1px rgb(0 0 0 / 0.05)' },
      },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-effect-style');
  assert.equal(actions[0].effects[0].type, 'INNER_SHADOW');
});

test('multi-shadow CSS produces multi-effect create-effect-style action', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'shadow',
      path: 'md',
      cssVar: '--shadow-md',
      values: {
        default: { type: 'literal', value: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' },
      },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions[0].effects.length, 2);
  assert.equal(actions[0].effects[0].spread, -1);
  assert.equal(actions[0].effects[1].spread, -2);
});

test('shadow whose name already exists in Figma is skipped (additive policy)', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'shadow', path: 'md', cssVar: '--shadow-md',
      values: { default: { type: 'literal', value: '0 4px 6px rgba(0,0,0,0.1)' } },
    }],
    styles: { figmaOnly: [{ name: 'shadow-md' }] },
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 0);
});

test('color token still emits COLOR-typed create-variable (regression guard)', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'color',
      path: 'red/500',
      values: { default: { type: 'literal', value: 'oklch(63.7% 0.237 25.331)' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
  assert.equal(actions[0].type, 'COLOR');
  // For COLOR we leave the literal alone; the write script handles oklch→rgb.
  assert.equal(
    actions[0].valuesByMode.default.value,
    'oklch(63.7% 0.237 25.331)',
  );
});

test('opacity token (0.05) → FLOAT in `opacity` collection', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'opacity', path: '5',
      values: { default: { type: 'literal', value: '0.05' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
  assert.equal(actions[0].collection, 'opacity');
  assert.equal(actions[0].type, 'FLOAT');
  assert.equal(actions[0].resolvedByMode.default, 0.05);
});

test('border-width token (8px) → FLOAT in `border-width` collection', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'border-width', path: '8',
      values: { default: { type: 'literal', value: '8px' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions[0].collection, 'border-width');
  assert.equal(actions[0].type, 'FLOAT');
  assert.equal(actions[0].resolvedByMode.default, 8);
});

test('z-index token (50, unitless) → FLOAT in `z-index` collection', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'z-index', path: '50',
      values: { default: { type: 'literal', value: '50' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions[0].collection, 'z-index');
  assert.equal(actions[0].type, 'FLOAT');
  assert.equal(actions[0].resolvedByMode.default, 50);
});

test('breakpoint token (40rem) → FLOAT converted to 640 px', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'breakpoint', path: 'sm',
      values: { default: { type: 'literal', value: '40rem' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions[0].collection, 'breakpoint');
  assert.equal(actions[0].type, 'FLOAT');
  assert.equal(actions[0].resolvedByMode.default, 640);
});

test('aspect token (16 / 9) → STRING in `aspect` collection', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'aspect', path: 'video',
      values: { default: { type: 'literal', value: '16 / 9' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions[0].collection, 'aspect');
  assert.equal(actions[0].type, 'STRING');
  assert.equal(actions[0].resolvedByMode.default, '16 / 9');
});

test('ease cubic-bezier → STRING in `ease` collection', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'ease', path: 'in-out',
      values: { default: { type: 'literal', value: 'cubic-bezier(0.4, 0, 0.2, 1)' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions[0].collection, 'ease');
  assert.equal(actions[0].type, 'STRING');
  assert.equal(actions[0].resolvedByMode.default, 'cubic-bezier(0.4, 0, 0.2, 1)');
});

test('animate shorthand → STRING in `animate` collection', () => {
  const diff = {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{
      domain: 'animate', path: 'spin',
      values: { default: { type: 'literal', value: 'spin 1s linear infinite' } },
    }],
  };
  const actions = buildFigmaActions(diff, [], 'push');
  assert.equal(actions[0].collection, 'animate');
  assert.equal(actions[0].type, 'STRING');
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
