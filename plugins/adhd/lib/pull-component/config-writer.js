'use strict';

// Regex-based reader/writer for `adhd.config.ts`. The file shape we parse:
//
//   const config = {
//     figma: { url: "..." },
//     components: {
//       "app/components/avatar/index.tsx": {
//         figma: { url: "..." },
//       },
//     },
//   };
//
//   export default config;
//
// The codebase is zero-deps and parses TS-flavored sources with regex
// elsewhere (see lib/push-component/parse-component.js). Brace-counting
// is used to find the END of nested blocks, since regex alone can't
// match balanced braces.

const CONFIG_OPEN_RE = /\bconst\s+config\s*=\s*\{/;
const COMPONENTS_OPEN_RE = /\bcomponents\s*:\s*\{/;

// Walks `source` from `openBraceIdx` (which MUST point at a `{`),
// returns the index of the matching `}` (inclusive). Throws if
// unmatched. Skips over braces inside double-quoted strings and
// `//` / `/* */` comments to be safe against tokens like `"{"`.
function findMatchingBrace(source, openBraceIdx) {
  if (source[openBraceIdx] !== '{') {
    throw new Error('findMatchingBrace: position ' + openBraceIdx + ' is not `{`');
  }
  let depth = 0;
  let i = openBraceIdx;
  while (i < source.length) {
    const c = source[i];
    // String literal — skip to closing quote, honoring backslash escapes.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 2;
        else i++;
      }
      i++;
      continue;
    }
    // Line comment
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  throw new Error('findMatchingBrace: unmatched `{` starting at ' + openBraceIdx);
}

// Locates the top-level config object's brace range: { start, end }
// where start = index of `{` and end = index of matching `}`.
function findConfigObjectRange(source) {
  const m = CONFIG_OPEN_RE.exec(source);
  if (!m) return null;
  const openIdx = source.indexOf('{', m.index);
  if (openIdx === -1) return null;
  const closeIdx = findMatchingBrace(source, openIdx);
  return { start: openIdx, end: closeIdx };
}

// Locates the `components:` field's brace range INSIDE the given config
// range, or null if not present.
function findComponentsRange(source, configRange) {
  // Scan only the slice inside the config object.
  const slice = source.slice(configRange.start + 1, configRange.end);
  const m = COMPONENTS_OPEN_RE.exec(slice);
  if (!m) return null;
  const absoluteMatchIdx = configRange.start + 1 + m.index;
  const openIdx = source.indexOf('{', absoluteMatchIdx);
  if (openIdx === -1 || openIdx >= configRange.end) return null;
  const closeIdx = findMatchingBrace(source, openIdx);
  return { start: openIdx, end: closeIdx };
}

// Walks the top-level keys inside a `{ ... }` object range. Yields each
// entry's brace-balanced span. Used for iterating `components: { ... }`
// entries one path at a time.
//
// Yields objects of shape:
//   { keyStart, keyEnd, key, valueStart, valueEnd }
// where:
//   - `key` is the (unquoted) property name
//   - keyStart..keyEnd is the range of the key including its quotes (if quoted)
//   - valueStart..valueEnd is the range of the value (for an object value,
//     these are the `{` and `}` indexes inclusive)
function* iterateObjectEntries(source, objectRange) {
  // Skip the opening `{`.
  let i = objectRange.start + 1;
  const end = objectRange.end;
  while (i < end) {
    // Skip whitespace, commas, comments.
    while (i < end) {
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') {
        i++;
        continue;
      }
      if (c === '/' && source[i + 1] === '/') {
        while (i < end && source[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < end - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      break;
    }
    if (i >= end) return;

    // Parse a key. Either "quoted string" or bare identifier.
    let keyStart = i;
    let keyEnd;
    let key;
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      i++;
      const keyTextStart = i;
      while (i < end && source[i] !== quote) {
        if (source[i] === '\\') i += 2;
        else i++;
      }
      key = source.slice(keyTextStart, i);
      i++; // consume closing quote
      keyEnd = i;
    } else {
      const idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i, end));
      if (!idMatch) return; // unparseable — bail
      key = idMatch[0];
      i += idMatch[0].length;
      keyEnd = i;
    }

    // Skip whitespace + `:`.
    while (i < end && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i++;
    if (source[i] !== ':') return; // malformed
    i++;
    while (i < end && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i++;

    // Parse value. For our purposes we only need to handle:
    //   - object literal `{...}` (the only thing we care about for components mapping)
    //   - string literal "..." or '...'
    //   - any other primitive — skip until next `,` or end of object.
    let valueStart = i;
    let valueEnd;
    if (source[i] === '{') {
      valueEnd = findMatchingBrace(source, i);
      i = valueEnd + 1;
    } else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      i++;
      while (i < end && source[i] !== quote) {
        if (source[i] === '\\') i += 2;
        else i++;
      }
      i++; // consume closing quote
      valueEnd = i - 1;
    } else {
      // Skip arbitrary tokens until a comma or closing brace at depth 0.
      let depth = 0;
      while (i < end) {
        const c = source[i];
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') {
          if (depth === 0) break;
          depth--;
        } else if (c === ',' && depth === 0) {
          break;
        } else if (c === '"' || c === "'" || c === '`') {
          const quote = c;
          i++;
          while (i < end && source[i] !== quote) {
            if (source[i] === '\\') i += 2;
            else i++;
          }
        }
        i++;
      }
      valueEnd = i - 1;
    }

    yield { keyStart, keyEnd, key, valueStart, valueEnd };
  }
}

