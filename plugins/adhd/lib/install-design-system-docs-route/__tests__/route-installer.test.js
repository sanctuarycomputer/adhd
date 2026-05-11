'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installRoute, detectExistingInstall } = require('../route-installer');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-install-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  return root;
}

test('installRoute writes 4 files with the .design-system.tsx extension when prodExcluded', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, '[component]', 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.design-system.tsx')));
});

test('installRoute writes plain .tsx files when not prodExcluded', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: false,
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, '[component]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
});

test('all written files start with the marker comment', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  for (const f of [
    'layout.design-system.tsx',
    'page.design-system.tsx',
    '[component]/page.design-system.tsx',
    'PropToggle.design-system.tsx',
  ]) {
    const content = fs.readFileSync(path.join(docsDir, f), 'utf8');
    assert.match(content, /design-system-docs-route/);
  }
});

test('detectExistingInstall scans for the marker and returns matching files', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const found = detectExistingInstall(root);
  assert.ok(found.length >= 4);
  assert.ok(found.every(p => p.includes('-docs')));
});

test('detectExistingInstall returns [] when no marker is present', () => {
  const root = makeTempProject();
  const found = detectExistingInstall(root);
  assert.deepEqual(found, []);
});

test('detectExistingInstall does not match unrelated files', () => {
  const root = makeTempProject();
  fs.writeFileSync(path.join(root, 'app', 'page.tsx'), 'export default function P() { return null; }\n');
  assert.deepEqual(detectExistingInstall(root), []);
});

test('re-running installRoute is safe (overwrites files cleanly)', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  // Modify a file
  const layoutPath = path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx');
  fs.writeFileSync(layoutPath, 'corrupted');
  // Re-install
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const after = fs.readFileSync(layoutPath, 'utf8');
  assert.match(after, /design-system-docs-route/);
  assert.match(after, /DesignSystemDocsLayout/);
});

test('installRoute supports an empty groupName (no route group)', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '', routeSegment: '-docs', prodExcluded: true });
  const docsDir = path.join(root, 'app', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
});
