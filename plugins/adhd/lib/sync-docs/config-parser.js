'use strict';

// Parses the consumer's `adhd.config.ts` at install time. Mirrors the inline
// regex parser that previous template versions ran at request time — but here
// we parse once at install and bake the result into the generated files,
// so adding/renaming/removing components requires re-running the installer.
// That's intentional: the new architecture uses static imports.

const fs = require('node:fs');
const path = require('node:path');

// Extracts the `components` map keys from the source. Keys are absolute
// component paths relative to the consumer's project root (matching the
// shape of `adhd.config.ts`). Uses a brace-counted scan so nested objects
// (each entry's `{ figma: { url: "..." } }` value) don't confuse the
// parser — a naïve non-greedy regex would stop at the first `}`.
function parseComponents(src) {
  const startMatch = /components:\s*\{/.exec(src);
  if (!startMatch) return [];
  const openAt = startMatch.index + startMatch[0].length - 1; // position of the opening `{`
  let depth = 1;
  let k = openAt + 1;
  while (k < src.length && depth > 0) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') depth--;
    if (depth > 0) k++;
  }
  const inner = src.slice(openAt + 1, k);
  // Only top-level keys: track depth inside the inner block so we don't
  // pick up keys from nested objects (e.g. `figma: { url: ... }`).
  const paths = [];
  let d = 0;
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '{') { d++; i++; continue; }
    if (ch === '}') { d--; i++; continue; }
    if (d === 0 && ch === '"') {
      // Read the string literal
      const end = inner.indexOf('"', i + 1);
      if (end === -1) break;
      const key = inner.slice(i + 1, end);
      // Confirm this is a key (followed by `:` after optional whitespace)
      let j = end + 1;
      while (j < inner.length && /\s/.test(inner[j])) j++;
      if (inner[j] === ':') paths.push(key);
      i = end + 1;
      continue;
    }
    i++;
  }
  return paths;
}

function parseCssEntry(src) {
  const m = /cssEntry\s*:\s*"([^"]+)"/.exec(src);
  return m ? m[1] : 'app/globals.css';
}

// Extract the `figma.url` value for a given component-path key. Returns
// `null` when the entry has no `figma: { url: "..." }` block — the docs
// route's "open in Figma" link is then suppressed for that component.
// Targeted regex scoped to the value block that follows the path key.
function parseFigmaUrlForPath(src, p) {
  const escapedPath = p.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const re = new RegExp(
    '"' + escapedPath + '"\\s*:\\s*\\{[^}]*figma\\s*:\\s*\\{[^}]*url\\s*:\\s*"([^"]+)"',
  );
  const m = re.exec(src);
  return m ? m[1] : null;
}

// Derive a URL slug from a component path. Mirrors the runtime helper used in
// previous template versions so existing URL contracts are unchanged.
//   src/components/Logo/index.tsx → "logo"
//   app/widgets/Button.tsx        → "button"
function slugFor(p) {
  const noExt = p.replace(/\.tsx?$/, '').replace(/\/index$/, '');
  return noExt.split('/').pop().toLowerCase();
}

// Compute an import-path string suitable for `import * as X from "@/..."`.
// Strips the file extension and a trailing `/index` so the bundler picks the
// directory's index.tsx automatically.
function importPathFor(p) {
  return '@/' + p.replace(/\.tsx?$/, '').replace(/\/index$/, '');
}

// Per-path `pulledAt` extractor. Mirrors parseFigmaUrlForPath: targeted
// regex scoped to the value block that follows the path key. Returns
// null when no pulledAt has been recorded yet (component was never
// successfully pulled or pre-dates the fingerprint feature).
function parsePulledAtForPath(src, p) {
  const escapedPath = p.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const re = new RegExp(
    '["\']' + escapedPath + '["\']\\s*:\\s*\\{[^}]*?(?:\\{[^}]*\\}[^}]*?)*?pulledAt\\s*:\\s*["\']([^"\']+)["\']',
  );
  const m = re.exec(src);
  return m ? m[1] : null;
}

// Top-level parser: reads adhd.config.ts at projectRoot, returns the data the
// installer needs. Throws if the file is missing; the consumer should run
// `/adhd:config` first.
function readConfig(projectRoot) {
  const cfgPath = path.join(projectRoot, 'adhd.config.ts');
  const src = fs.readFileSync(cfgPath, 'utf8');
  const components = parseComponents(src).map(rawPath => ({
    slug: slugFor(rawPath),
    rawPath,
    importPath: importPathFor(rawPath),
    figmaUrl: parseFigmaUrlForPath(src, rawPath),
    pulledAt: parsePulledAtForPath(src, rawPath),
  }));
  return {
    components,
    cssEntry: parseCssEntry(src),
  };
}

module.exports = { readConfig, parseComponents, parseCssEntry, parseFigmaUrlForPath, parsePulledAtForPath, slugFor, importPathFor };
