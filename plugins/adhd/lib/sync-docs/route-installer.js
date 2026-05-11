'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LAYOUT_TSX,
  INDEX_PAGE_TSX,
  TOKENS_PAGE_TSX,
  COMPONENT_PAGE_TSX,
  COMPONENT_ERROR_TSX,
  COMPONENT_MAP_TSX,
  PROP_TOGGLE_TSX,
} = require('./templates');

const MARKER_STR = 'design-system-docs-route';

function mkdirpSync(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Build the import + entries source for componentMap.tsx from the parsed
// adhd.config.ts components list. Empty list is fine — the map exports an
// empty array and the layout's sidebar shows a friendly "none tracked" message.
function renderComponentMap(components) {
  const imports = components
    .map((c, i) => `import * as $cmp${i} from "${c.importPath}";`)
    .join('\n');
  const entries = components
    .map((c, i) => `  { slug: ${JSON.stringify(c.slug)}, rawPath: ${JSON.stringify(c.rawPath)}, module: $cmp${i} },`)
    .join('\n');
  return COMPONENT_MAP_TSX
    .replace('__COMPONENT_IMPORTS__', imports)
    .replace('__COMPONENT_ENTRIES__', entries.length === 0 ? '[]' : `[\n${entries}\n]`);
}

function installRoute(projectRoot, opts) {
  const {
    groupName = '',
    routeSegment,
    prodExcluded,
    components = [],
    cssEntry = 'app/globals.css',
  } = opts;
  if (!routeSegment) throw new Error('routeSegment is required');

  // Page/layout/error files get the `.design-system.tsx` suffix only when
  // prod-excluded so Next.js's `pageExtensions` filters them out of production
  // builds. componentMap and PropToggle are regular modules — they're only
  // bundled when imported by a page that IS suffix-excluded, so plain `.tsx`
  // is correct (and necessary for standard TS module resolution to find them).
  const pageExt = prodExcluded ? '.design-system.tsx' : '.tsx';
  const moduleExt = '.tsx';
  const segments = ['app'];
  if (groupName) segments.push(groupName);
  segments.push(routeSegment);
  const docsDir = path.join(projectRoot, ...segments);
  const tokensDir = path.join(docsDir, 'tokens', '[domain]');
  const componentsDir = path.join(docsDir, 'components', '[component]');

  // The runtime URL (route groups like `(design-system)` are invisible in URLs,
  // so the URL is just `/<routeSegment>`). Templates use `__ROUTE_PATH__` for
  // absolute hrefs in the sidebar.
  const routeUrl = '/' + routeSegment;

  const targets = [
    { abs: path.join(docsDir, `layout${pageExt}`), body: LAYOUT_TSX },
    { abs: path.join(docsDir, `page${pageExt}`), body: INDEX_PAGE_TSX },
    { abs: path.join(tokensDir, `page${pageExt}`), body: TOKENS_PAGE_TSX },
    { abs: path.join(componentsDir, `page${pageExt}`), body: COMPONENT_PAGE_TSX },
    { abs: path.join(componentsDir, `error${pageExt}`), body: COMPONENT_ERROR_TSX },
    { abs: path.join(docsDir, `componentMap${moduleExt}`), body: renderComponentMap(components) },
    { abs: path.join(docsDir, `PropToggle${moduleExt}`), body: PROP_TOGGLE_TSX },
  ];

  // The tokens page imports TOKEN_DOMAINS from the layout. The layout file's
  // basename depends on prod-exclusion (`layout` vs `layout.design-system`).
  // TS/bundler resolution adds `.tsx` to whichever basename we use, so we
  // substitute the right one here. Path is two levels up from
  // `tokens/[domain]/page.*` to the docs root where `layout.*` lives.
  const layoutModule = prodExcluded ? '../../layout.design-system' : '../../layout';

  // Per-template placeholder substitution.
  for (const t of targets) {
    t.body = t.body
      .replace(/__ROUTE_PATH__/g, routeUrl)
      .replace(/__CSS_ENTRY__/g, cssEntry)
      .replace(/__LAYOUT_MODULE__/g, layoutModule);
  }

  // Remove stale marker-bearing files from previous template layouts (e.g. the
  // old `[component]/page.*` directly under docsDir, or layout.* from a version
  // before componentMap.tsx existed). Files where the user has deleted the
  // marker comment are preserved.
  const targetSet = new Set(targets.map(t => t.abs));
  const removed = removeStaleMarkerFiles(docsDir, targetSet);

  for (const t of targets) {
    mkdirpSync(path.dirname(t.abs));
    fs.writeFileSync(t.abs, t.body);
  }

  pruneEmptyDirs(docsDir);

  return {
    files: targets.map(t => t.abs),
    removed,
  };
}

function removeStaleMarkerFiles(docsDir, keep) {
  const removed = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(ent.name)) continue;
      if (keep.has(full)) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes(MARKER_STR)) {
          fs.unlinkSync(full);
          removed.push(full);
        }
      } catch {}
    }
  }
  walk(docsDir);
  return removed;
}

function pruneEmptyDirs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const ent of entries) {
    if (ent.isDirectory()) pruneEmptyDirs(path.join(dir, ent.name));
  }
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {}
}

function detectExistingInstall(projectRoot) {
  const found = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.next' || ent.name.startsWith('.git')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(ent.name)) {
        try {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes(MARKER_STR)) {
            found.push(full);
          }
        } catch {}
      }
    }
  }
  walk(path.join(projectRoot, 'app'));
  return found;
}

module.exports = { installRoute, detectExistingInstall, renderComponentMap };
