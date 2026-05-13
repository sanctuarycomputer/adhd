'use strict';

// Given a CSS variable name and a parsed theme, compute the action(s)
// needed to make that variable resolve to a target value in globals.css.
// Walks the alias chain until it reaches the literal source (the bottom
// of the chain), so writes land in the layer that actually controls
// rendering — never in the @theme inline exposure layer (which is just
// a re-export) and never on top of an existing alias relationship.
//
// Returns an array of actions in the shape consumed by
// `lib/design-system/code-writer.js`'s `applyToCss`:
//   { kind: 'set-primitive',  cssVar, value }
//   { kind: 'set-semantic',   cssVar, mode: 'light' | 'dark', value }
//
// Multiple actions can be returned when a mode-less write target
// resolves through alias chains to BOTH :root and :root[data-theme="dark"]
// — but only when explicitly requested via `opts.bothModes: true`. The
// safer default (single conservative write) covers the most common
// case where a designer picks "Take Figma's value" and Figma reports
// just one mode: we write to light, the designer keeps control of dark.

const VAR_REF_RE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/i;

function isAlias(value) {
  return typeof value === 'string' && VAR_REF_RE.test(value.trim());
}

function aliasTarget(value) {
  const m = VAR_REF_RE.exec(String(value).trim());
  return m ? m[1] : null;
}

// Find every layer where `cssVar` is defined. Order reflects which
// layer "wins" at runtime: primitives + exposure flow into the cascade
// first, then :root (light), then :root[data-theme="dark"] / @media
// dark. For write-target resolution, we walk in cascade order and stop
// at the first LITERAL value (not an alias).
function findDefinitionLayers(cssVar, theme) {
  const layers = [];
  if (theme.primitives && theme.primitives[cssVar] != null) {
    layers.push({ layer: 'primitive', value: theme.primitives[cssVar] });
  }
  if (theme.exposure && theme.exposure[cssVar] != null) {
    layers.push({ layer: 'exposure', value: theme.exposure[cssVar] });
  }
  if (theme.light && theme.light[cssVar] != null) {
    layers.push({ layer: 'light', value: theme.light[cssVar] });
  }
  if (theme.dark && theme.dark[cssVar] != null) {
    layers.push({ layer: 'dark', value: theme.dark[cssVar] });
  }
  return layers;
}

// Walk the alias chain starting from `cssVar`, returning the action(s)
// needed to put `value` at the literal source. Bounded recursion guards
// against pathological cycles.
function resolveWriteTarget(cssVar, value, theme, opts = {}) {
  return walk(cssVar, value, theme, opts, 0, new Set());
}

function walk(cssVar, value, theme, opts, depth, visited) {
  if (depth > 8 || visited.has(cssVar)) {
    // Cycle or runaway chain — fall back to writing as a primitive.
    return [{ kind: 'set-primitive', cssVar, value }];
  }
  visited.add(cssVar);

  const layers = findDefinitionLayers(cssVar, theme);

  // Variable not defined anywhere — it's missing from code. Land it in
  // @theme as a new primitive. This is the STRUCT015 "Add to globals.css"
  // case for variables Figma reports but code has never declared.
  if (layers.length === 0) {
    return [{ kind: 'set-primitive', cssVar, value }];
  }

  // Walk through the layers in cascade order. The first LITERAL we find
  // is the source of truth; the first ALIAS sends us deeper. Don't mix
  // — if primitive/exposure layers are aliases AND :root layers carry
  // literals, the literals win at runtime so we write there.
  const literalLayers = layers.filter(l => !isAlias(l.value));
  if (literalLayers.length === 0) {
    // Every defined layer is an alias — follow the first one's target.
    // (Same target across layers is the common case; if they diverge
    // we just take primitive > exposure > light > dark order.)
    const next = aliasTarget(layers[0].value);
    if (!next) {
      // Defensive — isAlias was true but target couldn't be parsed.
      return [{ kind: 'set-primitive', cssVar, value }];
    }
    return walk(next, value, theme, opts, depth + 1, visited);
  }

  // Pick a write strategy from the literal layers:
  //  - primitive layer literal → set-primitive at this cssVar
  //  - exposure-only literal (unusual) → treat as primitive write
  //  - light-only literal → set-semantic light
  //  - dark-only literal → set-semantic dark
  //  - BOTH light + dark → conservative default: write to light only;
  //    pass opts.bothModes to write to both.
  const has = (layer) => literalLayers.some(l => l.layer === layer);
  if (has('primitive') || has('exposure')) {
    return [{ kind: 'set-primitive', cssVar, value }];
  }
  const actions = [];
  if (has('light')) actions.push({ kind: 'set-semantic', cssVar, mode: 'light', value });
  if (has('dark') && (opts.bothModes || !has('light'))) {
    actions.push({ kind: 'set-semantic', cssVar, mode: 'dark', value });
  }
  return actions;
}

module.exports = { resolveWriteTarget, findDefinitionLayers, isAlias, aliasTarget };
