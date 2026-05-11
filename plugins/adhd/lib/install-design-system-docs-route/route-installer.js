'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LAYOUT_TSX,
  INDEX_PAGE_TSX,
  TOKENS_PAGE_TSX,
  COMPONENT_PAGE_TSX,
  COMPONENT_ERROR_TSX,
  PROP_TOGGLE_TSX,
} = require('./templates');

const MARKER_STR = 'design-system-docs-route';

function mkdirpSync(p) {
  fs.mkdirSync(p, { recursive: true });
}

function installRoute(projectRoot, opts) {
  const { groupName = '', routeSegment, prodExcluded } = opts;
  if (!routeSegment) throw new Error('routeSegment is required');

  // Page/layout files get the `.design-system.tsx` extension only when prod-excluded
  // so Next.js's `pageExtensions` conditional filters them out of production builds.
  const pageExt = prodExcluded ? '.design-system.tsx' : '.tsx';
  // PropToggle is a regular module (not a route file by name), so it doesn't need
  // the `.design-system` suffix to be excluded — it's only bundled if its importing
  // page is in the build, and the page IS suffix-excluded. Using a plain `.tsx`
  // keeps the `import "../../PropToggle"` in COMPONENT_PAGE_TSX resolvable.
  const moduleExt = '.tsx';
  const segments = ['app'];
  if (groupName) segments.push(groupName);
  segments.push(routeSegment);
  const docsDir = path.join(projectRoot, ...segments);
  const tokensDir = path.join(docsDir, 'tokens', '[domain]');
  const componentsDir = path.join(docsDir, 'components', '[component]');

  // The runtime route URL (route groups like `(design-system)` are invisible in URLs,
  // so the URL is just `/<routeSegment>`). Templates use `__ROUTE_PATH__` as a
  // placeholder so absolute hrefs in the sidebar/landing resolve correctly.
  const routeUrl = '/' + routeSegment;

  // Files we're about to write. Anything else with our marker comment under
  // `docsDir` is leftover from a previous installer version and gets removed
  // below — that's how re-installs pick up structural changes (e.g. moving
  // `[component]/` to `components/[component]/`).
  const targets = [
    { abs: path.join(docsDir, `layout${pageExt}`), body: LAYOUT_TSX },
    { abs: path.join(docsDir, `page${pageExt}`), body: INDEX_PAGE_TSX },
    { abs: path.join(tokensDir, `page${pageExt}`), body: TOKENS_PAGE_TSX },
    { abs: path.join(componentsDir, `page${pageExt}`), body: COMPONENT_PAGE_TSX },
    // error.tsx must be a client component, and Next.js handles it like any
    // route file — it goes through pageExtensions. The plain `.tsx` variant
    // is used when prod-exclusion is off (mirrors layout/page).
    { abs: path.join(componentsDir, `error${pageExt}`), body: COMPONENT_ERROR_TSX },
    { abs: path.join(docsDir, `PropToggle${moduleExt}`), body: PROP_TOGGLE_TSX },
  ];

  // Substitute the `__ROUTE_PATH__` placeholder in every body that needs it
  // (the layout sidebar links and the landing-page references). It's a no-op
  // for bodies that don't contain the placeholder.
  for (const t of targets) {
    t.body = t.body.replace(/__ROUTE_PATH__/g, routeUrl);
  }

  // Remove old marker-bearing files that aren't in the new target set. This
  // lets users re-run the installer after structural changes (e.g. older
  // versions put the component page at `[component]/page.*` directly under
  // docsDir; new versions put it under `components/[component]/page.*`).
  const targetSet = new Set(targets.map(t => t.abs));
  const removed = removeStaleMarkerFiles(docsDir, targetSet);

  // Now write the new files. Directories are created on demand.
  for (const t of targets) {
    mkdirpSync(path.dirname(t.abs));
    fs.writeFileSync(t.abs, t.body);
  }

  // Best-effort cleanup of now-empty directories left behind by removed files
  // (e.g. the old `app/.../-docs/[component]/` directory).
  pruneEmptyDirs(docsDir);

  return {
    files: targets.map(t => t.abs),
    removed,
  };
}

// Walk `docsDir`, find every `.tsx` file containing the marker comment, and
// delete the ones that aren't in `keep`. Returns the list of removed paths.
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

// Recursively delete empty directories under (and including) `dir`. Skips `dir`
// itself if it's non-empty after the recursion.
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

module.exports = { installRoute, detectExistingInstall };
