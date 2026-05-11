'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installRoute, detectExistingInstall, renderComponentMap } = require('../route-installer');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-sync-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  return root;
}

// A fixture component the installer can read for prop-baking tests.
function writeLogoFixture(root) {
  const dir = path.join(root, 'components/design-system/logo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.tsx'), `
export type LogoSize = "sm" | "md" | "lg";

export interface LogoProps {
  size: LogoSize;
  inverted?: boolean;
  title?: string;
}

export default function Logo(props: LogoProps) {
  return null;
}
`);
}

const SAMPLE_COMPONENTS = [
  { slug: 'logo', rawPath: 'components/design-system/logo/index.tsx', importPath: '@/components/design-system/logo' },
];

test('installRoute writes the five generated files with renderMode: dev-only', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  // Route files get the suffix so pageExtensions filters them in prod.
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'tokens', '[domain]', 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'page.design-system.tsx')));
  // componentMap is a plain .tsx module so TS module resolution finds it.
  assert.ok(fs.existsSync(path.join(docsDir, 'componentMap.tsx')));
  // Files we used to write but no longer do:
  assert.ok(!fs.existsSync(path.join(docsDir, 'components', '[component]', 'error.design-system.tsx')));
  assert.ok(!fs.existsSync(path.join(docsDir, 'components', '[component]', 'error.tsx')));
  assert.ok(!fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
  assert.ok(!fs.existsSync(path.join(docsDir, 'tokenDomains.tsx')));
});

test('installRoute writes plain .tsx files for route files with renderMode: "everywhere"', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'everywhere',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'tokens', '[domain]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'components', '[component]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'componentMap.tsx')));
});

test('installRoute uses .design-system suffix for both excluding renderModes', () => {
  // Both 'dev-only' and 'vercel-preview' rely on pageExtensions to filter
  // .design-system.tsx files in production builds. The choice of WHICH env var
  // gates the filter is the next-config-patcher's concern, not the installer's.
  for (const renderMode of ['dev-only', 'vercel-preview']) {
    const root = makeTempProject();
    writeLogoFixture(root);
    installRoute(root, {
      groupName: '(design-system)', routeSegment: '-docs', renderMode,
      components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
    });
    const docsDir = path.join(root, 'app', '(design-system)', '-docs');
    assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')), `renderMode=${renderMode}`);
    assert.ok(fs.existsSync(path.join(docsDir, 'page.design-system.tsx')), `renderMode=${renderMode}`);
  }
});

test('installRoute throws on an unknown renderMode (typo-protection)', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  assert.throws(
    () => installRoute(root, {
      groupName: '(design-system)', routeSegment: '-docs', renderMode: 'preview',
      components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
    }),
    /Unknown renderMode: preview/,
  );
});

test('installRoute defaults to renderMode: "dev-only" when none is provided', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs',
    // renderMode intentionally omitted
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
});

test('all written files start with the marker comment', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  for (const f of [
    'layout.design-system.tsx',
    'page.design-system.tsx',
    'tokens/[domain]/page.design-system.tsx',
    'components/[component]/page.design-system.tsx',
    'componentMap.tsx',
  ]) {
    const content = fs.readFileSync(path.join(docsDir, f), 'utf8');
    assert.match(content, /design-system-docs-route/, `${f} missing marker`);
  }
});

