'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { visualSignature } = require('../visual-signature');

const FRAME_A = {
  type: 'FRAME', name: 'A', x: 0, y: 0, width: 40, height: 40,
  layoutMode: 'VERTICAL', paddingTop: 8, paddingBottom: 8, paddingLeft: 8, paddingRight: 8,
  fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
  children: [{ type: 'TEXT', characters: 'AB', fontSize: 12, fills: [] }],
};

test('identical frames produce identical signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.name = 'B'; // different name should not affect signature
  FRAME_B.x = 999;    // different position should not affect signature
  assert.equal(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('different dimensions produce different signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.width = 50;
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('different fill colors produce different signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.fills[0].color.r = 0; // red → black
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('different child text content produces different signatures', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.children[0].characters = 'XY';
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('layer IDs and names do not affect signature', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.id = 'different-id';
  FRAME_B.name = 'different-name';
  FRAME_B.children[0].id = 'cid';
  assert.equal(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('layout mode and padding affect signature', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.layoutMode = 'HORIZONTAL';
  assert.notEqual(visualSignature(FRAME_A), visualSignature(FRAME_B));
});

test('child order matters (shape change)', () => {
  const FRAME_B = JSON.parse(JSON.stringify(FRAME_A));
  FRAME_B.children = [
    { type: 'TEXT', characters: 'A', fontSize: 10, fills: [] },
    { type: 'TEXT', characters: 'B', fontSize: 10, fills: [] },
  ];
  const FRAME_C = JSON.parse(JSON.stringify(FRAME_B));
  FRAME_C.children.reverse();
  assert.notEqual(visualSignature(FRAME_B), visualSignature(FRAME_C));
});
