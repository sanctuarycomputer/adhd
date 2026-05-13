'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LAYOUT_TSX,
  INDEX_PAGE_TSX,
  TOKENS_PAGE_TSX,
  COMPONENT_PAGE_TSX,
  COMPONENT_MAP_TSX,
} = require('./templates');
const { parseProps } = require('./prop-parser');

const MARKER_STR = 'design-system-docs-route';

function mkdirpSync(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Reads a component's source file and returns a sync-time-baked prop schema
// suitable for embedding in componentMap.tsx. The schema mirrors the runtime
// PropSchema type in the template — only the shape the page actually uses
// (type + optional values for unions + the `optional` flag).
function bakedPropsFor(projectRoot, rawPath) {
  const fullPath = path.join(projectRoot, rawPath);
  let src;
  try { src = fs.readFileSync(fullPath, 'utf8'); }
  catch { return {}; }
  const { props } = parseProps(src);
  const out = {};
  for (const [name, def] of Object.entries(props)) {
    // The page only renders toggles for these four shapes; everything else
    // shows up as "toggle unavailable" so collapsing to "unknown" is fine.
    if (def.type === 'union' && Array.isArray(def.values)) {
      out[name] = { type: 'union', values: def.values, optional: !!def.optional };
    } else if (def.type === 'boolean' || def.type === 'string' || def.type === 'number') {
      out[name] = { type: def.type, optional: !!def.optional };
    } else {
      out[name] = { type: 'unknown', optional: !!def.optional };
    }
  }
  return out;
}

// Build the import + entries source for componentMap.tsx from the parsed
// adhd.config.ts components list. Each entry includes baked prop schemas so
// the component page doesn't need to do any fs reads at request time. Empty
// list is fine — the map exports an empty `components` array and the layout's
// sidebar shows a friendly "none tracked" message.
function renderComponentMap(projectRoot, components) {
  const imports = components
    .map((c, i) => `import * as $cmp${i} from "${c.importPath}";`)
    .join('\n');
  const entries = components
    .map((c, i) => {
      const props = JSON.stringify(bakedPropsFor(projectRoot, c.rawPath));
      const figmaUrl = c.figmaUrl ? JSON.stringify(c.figmaUrl) : 'null';
      const pulledAt = c.pulledAt ? JSON.stringify(c.pulledAt) : 'null';
      return `  { slug: ${JSON.stringify(c.slug)}, rawPath: ${JSON.stringify(c.rawPath)}, figmaUrl: ${figmaUrl}, pulledAt: ${pulledAt}, module: $cmp${i}, props: ${props} },`;
    })
    .join('\n');
  return COMPONENT_MAP_TSX
    .replace('__COMPONENT_IMPORTS__', imports)
    .replace('__COMPONENT_ENTRIES__', entries.length === 0 ? '[]' : `[\n${entries}\n]`);
}

// Three render modes:
//   - 'everywhere'      → files use plain .tsx, no next.config patch, ship to prod
//   - 'dev-only'        → files use .design-system.tsx, next.config gates on NODE_ENV
//   - 'vercel-preview'  → files use .design-system.tsx, next.config gates on a
//                         compound (VERCEL_ENV='production' OR non-Vercel prod)
const VALID_RENDER_MODES = new Set(['everywhere', 'dev-only', 'vercel-preview']);

function installRoute(projectRoot, opts) {
  const {
    groupName = '',
    routeSegment,
    renderMode = 'dev-only',
    components = [],
    cssEntry = 'app/globals.css',
  } = opts;
  if (!routeSegment) throw new Error('routeSegment is required');
  if (!VALID_RENDER_MODES.has(renderMode)) {
    throw new Error(`Unknown renderMode: ${renderMode}. Expected one of: ${[...VALID_RENDER_MODES].join(', ')}.`);
  }
  // 'everywhere' is the only mode where pages don't get the suffix; the other
  // two both rely on `pageExtensions` to filter `.design-system.tsx` files in
  // production builds (they just differ in WHICH env var the conditional reads,
  // which is a next-config-patcher concern, not a file-extension concern).
  const prodExcluded = renderMode !== 'everywhere';

  // Page/layout files get the `.design-system.tsx` suffix only when prod-excluded
  // so Next.js's `pageExtensions` filters them out of production builds.
  // componentMap is a regular module — it's only bundled when imported by a page
  // that IS suffix-excluded, so plain `.tsx` is correct (and necessary for
  // standard TS module resolution to find it).
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
    { abs: path.join(docsDir, `componentMap${moduleExt}`), body: renderComponentMap(projectRoot, components) },
  ];

  // The tokens page imports TOKEN_DOMAINS from the layout. The layout file's
  // basename depends on prod-exclusion (`layout` vs `layout.design-system`).
  // TS/bundler resolution adds `.tsx` to whichever basename we use, so we
  // substitute the right one here. Path is two levels up from
  // `tokens/[domain]/page.*` to the docs root where `layout.*` lives.
  const layoutModule = prodExcluded ? '../../layout.design-system' : '../../layout';

  // Sync timestamp baked into the layout's sidebar header. UTC, no locale
  // dependency, format YYYY-MM-DD HH:MM UTC. Designers reading the docs
  // route see "Last built 2026-05-11 03:14 UTC" — a clear signal of
  // whether what they're looking at is fresh or stale.
  const syncAt = (() => {
    const d = opts.now instanceof Date ? opts.now : new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
           `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  })();

  // Per-template placeholder substitution.
  for (const t of targets) {
    t.body = t.body
      .replace(/__ROUTE_PATH__/g, routeUrl)
      .replace(/__CSS_ENTRY__/g, cssEntry)
      .replace(/__LAYOUT_MODULE__/g, layoutModule)
      .replace(/__SYNC_AT__/g, syncAt);
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