test('componentMap.tsx has explicit static imports per registered component', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const body = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'componentMap.tsx'),
    'utf8',
  );
  assert.match(body, /import \* as \$cmp0 from "@\/components\/design-system\/logo"/);
  assert.match(body, /slug: "logo"/);
  assert.match(body, /rawPath: "components\/design-system\/logo\/index\.tsx"/);
  assert.match(body, /module: \$cmp0/);
  assert.doesNotMatch(body, /await\s+import\(`/);
});

test('componentMap.tsx bakes prop schemas read from each component source at sync time', () => {
  // The component page no longer does fs reads — props are baked here. Test
  // verifies that the LogoProps interface (size: union, inverted: boolean,
  // title: string) is preserved verbatim in the generated map.
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const body = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'componentMap.tsx'),
    'utf8',
  );
  // The whole entry is a single JS line — match the inline JSON body.
  assert.match(body, /props: \{[^}]*"size":\{"type":"union","values":\["sm","md","lg"\],"optional":false\}/);
  assert.match(body, /"inverted":\{"type":"boolean","optional":true\}/);
  assert.match(body, /"title":\{"type":"string","optional":true\}/);
});

test('componentMap.tsx handles an empty components list', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: [], cssEntry: 'app/globals.css',
  });
  const body = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'componentMap.tsx'),
    'utf8',
  );
  assert.doesNotMatch(body, /import \* as \$cmp/);
  assert.match(body, /const ENTRIES.*=\s*\[\]/);
});

test('componentMap.tsx handles a missing component source file (empty props baked)', () => {
  // If a component listed in adhd.config.ts doesn't exist on disk, sync shouldn't
  // crash — it bakes `{}` for that entry's props. The page then shows "No prop
  // interface detected at sync time" which is the right signal.
  const root = makeTempProject();
  // Note: we DON'T call writeLogoFixture — the file is missing on purpose.
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const body = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'componentMap.tsx'),
    'utf8',
  );
  assert.match(body, /props: \{\}/);
});

test('layout sidebar links use absolute hrefs derived from the route segment', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const layout = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx'),
    'utf8',
  );
  assert.match(layout, /href=\{`\/-docs\/tokens\/\$\{d\.slug\}`\}/);
  assert.match(layout, /href=\{`\/-docs\/components\/\$\{c\.slug\}`\}/);
  assert.doesNotMatch(layout, /__ROUTE_PATH__/);
});

test('layout imports the static components array from componentMap', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const layout = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx'),
    'utf8',
  );
  assert.match(layout, /import \{ components \} from "\.\/componentMap"/);
  assert.doesNotMatch(layout, /from "node:fs|from "node:path/);
});

test('tokens page imports TOKEN_DOMAINS from layout.design-system with renderMode: dev-only', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const tokensPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'tokens', '[domain]', 'page.design-system.tsx'),
    'utf8',
  );
  assert.match(tokensPage, /from "\.\.\/\.\.\/layout\.design-system"/);
  assert.doesNotMatch(tokensPage, /__LAYOUT_MODULE__/);
});

test('tokens page imports TOKEN_DOMAINS from layout (no suffix) with renderMode: "everywhere"', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'everywhere',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const tokensPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'tokens', '[domain]', 'page.tsx'),
    'utf8',
  );
  assert.match(tokensPage, /from "\.\.\/\.\.\/layout"/);
  assert.doesNotMatch(tokensPage, /__LAYOUT_MODULE__/);
});

test('tokens page bakes the configured cssEntry path as a constant', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'src/app/globals.css',
  });
  const tokensPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'tokens', '[domain]', 'page.design-system.tsx'),
    'utf8',
  );
  assert.match(tokensPage, /CSS_ENTRY = "src\/app\/globals\.css"/);
  assert.doesNotMatch(tokensPage, /adhd\.config\.ts/);
});

test('component page is a client component with inline PropToggle and no fs reads', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const componentPage = fs.readFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'components', '[component]', 'page.design-system.tsx'),
    'utf8',
  );
  // "use client" sits after the marker comment (two `//` lines), so strip leading
  // comments before checking the directive is the first real statement.
  assert.match(componentPage.replace(/^(?:\/\/[^\n]*\n)+/, ''), /^["']use client["']/);
  // Uses hooks instead of async params/searchParams.
  assert.match(componentPage, /useParams/);
  assert.match(componentPage, /useSearchParams/);
  assert.match(componentPage, /useRouter/);
  // PropToggle is inlined, not imported.
  assert.match(componentPage, /function PropToggle\(/);
  assert.doesNotMatch(componentPage, /from "\.\.\/PropToggle"|from "\.\.\/\.\.\/PropToggle"/);
  // No fs reads — everything's baked into componentMap.
  assert.doesNotMatch(componentPage, /from "node:fs|from "node:path/);
});

test('component page shows a "not in static map" message when slug is missing', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
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
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const found = detectExistingInstall(root);
  assert.ok(found.length >= 5);
  assert.ok(found.every(p => p.includes('-docs')));
});

test('detectExistingInstall returns [] when no marker is present', () => {
  const root = makeTempProject();
  assert.deepEqual(detectExistingInstall(root), []);
});

test('re-running installRoute overwrites files cleanly', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const layoutPath = path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx');
  fs.writeFileSync(layoutPath, 'corrupted');
  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const after = fs.readFileSync(layoutPath, 'utf8');
  assert.match(after, /design-system-docs-route/);
  assert.match(after, /DesignSystemDocsLayout/);
});

test('re-sync removes stale files from previous template layouts', () => {
  // Mirrors actual upgrade paths: previous installer versions wrote a separate
  // tokenDomains.tsx + PropToggle.tsx + error.design-system.tsx. Re-syncing
  // should clean them all up because they carry the marker.
  const root = makeTempProject();
  writeLogoFixture(root);
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  fs.mkdirSync(path.join(docsDir, 'components', '[component]'), { recursive: true });
  const stale = [
    path.join(docsDir, 'tokenDomains.tsx'),
    path.join(docsDir, 'PropToggle.tsx'),
    path.join(docsDir, 'components', '[component]', 'error.design-system.tsx'),
  ];
  for (const p of stale) fs.writeFileSync(p, '// design-system-docs-route — stale\nexport {};\n');

  const r = installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });

  for (const p of stale) {
    assert.ok(!fs.existsSync(p), `stale ${path.basename(p)} should be removed`);
    assert.ok(r.removed.includes(p));
  }
});

test('installRoute preserves user files that lack the marker', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const userFile = path.join(docsDir, 'user-notes.tsx');
  fs.writeFileSync(userFile, '// user wrote this\nexport const NOTE = "keep";\n');

  installRoute(root, {
    groupName: '(design-system)', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });

  assert.ok(fs.existsSync(userFile));
});

test('installRoute supports an empty groupName (no route group)', () => {
  const root = makeTempProject();
  writeLogoFixture(root);
  installRoute(root, {
    groupName: '', routeSegment: '-docs', renderMode: 'dev-only',
    components: SAMPLE_COMPONENTS, cssEntry: 'app/globals.css',
  });
  const docsDir = path.join(root, 'app', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'componentMap.tsx')));
});

test('renderComponentMap is exposed (standalone snapshot helper, takes projectRoot)', () => {
  // The renderComponentMap export takes (projectRoot, components) so it can
  // read each component's source file for prop baking. With a non-existent
  // root, props bake to {} but the rest of the output is well-formed.
  const body = renderComponentMap('/nonexistent', [
    { slug: 'logo', rawPath: 'components/Logo.tsx', importPath: '@/components/Logo' },
  ]);
  assert.match(body, /design-system-docs-route/);
  assert.match(body, /import \* as \$cmp0 from "@\/components\/Logo"/);
  assert.match(body, /slug: "logo"/);
  assert.match(body, /props: \{\}/);
});
