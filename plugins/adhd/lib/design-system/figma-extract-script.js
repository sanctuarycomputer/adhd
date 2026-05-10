'use strict';

/**
 * JS strings injected into use_figma plus a small assembler helper.
 *
 * Two extractor variants are exported:
 *
 *   EXTRACT_SCRIPT — original single-shot extractor: returns the full design
 *     system in one payload. Suitable for small files (≲60 variables).
 *
 *   EXTRACT_CHUNK_SCRIPT — paginated extractor for moderately/large design
 *     systems. The MCP `use_figma` response is truncated at ~20–30 KB; with a
 *     full Tailwind v4 color system (≈300 colors × 2 modes) the single-shot
 *     extractor exceeds that limit and the JSON is cut off mid-record.
 *
 * `EXTRACT_CHUNK_SCRIPT` accepts two substitution placeholders the orchestrator
 * must replace before passing the script as `code` to `use_figma`:
 *
 *   __INCLUDE_META__ — replace with the literal `true` or `false`. When true,
 *                      the response also includes the file's effect and text
 *                      styles. Pass `true` once (typically the manifest call)
 *                      and `false` for every subsequent slice call.
 *
 *   __VAR_INDEX__    — replace with `null` (manifest mode) or a JSON object
 *                      `{collectionId: '<id>', from: <int>, to: <int>}` (slice
 *                      mode). In slice mode the script returns one collection's
 *                      variables in the [from, to) range.
 *
 * Recommended orchestration:
 *   1. Call once with `__INCLUDE_META__ = true`, `__VAR_INDEX__ = null` →
 *      manifest payload with each collection's id/name/modes/variableIds plus
 *      meta (effect/text styles).
 *   2. For each collection in the manifest, call repeatedly with
 *      `__VAR_INDEX__ = {collectionId, from, to: from + CHUNK_SIZE}` until all
 *      `variableIds` are consumed.
 *   3. Persist each response to disk (e.g. `/tmp/adhd-{push,pull}/chunks/`),
 *      then run the `assemble-figma-extract` CLI command from `cli.js` (or
 *      programmatically via `assembleExtract`) to merge the chunks into the
 *      final `{collections, effectStyles, textStyles}` shape that
 *      `parseFigmaDesignSystem` consumes.
 */
const EXTRACT_SCRIPT = `
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const colOut = [];
for (const c of collections) {
  const modes = c.modes.map(m => ({ id: m.modeId, name: m.name }));
  const vars = [];
  for (const vid of c.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (!v) continue;
    const valuesByMode = {};
    for (const m of c.modes) {
      const raw = v.valuesByMode[m.modeId];
      if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
        const target = await figma.variables.getVariableByIdAsync(raw.id);
        valuesByMode[m.name] = { kind: 'alias', targetName: target ? target.name : null, targetId: raw.id };
      } else if (raw && typeof raw === 'object' && 'r' in raw) {
        valuesByMode[m.name] = { kind: 'color', r: raw.r, g: raw.g, b: raw.b, a: 'a' in raw ? raw.a : 1 };
      } else {
        valuesByMode[m.name] = { kind: 'literal', value: raw };
      }
    }
    vars.push({
      id: v.id, name: v.name, resolvedType: v.resolvedType,
      scopes: v.scopes, valuesByMode,
    });
  }
  colOut.push({ id: c.id, name: c.name, modes, variables: vars });
}

const effectStyles = (await figma.getLocalEffectStylesAsync()).map(s => ({
  id: s.id, name: s.name, effects: s.effects,
}));
const textStyles = (await figma.getLocalTextStylesAsync()).map(s => ({
  id: s.id, name: s.name,
  fontName: s.fontName, fontSize: s.fontSize,
  lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
}));

return { collections: colOut, effectStyles, textStyles };
`;