// Find the `figma: { url: "X" }` inside a given entry value range (which is
// the `{` and `}` indexes of the entry's object literal). Returns the
// span of the quoted url STRING LITERAL (including the surrounding
// quotes) and the url text itself, or null.
function findFigmaUrlInEntry(source, entryValueRange) {
  // Walk the entry's top-level entries looking for `figma:`.
  for (const child of iterateObjectEntries(source, entryValueRange)) {
    if (child.key !== 'figma') continue;
    // child.valueStart..valueEnd is `{...}` of figma. Look for url inside.
    if (source[child.valueStart] !== '{') return null;
    const figmaRange = { start: child.valueStart, end: child.valueEnd };
    for (const sub of iterateObjectEntries(source, figmaRange)) {
      if (sub.key !== 'url') continue;
      // For a string value, iterateObjectEntries sets valueStart/valueEnd
      // to the indexes of the opening and closing quote characters.
      const openQuote = sub.valueStart;
      const closeQuote = sub.valueEnd;
      if (source[openQuote] !== '"' && source[openQuote] !== "'") return null;
      const urlText = source.slice(openQuote + 1, closeQuote);
      return { quoteStart: openQuote, quoteEnd: closeQuote, urlText };
    }
    return null;
  }
  return null;
}

function readComponentMapping(source, relPath) {
  const cfg = findConfigObjectRange(source);
  if (!cfg) return null;
  const comps = findComponentsRange(source, cfg);
  if (!comps) return null;
  for (const entry of iterateObjectEntries(source, comps)) {
    if (entry.key !== relPath) continue;
    if (source[entry.valueStart] !== '{') return null;
    const urlInfo = findFigmaUrlInEntry(source, { start: entry.valueStart, end: entry.valueEnd });
    if (!urlInfo) return null;
    return { figma: { url: urlInfo.urlText } };
  }
  return null;
}

function reverseLookupPath(source, figmaUrl) {
  const cfg = findConfigObjectRange(source);
  if (!cfg) return null;
  const comps = findComponentsRange(source, cfg);
  if (!comps) return null;
  for (const entry of iterateObjectEntries(source, comps)) {
    if (source[entry.valueStart] !== '{') continue;
    const urlInfo = findFigmaUrlInEntry(source, { start: entry.valueStart, end: entry.valueEnd });
    if (!urlInfo) continue;
    if (urlInfo.urlText === figmaUrl) return entry.key;
  }
  return null;
}

// Find the indent (whitespace prefix) of the line containing `pos`.
function lineIndent(source, pos) {
  let lineStart = pos;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  let i = lineStart;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
  return source.slice(lineStart, i);
}

function addComponentMapping(source, relPath, figmaUrl) {
  // Idempotency: if existing entry already matches, return source unchanged.
  const existing = readComponentMapping(source, relPath);
  if (existing && existing.figma.url === figmaUrl) return source;

  const cfg = findConfigObjectRange(source);
  if (!cfg) throw new Error('addComponentMapping: could not find `const config = { ... }`');

  const comps = findComponentsRange(source, cfg);

  // Case 1: existing components.<relPath> with a different URL → replace url inline.
  if (comps) {
    for (const entry of iterateObjectEntries(source, comps)) {
      if (entry.key !== relPath) continue;
      if (source[entry.valueStart] !== '{') break;
      const urlInfo = findFigmaUrlInEntry(source, { start: entry.valueStart, end: entry.valueEnd });
      if (!urlInfo) break;
      // Replace the contents BETWEEN the quotes (preserving the quote chars).
      return (
        source.slice(0, urlInfo.quoteStart + 1) +
        figmaUrl +
        source.slice(urlInfo.quoteEnd)
      );
    }
    // Case 2: components exists but not this path → append new entry before
    // the closing brace. Use indentation matched from the existing first
    // entry; fall back to "    " (4-space indent inside `components:`).
    const firstEntry = iterateObjectEntries(source, comps).next().value;
    let entryIndent = '    ';
    let innerIndent = '      ';
    if (firstEntry) {
      entryIndent = lineIndent(source, firstEntry.keyStart);
      innerIndent = entryIndent + '  ';
    }
    const insert = `${entryIndent}"${relPath}": {\n${innerIndent}figma: { url: "${figmaUrl}" },\n${entryIndent}},\n`;
    return source.slice(0, comps.end) + insert + source.slice(comps.end);
  }

  // Case 3: no components field → insert one before the closing brace of
  // `const config`. Use indent matched from existing top-level config props.
  const firstCfgEntry = iterateObjectEntries(source, cfg).next().value;
  let baseIndent = '  ';
  if (firstCfgEntry) {
    baseIndent = lineIndent(source, firstCfgEntry.keyStart);
  }
  const innerIndent = baseIndent + '  ';
  const innerInnerIndent = innerIndent + '  ';
  const insert =
    `${baseIndent}components: {\n` +
    `${innerIndent}"${relPath}": {\n` +
    `${innerInnerIndent}figma: { url: "${figmaUrl}" },\n` +
    `${innerIndent}},\n` +
    `${baseIndent}},\n`;
  return source.slice(0, cfg.end) + insert + source.slice(cfg.end);
}

module.exports = {
  readComponentMapping,
  reverseLookupPath,
  addComponentMapping,
  // Lower-level parsing primitives — used by instance-resolver to
  // walk the components map looking for a Figma node-id match.
  findConfigObjectRange,
  findComponentsRange,
  iterateObjectEntries,
  findFigmaUrlInEntry,
};
