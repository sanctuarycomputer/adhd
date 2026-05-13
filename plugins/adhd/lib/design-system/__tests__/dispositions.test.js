'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyToken, parsePushTokensFromConfig, formatPushTokensForConfig } = require('../dispositions');

const tok = (domain, path, extras = {}) => ({ domain, path, ...extras });

test('font families always skip (hardcoded, regardless of dispositions)', () => {
  const v = classifyToken(tok('typography', 'font/aeonik'), { typography: 'all' });
  assert.equal(v.action, 'skip');
  assert.match(v.reason, /font-family/);
});

test('color "all": pushes both palette + semantic', () => {
  const dispositions = { color: 'all' };
  assert.equal(classifyToken(tok('color', 'zinc/500', { fromTailwindDefault: true }), dispositions).action, 'push');
  assert.equal(classifyToken(tok('color', 'brand'), dispositions).action, 'push');
});

test('color "semantic-only": skips Tailwind palette, keeps authored', () => {
  const dispositions = { color: 'semantic-only' };
  const palette = classifyToken(tok('color', 'zinc/500', { fromTailwindDefault: true }), dispositions);
  assert.equal(palette.action, 'skip');
  assert.match(palette.reason, /semantic-only/);
  assert.equal(classifyToken(tok('color', 'brand'), dispositions).action, 'push');
});

test('color "skip": nothing pushes', () => {
  assert.equal(classifyToken(tok('color', 'brand'), { color: 'skip' }).action, 'skip');
  assert.equal(classifyToken(tok('color', 'zinc/500', { fromTailwindDefault: true }), { color: 'skip' }).action, 'skip');
});

test('typography "sizes-and-weights": text-* and font-weight-* push, leading/tracking skip', () => {
  const dispositions = { typography: 'sizes-and-weights' };
  assert.equal(classifyToken(tok('typography', 'text/sm'), dispositions).action, 'push');
  assert.equal(classifyToken(tok('typography', 'font-weight/bold'), dispositions).action, 'push');
  assert.equal(classifyToken(tok('typography', 'leading/relaxed'), dispositions).action, 'skip');
  assert.equal(classifyToken(tok('typography', 'tracking/tight'), dispositions).action, 'skip');
});

test('spacing "authored-only": Tailwind defaults skip, authored push', () => {
  const dispositions = { spacing: 'authored-only' };
  const tw = classifyToken(tok('spacing', '4', { fromTailwindDefault: true }), dispositions);
  assert.equal(tw.action, 'skip');
  assert.equal(classifyToken(tok('spacing', 'card-gap'), dispositions).action, 'push');
});

test('radius / border-width: push by default, skip when set', () => {
  assert.equal(classifyToken(tok('radius', 'sm'), {}).action, 'push');
  assert.equal(classifyToken(tok('border-width', 'thin'), {}).action, 'push');
  assert.equal(classifyToken(tok('radius', 'sm'), { radiusAndBorder: 'skip' }).action, 'skip');
});

test('shadow: routes to effect-style when push enabled, skip otherwise', () => {
  assert.equal(classifyToken(tok('shadow', 'md'), {}).action, 'effect-style');
  assert.equal(classifyToken(tok('shadow', 'md'), { shadow: 'skip' }).action, 'skip');
});

test('opacity defaults to skip (Tailwind uses /<percent> class modifiers)', () => {
  const v = classifyToken(tok('opacity', '50'), {});
  assert.equal(v.action, 'skip');
  assert.match(v.reason, /class modifier/);
  assert.equal(classifyToken(tok('opacity', '50'), { opacity: 'push' }).action, 'push');
});

test('utility domains (animate/ease/aspect/perspective/container/breakpoint/z-index/blur) default to skip', () => {
  const utils = ['animate', 'ease', 'aspect', 'perspective', 'container', 'breakpoint', 'z-index', 'blur'];
  for (const dom of utils) {
    const v = classifyToken(tok(dom, 'x'), {});
    assert.equal(v.action, 'skip', `${dom} should skip by default`);
    assert.match(v.reason, /utilityDomains/);
  }
});

test('utility domains push when explicitly enabled', () => {
  for (const dom of ['animate', 'breakpoint', 'z-index']) {
    assert.equal(classifyToken(tok(dom, 'x'), { utilityDomains: 'push' }).action, 'push');
  }
});

test('parsePushTokensFromConfig: returns null when no block present', () => {
  assert.equal(parsePushTokensFromConfig(`export default { figma: { url: 'x' } };`), null);
  assert.equal(parsePushTokensFromConfig(''), null);
  assert.equal(parsePushTokensFromConfig(null), null);
});

test('parsePushTokensFromConfig: extracts a well-formed block', () => {
  const src = `
    export default {
      figma: { url: "https://figma.com/design/abc" },
      pushTokens: {
        color: "all",
        typography: "sizes-and-weights",
        opacity: "skip",
      },
      naming: "kebab-case",
    };
  `;
  const out = parsePushTokensFromConfig(src);
  assert.deepEqual(out, { color: 'all', typography: 'sizes-and-weights', opacity: 'skip' });
});

test('formatPushTokensForConfig: produces a stable, insertable block', () => {
  const out = formatPushTokensForConfig({
    color: 'all',
    typography: 'all',
    spacing: 'all',
    radiusAndBorder: 'push',
    shadow: 'effect-styles',
    opacity: 'skip',
    utilityDomains: 'skip',
  });
  assert.match(out, /^  pushTokens: \{\n/);
  // Stable order — color first.
  assert.match(out, /color: "all"/);
  assert.match(out, /utilityDomains: "skip"/);
});
