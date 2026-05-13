'use strict';

// Resolve a Figma component-set ID (e.g. "123:456") to its React
// import metadata using `adhd.config.ts`'s `components: { ... }` map.
// Powers pull-component's scaffold-mode handling of INSTANCE children:
// when the simple-layout-driven rubric sees a node binding
// `mainComponent` of another tracked component, this resolver produces
// the import path / export name so the generated JSX can read
// `<TrackedComponent {...props} />` with a proper import at the top.
//
// Per the design choice ("(a) refuse / abort"), when a Figma instance's
// mainComponent isn't in adhd.config.ts, this resolver returns
// `{ matched: false }` and the SKILL aborts with a "pull this first"
// message. The user pulls the dependency, then re-runs the parent.

const fs = require('node:fs');
const path = require('node:path');
const {
  findConfigObjectRange,
  findComponentsRange,
  iterateObjectEntries,
  findFigmaUrlInEntry,
} = require('./config-writer');

// Extract the Figma node-id query parameter from a design URL and
// convert it from the URL form (`A-B`) to the internal Figma ID form
// (`A:B`). Returns null when the URL has no node-id, isn't a Figma
// design URL, or otherwise can't be parsed.
function nodeIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /[?&]node-id=([^&]+)/.exec(url);
  if (!m) return null;
  // The URL form uses `-` between major:minor; the API uses `:`. Only
  // the FIRST `-` is the separator — variant IDs can themselves
  // contain hyphens (e.g. `123-456-7` → `123:456-7` is wrong; the
  // correct conversion is `123:456` and the trailing `-7` is part of
  // a deeper id, but Figma's URL exporter uses `-` consistently). The
  // standard rule the rest of ADHD uses is to swap the FIRST hyphen
  // only; mirror that here.
  const dec = decodeURIComponent(m[1]);
  const i = dec.indexOf('-');
  if (i < 0) return dec;
  return dec.slice(0, i) + ':' + dec.slice(i + 1);
}

// PascalCase a file path's slug for use as a fallback export name when
// the target file doesn't exist yet (or its export name can't be
// inferred via Read). Same rule sync-docs uses.
function pascalSlugFromPath(relPath) {
  const noExt = relPath.replace(/\.(t|j)sx?$/, '').replace(/\/index$/, '');
  const slug = noExt.split('/').pop() || '';
  return slug.split(/[-_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

// Derive a `@/`-aliased import path from a relative file path. Mirrors
// the sync-docs config-parser's `importPathFor` so generated imports
// look native in a Next.js consumer repo.
function importPathFor(relPath) {
  return '@/' + relPath.replace(/\.(t|j)sx?$/, '').replace(/\/index$/, '');
}

// Best-effort read of the exported component name from a TS/TSX file.
// Looks for `export default function Name`, `export function Name`,
// `export const Name`, or `export default Name`. Returns null when no
// match — caller falls back to the PascalCase slug.
function readExportName(absPath) {
  let src;
  try { src = fs.readFileSync(absPath, 'utf8'); }
  catch { return null; }
  const patterns = [
    /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/,
    /export\s+function\s+([A-Z][A-Za-z0-9_]*)/,
    /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/,
    /export\s+default\s+([A-Z][A-Za-z0-9_]*)\s*;?/,
  ];
  for (const re of patterns) {
    const m = re.exec(src);
    if (m) return m[1];
  }
  return null;
}

// Main resolver. Walks every component entry in adhd.config.ts,
// extracts each entry's figma node-id, converts to the internal ID
// form, and matches against `componentId`. Returns:
//   { matched: true, relPath, absPath, importPath, exportName, fileExists }
// when the component-id is tracked, with `fileExists` indicating
// whether the React file is on disk yet (the SKILL surfaces this
// distinction so the "pull this dependency first" message points at
// the right next step).
//
// Returns `{ matched: false }` when the component-id isn't in the
// config — caller aborts with a clear error.
function resolveInstance({ configSrc, componentId, repoRoot }) {
  const cfg = findConfigObjectRange(configSrc);
  if (!cfg) return { matched: false };
  const comps = findComponentsRange(configSrc, cfg);
  if (!comps) return { matched: false };

  for (const entry of iterateObjectEntries(configSrc, comps)) {
    if (configSrc[entry.valueStart] !== '{') continue;
    const urlInfo = findFigmaUrlInEntry(configSrc, { start: entry.valueStart, end: entry.valueEnd });
    if (!urlInfo) continue;
    const entryId = nodeIdFromUrl(urlInfo.urlText);
    if (entryId !== componentId) continue;

    const relPath = entry.key;
    const absPath = repoRoot ? path.join(repoRoot, relPath) : relPath;
    const fileExists = fs.existsSync(absPath);
    const exportName = (fileExists ? readExportName(absPath) : null) || pascalSlugFromPath(relPath);
    return {
      matched: true,
      relPath,
      absPath,
      importPath: importPathFor(relPath),
      exportName,
      fileExists,
    };
  }
  return { matched: false };
}

module.exports = { resolveInstance, nodeIdFromUrl, pascalSlugFromPath, importPathFor, readExportName };
