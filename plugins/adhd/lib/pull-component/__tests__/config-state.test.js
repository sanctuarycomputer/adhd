'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findComponentBlock, readComponentState, writeComponentState } = require('../config-state');

const SAMPLE_CONFIG = `const config = {
  figma: { url: "https://figma.com/design/abc/Test" },
  components: {
    "app/components/Button": {
      figma: { url: "https://figma.com/design/abc?node-id=1-1" },
    },
    "app/components/Card": {
      figma: { url: "https://figma.com/design/abc?node-id=2-2" },
      pulledAt: "2026-05-01T10:00:00.000Z",
      fingerprint: "deadbeef",
    },
  },
  naming: "kebab-case",
};
export default config;`;

test('findComponentBlock: locates the value block for a path key', () => {
  const block = findComponentBlock(SAMPLE_CONFIG, 'app/components/Button');
  assert.ok(block);
  assert.equal(SAMPLE_CONFIG[block.openAt], '{');
  assert.equal(SAMPLE_CONFIG[block.closeAt], '}');
  // Body should contain the figma sub-block.
  assert.match(block.body, /figma:\s*\{\s*url:/);
});

test('findComponentBlock: returns null for unknown paths', () => {
  assert.equal(findComponentBlock(SAMPLE_CONFIG, 'app/components/Nope'), null);
});

test('readComponentState: returns null when no fingerprint stored yet', () => {
  // Button block has no pulledAt/fingerprint — treat as "never pulled."
  assert.equal(readComponentState(SAMPLE_CONFIG, 'app/components/Button'), null);
});

test('readComponentState: returns { pulledAt, fingerprint } when present', () => {
  const state = readComponentState(SAMPLE_CONFIG, 'app/components/Card');
  assert.deepEqual(state, { pulledAt: '2026-05-01T10:00:00.000Z', fingerprint: 'deadbeef' });
});

test('readComponentState: ignores fields inside nested blocks (figma: { url } is not the fingerprint)', () => {
  // If `pulledAt` or `fingerprint` appeared inside a nested block by
  // accident, the brace-counted scan would correctly ignore them.
  const tricky = `const config = {
    components: {
      "x": {
        figma: { url: "fake-fingerprint-inside", pulledAt: "fake" },
      },
    },
  };`;
  // Only top-level pulledAt/fingerprint count — there are none here.
  assert.equal(readComponentState(tricky, 'x'), null);
});

test('writeComponentState: inserts pulledAt + fingerprint when absent', () => {
  const next = writeComponentState(SAMPLE_CONFIG, 'app/components/Button', {
    pulledAt: '2026-05-12T14:30:00.000Z',
    fingerprint: 'a1b2c3d4',
  });
  // Round-trip: reading should now find the values.
  const state = readComponentState(next, 'app/components/Button');
  assert.deepEqual(state, { pulledAt: '2026-05-12T14:30:00.000Z', fingerprint: 'a1b2c3d4' });
  // Original Card entry untouched.
  const card = readComponentState(next, 'app/components/Card');
  assert.deepEqual(card, { pulledAt: '2026-05-01T10:00:00.000Z', fingerprint: 'deadbeef' });
});

test('writeComponentState: replaces existing pulledAt + fingerprint values', () => {
  const next = writeComponentState(SAMPLE_CONFIG, 'app/components/Card', {
    pulledAt: '2026-05-13T09:00:00.000Z',
    fingerprint: 'cafef00d',
  });
  const state = readComponentState(next, 'app/components/Card');
  assert.deepEqual(state, { pulledAt: '2026-05-13T09:00:00.000Z', fingerprint: 'cafef00d' });
  // Button entry stays empty (no fingerprint stored).
  assert.equal(readComponentState(next, 'app/components/Button'), null);
});

test('writeComponentState: throws when the component path is missing from config', () => {
  assert.throws(
    () => writeComponentState(SAMPLE_CONFIG, 'app/components/Nope', { pulledAt: 'x', fingerprint: 'y' }),
    /Component not found/,
  );
});

test('writeComponentState: preserves surrounding fields and trailing commas', () => {
  const next = writeComponentState(SAMPLE_CONFIG, 'app/components/Button', {
    pulledAt: '2026-05-12T14:30:00.000Z',
    fingerprint: 'a1b2c3d4',
  });
  // The original `figma: { url: ... }` is still there.
  assert.match(next, /"app\/components\/Button":\s*\{[\s\S]*figma:\s*\{\s*url:/);
  // The other component (Card) is intact.
  assert.match(next, /"app\/components\/Card":\s*\{[\s\S]*pulledAt: "2026-05-01T10:00:00\.000Z"/);
  // No syntax wreckage — config still has the closing structure.
  assert.match(next, /\};\s*\nexport default config;/);
});
