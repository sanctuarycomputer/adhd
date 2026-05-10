'use strict';

function findBlockBounds(css, openRe) {
  const m = openRe.exec(css);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  return { open: m.index, contentStart: start, contentEnd: i, close: i + 1 };
}

function findThemeBlock(css) {
  // Match `@theme {` but not `@theme inline {`
  const re = /@theme(?!\s+inline)\s*\{/g;
  return findBlockBounds(css, re);
}

function findThemeInlineBlock(css) {
  return findBlockBounds(css, /@theme\s+inline\s*\{/);
}

function findRootLightBlock(css) {
  // The first :root {} that is NOT inside @media (prefers-color-scheme: dark)
  // and NOT a [data-theme="dark"] selector.
  // Strategy: blank dark wrappers and the data-theme selector, then find :root {}.
  let stripped = css.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[\s\S]*?\}\s*\}/g, ' '.repeat(50));
  stripped = stripped.replace(/:root\[data-theme=["']dark["']\]\s*\{[^}]*\}/g, ' '.repeat(50));
  return findBlockBounds(stripped, /:root\s*\{/);
}

function findRootDarkBlock(css) {
  // First look for :root[data-theme="dark"] {}
  const dataMatch = findBlockBounds(css, /:root\[data-theme=["']dark["']\]\s*\{/);
  if (dataMatch) return dataMatch;
  // Otherwise the :root {} inside @media (prefers-color-scheme: dark) {}
  const mediaRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  const m = mediaRe.exec(css);
  if (!m) return null;
  const mediaContentStart = m.index + m[0].length;
  const inner = findBlockBounds(css.slice(mediaContentStart), /:root\s*\{/);
  if (!inner) return null;
  // Translate offsets back to the full-css coordinate space
  return {
    open: inner.open + mediaContentStart,
    contentStart: inner.contentStart + mediaContentStart,
    contentEnd: inner.contentEnd + mediaContentStart,
    close: inner.close + mediaContentStart,
  };
}

function setEntryInBlock(css, blockBounds, cssVar, valueRaw) {
  const body = css.slice(blockBounds.contentStart, blockBounds.contentEnd);
  const re = new RegExp('(' + cssVar.replace(/[-]/g, '\\-') + '\\s*:\\s*)([^;]+)(;)', '');
  if (re.test(body)) {
    const newBody = body.replace(re, '$1' + valueRaw + '$3');
    return css.slice(0, blockBounds.contentStart) + newBody + css.slice(blockBounds.contentEnd);
  }
  // Add a new entry, indented
  const indent = '  ';
  const insert = `\n${indent}${cssVar}: ${valueRaw};`;
  return css.slice(0, blockBounds.contentEnd) + insert + '\n' + css.slice(blockBounds.contentEnd);
}

function ensureThemeBlock(css) {
  let bounds = findThemeBlock(css);
  if (bounds) return { css, bounds };
  // Insert at the top, after @import line if present
  const importMatch = /@import[^;]+;/m.exec(css);
  const insertAt = importMatch ? importMatch.index + importMatch[0].length : 0;
  const block = '\n\n@theme {\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findThemeBlock(newCss);
  return { css: newCss, bounds };
}

function ensureRootBlock(css) {
  let bounds = findRootLightBlock(css);
  if (bounds) return { css, bounds };
  const insertAt = css.length;
  const block = '\n\n:root {\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findRootLightBlock(newCss);
  return { css: newCss, bounds };
}

function ensureRootDarkBlock(css) {
  let bounds = findRootDarkBlock(css);
  if (bounds) return { css, bounds };
  // Add a @media (prefers-color-scheme: dark) :root {} block
  const insertAt = css.length;
  const block = '\n\n@media (prefers-color-scheme: dark) {\n  :root {\n  }\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findRootDarkBlock(newCss);
  return { css: newCss, bounds };
}

function ensureThemeInlineBlock(css) {
  let bounds = findThemeInlineBlock(css);
  if (bounds) return { css, bounds };
  const insertAt = css.length;
  const block = '\n\n@theme inline {\n}\n';
  const newCss = css.slice(0, insertAt) + block + css.slice(insertAt);
  bounds = findThemeInlineBlock(newCss);
  return { css: newCss, bounds };
}

function applyToCss(css, actions) {
  let cur = css;
  for (const a of actions) {
    const value = a.valueAlias ? `var(${a.valueAlias})` : a.value;
    if (a.kind === 'set-primitive') {
      const ensured = ensureThemeBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, value);
    } else if (a.kind === 'set-semantic' && a.mode === 'light') {
      const ensured = ensureRootBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, value);
    } else if (a.kind === 'set-semantic' && a.mode === 'dark') {
      const ensured = ensureRootDarkBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, value);
    } else if (a.kind === 'set-exposure') {
      const ensured = ensureThemeInlineBlock(cur);
      cur = setEntryInBlock(ensured.css, ensured.bounds, a.cssVar, `var(--${a.target})`);
    } else {
      throw new Error('Unknown action kind: ' + a.kind);
    }
  }
  return cur;
}

module.exports = { applyToCss };
