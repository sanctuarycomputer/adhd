'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readComponentMapping, addComponentMapping, reverseLookupPath } = require('../config-writer');

const MINIMAL_CONFIG = `const config = {
  figma: { url: "https://figma.com/design/ABC/" },
};

export default config;
`;

const WITH_COMPONENTS = `const config = {
  figma: { url: "https://figma.com/design/ABC/" },
  components: {
    "app/components/avatar/index.tsx": {
      figma: { url: "https://figma.com/design/ABC/?node-id=91-18" },
    },
  },
};

export default config;
`;

test('readComponentMapping returns null when no components field exists', () => {
  assert.equal(readComponentMapping(MINIMAL_CONFIG, 'app/components/badge.tsx'), null);
});

test('readComponentMapping returns entry when path matches', () => {
  const r = readComponentMapping(WITH_COMPONENTS, 'app/components/avatar/index.tsx');
  assert.equal(r && r.figma.url, 'https://figma.com/design/ABC/?node-id=91-18');
});

test('readComponentMapping returns null for an absent path even if components exists', () => {
  assert.equal(readComponentMapping(WITH_COMPONENTS, 'app/components/nope.tsx'), null);
});

test('addComponentMapping creates components field if missing', () => {
  const out = addComponentMapping(MINIMAL_CONFIG, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  assert.match(out, /components:\s*\{/);
  assert.match(out, /"app\/components\/badge\.tsx":/);
  assert.match(out, /url:\s*"https:\/\/figma\.com\/design\/ABC\/\?node-id=200-1"/);
});

test('addComponentMapping is idempotent — re-adding same entry returns identical source', () => {
  const out1 = addComponentMapping(MINIMAL_CONFIG, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  const out2 = addComponentMapping(out1, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  assert.equal(out2, out1);
});

test('addComponentMapping appends to existing components field', () => {
  const out = addComponentMapping(WITH_COMPONENTS, 'app/components/badge.tsx', 'https://figma.com/design/ABC/?node-id=200-1');
  assert.match(out, /"app\/components\/avatar\/index\.tsx":/);
  assert.match(out, /"app\/components\/badge\.tsx":/);
});

test('addComponentMapping updates existing entry if URL differs', () => {
  const out = addComponentMapping(WITH_COMPONENTS, 'app/components/avatar/index.tsx', 'https://figma.com/design/ABC/?node-id=999-1');
  assert.match(out, /node-id=999-1/);
  assert.doesNotMatch(out, /node-id=91-18/);
});

test('reverseLookupPath finds the path for a given figma URL', () => {
  const path = reverseLookupPath(WITH_COMPONENTS, 'https://figma.com/design/ABC/?node-id=91-18');
  assert.equal(path, 'app/components/avatar/index.tsx');
});

test('reverseLookupPath returns null for unknown URL', () => {
  assert.equal(reverseLookupPath(WITH_COMPONENTS, 'https://figma.com/design/ABC/?node-id=999-1'), null);
});
