'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installRoute, detectExistingInstall, renderComponentMap } = require('../route-installer');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-setup-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  return root;
}

const SAMPLE_COMPONENTS = [
  { slug: 'logo', rawPath: 'components/design-system/logo/index.tsx', importPath: '@/components/design-system/logo' },
];

test('installRoute writes the full generated file set with .design-system suffix when prodExcluded', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  // Route files get the suffix so pageExtensions filters them in prod.
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'tokens', '[domain]', 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'error.design-system.tsx')));
  // Shared modules (imported by the route files) are plain .tsx so TS resolves them.
  assert.ok(fs.existsSync(path.join(docsDir, 'componentMap.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'tokenDomains.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
  assert.ok(!fs.existsSync(path.join(docsDir, 'componentMap.design-system.tsx')));
  assert.ok(!fs.existsSync(path.join(docsDir, 'tokenDomains.design-system.tsx')));
  assert.ok(!fs.existsSync(path.join(docsDir, 'PropToggle.design-system.tsx')));
});

test('installRoute writes plain .tsx files for route files when not prodExcluded', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: false,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'tokens', '[domain]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'error.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'componentMap.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
});

test('all written files start with the marker comment', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  for (const f of [
    'layout.design-system.tsx',
    'page.design-system.tsx',
    'tokens/[domain]/page.design-system.tsx',
    'components/[component]/page.design-system.tsx',
    'components/[component]/error.design-system.tsx',
    'componentMap.tsx',
    'tokenDomains.tsx',
    'PropToggle.tsx',
  ]) {
    const content = fs.readFileSync(path.join(docsDir, f), 'utf8');
    assert.match(content, /design-system-docs-route/, `${f} missing marker`);
  }
});

test('componentMap.tsx has explicit static imports per registered component', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const mapPath = path.join(root, 'app', '(design-system)', '-docs', 'componentMap.tsx');
  const body = fs.readFileSync(mapPath, 'utf8');
  // Explicit import for the logo component
  assert.match(body, /import \* as \$cmp0 from "@\/components\/design-system\/logo"/);
  // Entry with matching slug and rawPath
  assert.match(body, /slug: "logo"/);
  assert.match(body, /rawPath: "components\/design-system\/logo\/index\.tsx"/);
  assert.match(body, /module: \$cmp0/);
  // No dynamic import — that's the whole point of this rewrite
  assert.doesNotMatch(body, /await\s+import\(`/);
});

test('componentMap.tsx handles an empty components list (no tracked components yet)', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: [],
    cssEntry: 'app/globals.css',
  });
  const body = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'componentMap.tsx'),
    'utf8',
  );
  // No import lines for components — placeholder substituted with empty string
  assert.doesNotMatch(body, /import \* as \$cmp/);
  // ENTRIES is an empty array literal
  assert.match(body, /const ENTRIES.*=\s*\[\]/);
});

test('componentMap.tsx renders multiple components with distinct import bindings', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: [
      { slug: 'logo', rawPath: 'src/components/Logo.tsx', importPath: '@/src/components/Logo' },
      { slug: 'button', rawPath: 'src/components/Button/index.tsx', importPath: '@/src/components/Button' },
    ],
    cssEntry: 'app/globals.css',
  });
  const body = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'componentMap.tsx'),
    'utf8',
  );
  assert.match(body, /import \* as \$cmp0 from "@\/src\/components\/Logo"/);
  assert.match(body, /import \* as \$cmp1 from "@\/src\/components\/Button"/);
  assert.match(body, /slug: "logo".*module: \$cmp0/s);
  assert.match(body, /slug: "button".*module: \$cmp1/s);
});

test('layout sidebar links use absolute hrefs derived from the route segment', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const layout = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx'),
    'utf8',
  );
  assert.match(layout, /href=\{`\/-docs\/tokens\/\$\{d\.slug\}`\}/);
  assert.match(layout, /href=\{`\/-docs\/components\/\$\{c\.slug\}`\}/);
  assert.doesNotMatch(layout, /__ROUTE_PATH__/);
});

test('layout imports componentEntries from componentMap (the sidebar list source)', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const layout = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx'),
    'utf8',
  );
  assert.match(layout, /from "\.\/componentMap"/);
  assert.match(layout, /componentEntries/);
  // No fs/path imports — the components list is baked at install time so the
  // layout doesn't need to read adhd.config.ts at request time.
  assert.doesNotMatch(layout, /from "node:fs|from "node:path/);
});

test('tokens page bakes the configured cssEntry path as a constant', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'src/app/globals.css',
  });
  const tokensPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'tokens', '[domain]', 'page.design-system.tsx'),
    'utf8',
  );
  assert.match(tokensPage, /CSS_ENTRY = "src\/app\/globals\.css"/);
  // No runtime read of adhd.config.ts
  assert.doesNotMatch(tokensPage, /adhd\.config\.ts/);
});

test('component page imports getComponent from componentMap, not a dynamic import', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const componentPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'components', '[component]', 'page.design-system.tsx'),
    'utf8',
  );
  assert.match(componentPage, /import \{ getComponent \} from "\.\.\/\.\.\/componentMap"/);
  assert.match(componentPage, /import \{ PropToggle \} from "\.\.\/\.\.\/PropToggle"/);
  // No broad dynamic import — that's what the rewrite eliminates
  assert.doesNotMatch(componentPage, /await\s+import\(`@\//);
});

test('component page shows a "not in static map" message when slug is missing', () => {
  // This is the new UX for "user added to adhd.config.ts but didn't re-run setup."
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const componentPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'components', '[component]', 'page.design-system.tsx'),
    'utf8',
  );
  assert.match(componentPage, /Not in the static map/);
  assert.match(componentPage, /\/adhd:sync-docs/);
});

