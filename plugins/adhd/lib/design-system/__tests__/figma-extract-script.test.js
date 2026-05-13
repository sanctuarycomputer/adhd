'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXTRACT_SCRIPT, EXTRACT_CHUNK_SCRIPT, CHUNK_SIZE, assembleExtract } =
  require('../figma-extract-script');

test('EXTRACT_SCRIPT is a non-empty string with the local-vars API call', () => {
  assert.equal(typeof EXTRACT_SCRIPT, 'string');
  assert.ok(EXTRACT_SCRIPT.includes('getLocalVariableCollectionsAsync'));
  assert.ok(EXTRACT_SCRIPT.includes('return { collections: colOut'));
});

test('EXTRACT_CHUNK_SCRIPT exposes both substitution placeholders', () => {
  assert.equal(typeof EXTRACT_CHUNK_SCRIPT, 'string');
  assert.ok(EXTRACT_CHUNK_SCRIPT.includes('__INCLUDE_META__'));
  assert.ok(EXTRACT_CHUNK_SCRIPT.includes('__VAR_INDEX__'));
});

test('CHUNK_SIZE is a sane default', () => {
  assert.equal(typeof CHUNK_SIZE, 'number');
  assert.ok(CHUNK_SIZE >= 10 && CHUNK_SIZE <= 100);
});

test('assembleExtract merges manifest + slices into single-shot shape', () => {
  const manifest = {
    kind: 'manifest',
    collections: [
      { id: 'col:1', name: 'color',
        modes: [{ id: 'm:dark', name: 'dark' }, { id: 'm:light', name: 'light' }],
        variableIds: ['v:1', 'v:2', 'v:3'], variableCount: 3 },
      { id: 'col:2', name: 'radius',
        modes: [{ id: 'm:default', name: 'Mode 1' }],
        variableIds: ['v:4'], variableCount: 1 },
    ],
    effectStyles: [{ id: 's:1', name: 'shadow-sm', effects: [] }],
    textStyles: [],
  };
  const colorSlice1 = {
    kind: 'slice', collectionId: 'col:1', collectionName: 'color',
    modes: manifest.collections[0].modes, from: 0, to: 2, total: 3,
    variables: [
      { id: 'v:1', name: 'gold/100', resolvedType: 'COLOR', scopes: [],
        valuesByMode: { dark: { kind: 'color', r: 0, g: 0, b: 0, a: 1 }, light: { kind: 'color', r: 1, g: 1, b: 1, a: 1 } } },
      { id: 'v:2', name: 'gold/200', resolvedType: 'COLOR', scopes: [],
        valuesByMode: { dark: { kind: 'color', r: 0.5, g: 0.5, b: 0.5, a: 1 }, light: { kind: 'color', r: 0.5, g: 0.5, b: 0.5, a: 1 } } },
    ],
  };
  const colorSlice2 = {
    kind: 'slice', collectionId: 'col:1', collectionName: 'color',
    modes: manifest.collections[0].modes, from: 2, to: 3, total: 3,
    variables: [
      { id: 'v:3', name: 'gold/300', resolvedType: 'COLOR', scopes: [],
        valuesByMode: { dark: { kind: 'color', r: 0.7, g: 0.7, b: 0.7, a: 1 }, light: { kind: 'color', r: 0.7, g: 0.7, b: 0.7, a: 1 } } },
    ],
  };
  const radiusSlice = {
    kind: 'slice', collectionId: 'col:2', collectionName: 'radius',
    modes: manifest.collections[1].modes, from: 0, to: 1, total: 1,
    variables: [
      { id: 'v:4', name: 'sm', resolvedType: 'FLOAT', scopes: ['CORNER_RADIUS'],
        valuesByMode: { 'Mode 1': { kind: 'literal', value: 4 } } },
    ],
  };

  // Pass slices out of order to confirm the assembler sorts them.
  const extract = assembleExtract([radiusSlice, colorSlice2, manifest, colorSlice1]);

  assert.equal(extract.collections.length, 2);
  assert.equal(extract.collections[0].name, 'color');
  assert.equal(extract.collections[0].variables.length, 3);
  assert.equal(extract.collections[0].variables[0].name, 'gold/100');
  assert.equal(extract.collections[0].variables[1].name, 'gold/200');
  assert.equal(extract.collections[0].variables[2].name, 'gold/300');
  assert.equal(extract.collections[1].name, 'radius');
  assert.equal(extract.collections[1].variables[0].name, 'sm');
  assert.equal(extract.effectStyles.length, 1);
  assert.deepEqual(extract.textStyles, []);
});

test('assembleExtract throws when no manifest is supplied', () => {
  assert.throws(
    () => assembleExtract([{ kind: 'slice', collectionId: 'col:x', variables: [], from: 0, to: 0 }]),
    /missing manifest/,
  );
});

test('assembleExtract throws when slice variable count does not match manifest', () => {
  const manifest = {
    kind: 'manifest',
    collections: [{ id: 'col:1', name: 'color', modes: [], variableIds: ['v:1', 'v:2'], variableCount: 2 }],
  };
  const slice = {
    kind: 'slice', collectionId: 'col:1', collectionName: 'color',
    modes: [], from: 0, to: 1, total: 2,
    variables: [{ id: 'v:1', name: 'gold/100', resolvedType: 'COLOR', scopes: [], valuesByMode: {} }],
  };
  assert.throws(
    () => assembleExtract([manifest, slice]),
    /expected 2 variables, got 1/,
  );
});