const EXTRACT_CHUNK_SCRIPT = `
const INCLUDE_META = __INCLUDE_META__;
const VAR_INDEX = __VAR_INDEX__;
const collections = await figma.variables.getLocalVariableCollectionsAsync();

if (!VAR_INDEX) {
  const manifest = collections.map(c => ({
    id: c.id, name: c.name,
    modes: c.modes.map(m => ({ id: m.modeId, name: m.name })),
    variableIds: c.variableIds.slice(),
    variableCount: c.variableIds.length,
  }));
  const out = { kind: 'manifest', collections: manifest };
  if (INCLUDE_META) {
    out.effectStyles = (await figma.getLocalEffectStylesAsync()).map(s => ({
      id: s.id, name: s.name, effects: s.effects,
    }));
    out.textStyles = (await figma.getLocalTextStylesAsync()).map(s => ({
      id: s.id, name: s.name, fontName: s.fontName, fontSize: s.fontSize,
      lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
    }));
  }
  return out;
}

const target = collections.find(c => c.id === VAR_INDEX.collectionId);
if (!target) return { kind: 'slice', error: 'collection-not-found', collectionId: VAR_INDEX.collectionId };
const from = VAR_INDEX.from | 0;
const to = Math.min(VAR_INDEX.to | 0, target.variableIds.length);
const vars = [];
for (let i = from; i < to; i++) {
  const v = await figma.variables.getVariableByIdAsync(target.variableIds[i]);
  if (!v) continue;
  const valuesByMode = {};
  for (const m of target.modes) {
    const raw = v.valuesByMode[m.modeId];
    if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
      const t = await figma.variables.getVariableByIdAsync(raw.id);
      valuesByMode[m.name] = { kind: 'alias', targetName: t ? t.name : null, targetId: raw.id };
    } else if (raw && typeof raw === 'object' && 'r' in raw) {
      valuesByMode[m.name] = { kind: 'color', r: raw.r, g: raw.g, b: raw.b, a: 'a' in raw ? raw.a : 1 };
    } else {
      valuesByMode[m.name] = { kind: 'literal', value: raw };
    }
  }
  vars.push({
    id: v.id, name: v.name, resolvedType: v.resolvedType,
    scopes: v.scopes, valuesByMode,
  });
}
return {
  kind: 'slice',
  collectionId: target.id,
  collectionName: target.name,
  modes: target.modes.map(m => ({id: m.modeId, name: m.name})),
  from, to,
  total: target.variableIds.length,
  variables: vars,
};
`;

/**
 * Default slice size. Conservatively chosen so that even multi-mode COLOR
 * collections (the heaviest per-variable payload) fit under the use_figma
 * response truncation limit observed in practice (~20–30 KB).
 */
const CHUNK_SIZE = 30;

/**
 * Assemble a final extract from an array of paginated responses produced by
 * EXTRACT_CHUNK_SCRIPT. Accepts the manifest call's payload plus zero-or-more
 * slice payloads (order does not matter). Returns the same shape as the
 * single-shot EXTRACT_SCRIPT: {collections, effectStyles, textStyles}.
 *
 * Throws if a manifest payload is missing or if any collection ends up with
 * a different number of variables than its manifest's variableCount.
 */
function assembleExtract(payloads) {
  let manifest = null;
  const sliceByColId = new Map();
  for (const p of payloads) {
    if (p && p.kind === 'manifest') {
      manifest = p;
    } else if (p && p.kind === 'slice') {
      if (!sliceByColId.has(p.collectionId)) sliceByColId.set(p.collectionId, []);
      sliceByColId.get(p.collectionId).push(p);
    }
  }
  if (!manifest) throw new Error('assembleExtract: missing manifest payload');

  const collections = [];
  for (const colDef of manifest.collections) {
    const slices = (sliceByColId.get(colDef.id) || []).slice().sort((a, b) => a.from - b.from);
    const variables = [];
    for (const s of slices) variables.push(...s.variables);
    if (variables.length !== colDef.variableCount) {
      throw new Error(
        `assembleExtract: collection ${colDef.name} expected ${colDef.variableCount} variables, got ${variables.length}`,
      );
    }
    collections.push({
      id: colDef.id,
      name: colDef.name,
      modes: colDef.modes,
      variables,
    });
  }

  return {
    collections,
    effectStyles: manifest.effectStyles || [],
    textStyles: manifest.textStyles || [],
  };
}

module.exports = { EXTRACT_SCRIPT, EXTRACT_CHUNK_SCRIPT, CHUNK_SIZE, assembleExtract };
