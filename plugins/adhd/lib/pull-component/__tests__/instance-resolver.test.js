'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveInstance,
  nodeIdFromUrl,
  pascalSlugFromPath,
  importPathFor,
  readExportName,
} = require('../instance-resolver');

test('nodeIdFromUrl: converts URL node-id form (A-B) to Figma ID form (A:B)', () => {
  assert.equal(
    nodeIdFromUrl('https://figma.com/design/abc?node-id=123-456'),
    '123:456',
  );
  assert.equal(
    nodeIdFromUrl('https://www.figma.com/design/abc/Test?node-id=91-18&t=foo'),
    '91:18',
  );
});

test('nodeIdFromUrl: returns null when no node-id present', () => {
  assert.equal(nodeIdFromUrl('https://figma.com/design/abc/Test'), null);
  assert.equal(nodeIdFromUrl(null), null);
  assert.equal(nodeIdFromUrl(123), null);
});

test('pascalSlugFromPath: derives a PascalCase fallback name', () => {
  assert.equal(pascalSlugFromPath('components/user-avatar/index.tsx'), 'UserAvatar');
  assert.equal(pascalSlugFromPath('app/components/Button.tsx'), 'Button');
  assert.equal(pascalSlugFromPath('app/cards/info-card/index.tsx'), 'InfoCard');
});

test('importPathFor: rewrites file path to @/-aliased form', () => {
  assert.equal(
    importPathFor('components/user-avatar/index.tsx'),
    '@/components/user-avatar',
  );
  assert.equal(
    importPathFor('app/cards/info-card.tsx'),
    '@/app/cards/info-card',
  );
});

const SAMPLE_CONFIG = `const config = {
  figma: { url: "https://figma.com/design/abc/Test" },
  components: {
    "components/user-avatar/index.tsx": {
      figma: { url: "https://figma.com/design/abc?node-id=123-456" },
    },
    "components/info-card/index.tsx": {
      figma: { url: "https://figma.com/design/abc?node-id=789-1000" },
    },
  },
  naming: "kebab-case",
};
export default config;`;

test('resolveInstance: matched, file does not exist → uses PascalCase slug as exportName', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-instance-'));
  const out = resolveInstance({
    configSrc: SAMPLE_CONFIG,
    componentId: '123:456',
    repoRoot: tmpDir,
  });
  assert.equal(out.matched, true);
  assert.equal(out.relPath, 'components/user-avatar/index.tsx');
  assert.equal(out.importPath, '@/components/user-avatar');
  assert.equal(out.fileExists, false);
  assert.equal(out.exportName, 'UserAvatar');
});

test('resolveInstance: matched, file exists → reads exportName from "export function Name"', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-instance-'));
  fs.mkdirSync(path.join(tmpDir, 'components/user-avatar'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'components/user-avatar/index.tsx'),
    'export function MyCustomAvatar() { return null; }\n',
  );
  const out = resolveInstance({
    configSrc: SAMPLE_CONFIG,
    componentId: '123:456',
    repoRoot: tmpDir,
  });
  assert.equal(out.matched, true);
  assert.equal(out.fileExists, true);
  // exportName comes from the file, not the slug.
  assert.equal(out.exportName, 'MyCustomAvatar');
});

test('resolveInstance: matched, exists with "export default function Name"', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-instance-'));
  fs.mkdirSync(path.join(tmpDir, 'components/user-avatar'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'components/user-avatar/index.tsx'),
    'export default function Avatar() { return null; }\n',
  );
  const out = resolveInstance({
    configSrc: SAMPLE_CONFIG,
    componentId: '123:456',
    repoRoot: tmpDir,
  });
  assert.equal(out.exportName, 'Avatar');
});

test('resolveInstance: matched, exists with "export const Name = ..."', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-instance-'));
  fs.mkdirSync(path.join(tmpDir, 'components/user-avatar'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'components/user-avatar/index.tsx'),
    'export const StyledAvatar = ({ size }) => null;\n',
  );
  const out = resolveInstance({
    configSrc: SAMPLE_CONFIG,
    componentId: '123:456',
    repoRoot: tmpDir,
  });
  assert.equal(out.exportName, 'StyledAvatar');
});

test('resolveInstance: unmatched component-id → matched: false', () => {
  const out = resolveInstance({
    configSrc: SAMPLE_CONFIG,
    componentId: '999:999',
    repoRoot: '/tmp',
  });
  assert.equal(out.matched, false);
});

test('resolveInstance: config without components map → matched: false', () => {
  const out = resolveInstance({
    configSrc: 'export default { figma: { url: "x" } };',
    componentId: '123:456',
    repoRoot: '/tmp',
  });
  assert.equal(out.matched, false);
});

test('resolveInstance: handles entries without a figma.url (e.g. work-in-progress entries)', () => {
  // An adhd.config.ts mid-edit might have a component entry without
  // its figma URL filled in yet. resolveInstance should skip those
  // gracefully, not throw.
  const partial = `const config = {
    components: {
      "components/incomplete/index.tsx": { /* no figma yet */ },
      "components/user-avatar/index.tsx": {
        figma: { url: "https://figma.com/design/abc?node-id=123-456" },
      },
    },
  };`;
  const out = resolveInstance({
    configSrc: partial,
    componentId: '123:456',
    repoRoot: '/tmp',
  });
  assert.equal(out.matched, true);
  assert.equal(out.relPath, 'components/user-avatar/index.tsx');
});

test('readExportName: returns null when file is missing or has no export', () => {
  assert.equal(readExportName('/nonexistent/path.tsx'), null);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-name-'));
  const empty = path.join(tmpDir, 'empty.tsx');
  fs.writeFileSync(empty, 'const internal = 1;\n');
  assert.equal(readExportName(empty), null);
});
