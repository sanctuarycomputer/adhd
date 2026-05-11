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

  const ext = prodExcluded ? '.design-system.tsx' : '.tsx';
  const segments = ['app'];
  if (groupName) segments.push(groupName);
  segments.push(routeSegment);
  const docsDir = path.join(projectRoot, ...segments);
  const componentDir = path.join(docsDir, '[component]');

  mkdirpSync(docsDir);
  mkdirpSync(componentDir);

  fs.writeFileSync(path.join(docsDir, `layout${ext}`), LAYOUT_TSX);
  fs.writeFileSync(path.join(docsDir, `page${ext}`), INDEX_PAGE_TSX);
  fs.writeFileSync(path.join(componentDir, `page${ext}`), COMPONENT_PAGE_TSX);
  fs.writeFileSync(path.join(docsDir, `PropToggle${ext}`), PROP_TOGGLE_TSX);

  return {
    files: [
      path.join(docsDir, `layout${ext}`),
      path.join(docsDir, `page${ext}`),
      path.join(componentDir, `page${ext}`),
      path.join(docsDir, `PropToggle${ext}`),
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
