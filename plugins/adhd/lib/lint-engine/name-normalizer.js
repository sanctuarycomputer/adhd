'use strict';

const KNOWN_COLLECTIONS = new Set(['primitives', 'semantic']);

function figmaToCssVar(figmaPath) {
  if (typeof figmaPath !== 'string') {
    throw new TypeError('figmaToCssVar: expected string, got ' + typeof figmaPath);
  }
  if (figmaPath === '') {
    throw new Error('figmaToCssVar: empty path');
  }
  const segments = figmaPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('figmaToCssVar: no segments in "' + figmaPath + '"');
  }

  // Drop leading collection prefix if present
  if (KNOWN_COLLECTIONS.has(segments[0].toLowerCase())) {
    segments.shift();
  }

  return '--' + segments.join('-').toLowerCase();
}

function cssVarToFigma(cssVarName, collections) {
  if (typeof cssVarName !== 'string' || !cssVarName.startsWith('--')) {
    throw new TypeError('cssVarToFigma: expected --css-var-name, got ' + cssVarName);
  }
  const path = cssVarName.slice(2).split('-').join('/');

  // Decide which collection: semantic if path has a known semantic prefix, else primitives
  const semanticPrefixes = collections?.semantic ?? [];
  for (const prefix of semanticPrefixes) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return 'Semantic/' + path;
    }
  }
  return 'Primitives/' + path;
}

module.exports = { figmaToCssVar, cssVarToFigma };
