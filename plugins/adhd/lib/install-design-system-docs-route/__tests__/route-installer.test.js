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

test('installRoute writes page/layout files with .design-system.tsx suffix when prodExcluded, but PropToggle is always plain .tsx', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  // Route files (page/layout) get the suffix so pageExtensions filters them in prod.
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'tokens', '[domain]', 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'page.design-system.tsx')));
  // PropToggle is a module imported by the component page; it doesn't need the
  // suffix for prod-exclusion (the page that imports it IS suffix-excluded).
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
  assert.ok(!fs.existsSync(path.join(docsDir, 'PropToggle.design-system.tsx')));
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
  assert.ok(fs.existsSync(path.join(docsDir, 'tokens', '[domain]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
});

test('all written files start with the marker comment', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  for (const f of [
    'layout.design-system.tsx',
    'page.design-system.tsx',
    'tokens/[domain]/page.design-system.tsx',
    'components/[component]/page.design-system.tsx',
    'PropToggle.tsx',
  ]) {
    const content = fs.readFileSync(path.join(docsDir, f), 'utf8');
    assert.match(content, /design-system-docs-route/);
  }
});

test('layout sidebar links use absolute hrefs derived from the route segment', () => {
  // The sidebar lives in the layout, so its links must use absolute hrefs
  // (`/-docs/tokens/colors`, not `./tokens/colors`) — otherwise nested routes
  // resolve from the current pathname instead of the docs root.
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const layout = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx'),
    'utf8',
  );
  assert.match(layout, /href=\{`\/-docs\/tokens\/\$\{d\.slug\}`\}/);
  assert.match(layout, /href=\{`\/-docs\/components\/\$\{c\.slug\}`\}/);
  // The placeholder should be fully substituted — no `__ROUTE_PATH__` left over.
  assert.doesNotMatch(layout, /__ROUTE_PATH__/);
});

test('route URL substitution honors a custom route segment', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: 'design-system', prodExcluded: true });
  const layout = fs.readFileSync(
    path.join(root, 'app', '(design-system)', 'design-system', 'layout.design-system.tsx'),
    'utf8',
  );
  assert.match(layout, /href=\{`\/design-system\/tokens\/\$\{d\.slug\}`\}/);
});

test('COMPONENT_PAGE_TSX imports PropToggle from "../../PropToggle" (now two levels deep)', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const componentPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'components', '[component]', 'page.design-system.tsx'),
    'utf8',
  );
  assert.match(componentPage, /from "\.\.\/\.\.\/PropToggle"/);
});

test('TOKENS_PAGE_TSX uses parser that handles `@theme inline { ... }` modifier syntax', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const tokensPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'tokens', '[domain]', 'page.design-system.tsx'),
    'utf8',
  );
  // The inline parser must use the brace-counted scan (NOT the old
  // `/@theme\s*\{...\}/` regex that misses `@theme inline { ... }`).
  assert.match(tokensPage, /extractThemeBodies/);
  // No naïve `@theme\s*\{` regex anywhere.
  assert.doesNotMatch(tokensPage, /@theme\\s\*\\\{/);
});

test('TOKENS_PAGE_TSX renders all expected token domains', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const tokensPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'tokens', '[domain]', 'page.design-system.tsx'),
    'utf8',
  );
  for (const slug of ['colors', 'spacing', 'typography', 'font', 'font-weight',
                      'tracking', 'leading', 'radius', 'shadows', 'breakpoint',
                      'ease', 'animate']) {
    assert.match(tokensPage, new RegExp(`slug === "${slug}"`), `missing renderer for ${slug}`);
  }
});

test('empty-state messaging references Tailwind defaults, not "no X detected"', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const tokensPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'tokens', '[domain]', 'page.design-system.tsx'),
    'utf8',
  );
  assert.match(tokensPage, /Tailwind v4 ships sensible defaults/);
  // The misleading "No X detected" phrasing is gone.
  assert.doesNotMatch(tokensPage, /No (colors|typography|radius|shadow) (tokens? )?detected/);
});

test('detectExistingInstall scans for the marker and returns matching files', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const found = detectExistingInstall(root);
  assert.ok(found.length >= 5);
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

test('re-running installRoute overwrites files cleanly', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const layoutPath = path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx');
  fs.writeFileSync(layoutPath, 'corrupted');
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const after = fs.readFileSync(layoutPath, 'utf8');
  assert.match(after, /design-system-docs-route/);
  assert.match(after, /DesignSystemDocsLayout/);
});

test('installRoute removes stale marker-bearing files from a previous install layout', () => {
  // Simulate an older install where the component page lived at `[component]/page.*`
  // directly under docsDir (the structure before the tokens/[domain] + components/[component] split).
  const root = makeTempProject();
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  const oldComponentDir = path.join(docsDir, '[component]');
  fs.mkdirSync(oldComponentDir, { recursive: true });
  const oldPath = path.join(oldComponentDir, 'page.design-system.tsx');
  fs.writeFileSync(oldPath, '// design-system-docs-route — stale\nexport default function Old() { return null; }\n');

  const result = installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });

  // Stale file removed, reported in `removed`, and its now-empty parent dir pruned.
  assert.ok(!fs.existsSync(oldPath), 'stale file should be deleted');
  assert.ok(result.removed.includes(oldPath));
  assert.ok(!fs.existsSync(oldComponentDir), 'empty `[component]` directory should be pruned');
});

test('installRoute does NOT delete unrelated files (only marker-bearing ones)', () => {
  const root = makeTempProject();
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  // Pre-install a user-authored file under docsDir without the marker.
  fs.mkdirSync(docsDir, { recursive: true });
  const userFile = path.join(docsDir, 'user-notes.tsx');
  fs.writeFileSync(userFile, '// user wrote this\nexport const NOTE = "keep me";\n');

  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });

  assert.ok(fs.existsSync(userFile), 'user file without marker must be preserved');
});

test('installRoute supports an empty groupName (no route group)', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '', routeSegment: '-docs', prodExcluded: true });
  const docsDir = path.join(root, 'app', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'tokens', '[domain]', 'page.design-system.tsx')));
});
