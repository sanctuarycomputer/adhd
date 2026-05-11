'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MARKER_COMMENT, LAYOUT_TSX, INDEX_PAGE_TSX, COMPONENT_PAGE_TSX, PROP_TOGGLE_TSX } = require('./templates');

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
  // keeps the `import "../PropToggle"` in COMPONENT_PAGE_TSX resolvable.
  const moduleExt = '.tsx';
  const segments = ['app'];
  if (groupName) segments.push(groupName);
  segments.push(routeSegment);
  const docsDir = path.join(projectRoot, ...segments);
  const componentDir = path.join(docsDir, '[component]');

  // The runtime route URL (route groups like `(design-system)` are invisible in URLs,
  // so the URL is just `/<routeSegment>`). Templates use `__ROUTE_PATH__` as a
  // placeholder for this — relative hrefs like `./<slug>` would resolve incorrectly
  // when the current path is `/<segment>` without a trailing slash.
  const routeUrl = '/' + routeSegment;
  const indexBody = INDEX_PAGE_TSX.replace(/__ROUTE_PATH__/g, routeUrl);

  mkdirpSync(docsDir);
  mkdirpSync(componentDir);

  fs.writeFileSync(path.join(docsDir, `layout${pageExt}`), LAYOUT_TSX);
  fs.writeFileSync(path.join(docsDir, `page${pageExt}`), indexBody);
  fs.writeFileSync(path.join(componentDir, `page${pageExt}`), COMPONENT_PAGE_TSX);
  fs.writeFileSync(path.join(docsDir, `PropToggle${moduleExt}`), PROP_TOGGLE_TSX);

  return {
    files: [
      path.join(docsDir, `layout${pageExt}`),
      path.join(docsDir, `page${pageExt}`),
      path.join(componentDir, `page${pageExt}`),
      path.join(docsDir, `PropToggle${moduleExt}`),
    ],
  };
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
          if (content.includes('design-system-docs-route')) {
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
