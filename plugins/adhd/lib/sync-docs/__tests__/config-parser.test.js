'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  readConfig,
  parseComponents,
  parseCssEntry,
  slugFor,
  importPathFor,
} = require('../config-parser');

function makeProject(configBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-cfg-'));
  fs.writeFileSync(path.join(root, 'adhd.config.ts'), configBody);
  return root;
}

test('parseComponents extracts the keys of the components map', () => {
  const src = `
const config = {
  components: {
    "components/design-system/logo/index.tsx": { figma: {} },
    "src/components/Button.tsx": { figma: {} },
  },
};
export default config;
`;
  const paths = parseComponents(src);
  assert.deepEqual(paths, [
    'components/design-system/logo/index.tsx',
    'src/components/Button.tsx',
  ]);
});

test('parseComponents returns [] when no components map is defined', () => {
  assert.deepEqual(parseComponents('const config = { figma: { url: "x" } };'), []);
});

test('parseCssEntry returns the configured cssEntry, defaulting to app/globals.css', () => {
  assert.equal(parseCssEntry('const config = { cssEntry: "src/app/globals.css" };'), 'src/app/globals.css');
  assert.equal(parseCssEntry('const config = {};'), 'app/globals.css');
});

test('slugFor strips .tsx/.ts and /index, lowercasing the last segment', () => {
  assert.equal(slugFor('components/design-system/logo/index.tsx'), 'logo');
  assert.equal(slugFor('src/components/Button.tsx'), 'button');
  assert.equal(slugFor('app/widgets/PrimaryNav.ts'), 'primarynav');
});

test('importPathFor prepends @/ and strips .tsx/.ts and /index', () => {
  assert.equal(importPathFor('components/design-system/logo/index.tsx'), '@/components/design-system/logo');
  assert.equal(importPathFor('src/components/Button.tsx'), '@/src/components/Button');
});

test('readConfig returns components + cssEntry derived from adhd.config.ts', () => {
  const root = makeProject(`
const config = {
  components: {
    "components/design-system/logo/index.tsx": { figma: { url: "x" } },
  },
  cssEntry: "app/globals.css",
};
export default config;
`);
  const r = readConfig(root);
  assert.deepEqual(r.components, [{
    slug: 'logo',
    rawPath: 'components/design-system/logo/index.tsx',
    importPath: '@/components/design-system/logo',
  }]);
  assert.equal(r.cssEntry, 'app/globals.css');
});

test('readConfig throws if adhd.config.ts is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-cfg-missing-'));
  assert.throws(() => readConfig(root), /ENOENT|no such file/);
});

test('readConfig handles an empty components map cleanly', () => {
  const root = makeProject(`
const config = {
  components: {},
};
export default config;
`);
  const r = readConfig(root);
  assert.deepEqual(r.components, []);
  assert.equal(r.cssEntry, 'app/globals.css');
});