test('detectExistingInstall returns marker-bearing files', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
    components: SAMPLE_COMPONENTS,
    cssEntry: 'app/globals.css',
  });
  const found = detectExistingInstall(root);
  assert.ok(found.length >= 8);
  assert.ok(found.every(p => p.includes('-docs')));
});

test('detectExistingInstall returns [] when no marker is present', () => {
  const root = makeTempProject();
  assert.deepEqual(detectExistingInstall(root), []);
});

test('re-running installRoute overwrites files cleanly', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true,
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const layoutPath = path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx');
  fs.writeFileSync(layoutPath, 'corrupted');
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true,
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const after = fs.readFileSync(layoutPath, 'utf8');
  assert.match(after, /design-system-docs-route/);
  assert.match(after, /DesignSystemDocsLayout/);
});

test('installRoute removes stale marker-bearing files from a previous layout', () => {
  // Simulate an older install where the dynamic-import-era component page
  // lived at `[component]/page` directly under docsDir.
  const root = makeTempProject();
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  const oldCompDir = path.join(docsDir, '[component]');
  fs.mkdirSync(oldCompDir, { recursive: true });
  const oldPath = path.join(oldCompDir, 'page.design-system.tsx');
  fs.writeFileSync(oldPath, '// design-system-docs-route — stale\nexport {};\n');

  const r = installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true,
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });

  assert.ok(!fs.existsSync(oldPath));
  assert.ok(r.removed.includes(oldPath));
  assert.ok(!fs.existsSync(oldCompDir));
});

test('installRoute preserves user files that lack the marker', () => {
  const root = makeTempProject();
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const userFile = path.join(docsDir, 'user-notes.tsx');
  fs.writeFileSync(userFile, '// user wrote this\nexport const NOTE = "keep";\n');

  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true,
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });

  assert.ok(fs.existsSync(userFile));
});

test('installRoute supports an empty groupName (no route group)', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '', routeSegment: '-docs', prodExcluded: true,
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'componentMap.tsx')));
});

test('renderComponentMap is exposed (standalone snapshot of the map source)', () => {
  const body = renderComponentMap([
    { slug: 'logo', rawPath: 'components/Logo.tsx', importPath: '@/components/Logo' },
  ]);
  assert.match(body, /design-system-docs-route/);
  assert.match(body, /import \* as \$cmp0 from "@\/components\/Logo"/);
  assert.match(body, /slug: "logo"/);
});
