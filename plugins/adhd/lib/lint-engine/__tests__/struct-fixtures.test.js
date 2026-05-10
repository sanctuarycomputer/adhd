'use strict';
// Regression suite for STRUCT001–STRUCT010, built from real Figma fixtures.
// Each fixture is a serialized subtree pulled from the ADHD design-system file
// (PBCAkpPnvGXWrz6H7qfH3V), pages prefixed "avatar — STRUCT00N — …". Every
// fixture has exactly one rule-isolating mutation applied to a single node.
//
// To regenerate: see plugins/adhd/skills/push-component/SKILL.md (Phase 5) +
// the use_figma scripts used to build the fixture pages.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkStructure } = require('../structure-checker');

const FIXTURES = path.join(__dirname, '..', '__fixtures__', 'figma-real');
const FILE_KEY = 'PBCAkpPnvGXWrz6H7qfH3V';

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function run(root) {
  return checkStructure(root, { fileKey: FILE_KEY, namingConvention: 'kebab-case' });
}

const CASES = [
  { rule: 'STRUCT001', file: 'struct-001-no-autolayout.json' },
  { rule: 'STRUCT002', file: 'struct-002-raw-spacing.json' },
  { rule: 'STRUCT003', file: 'struct-003-raw-color.json' },
  { rule: 'STRUCT004', file: 'struct-004-raw-typography.json' },
  { rule: 'STRUCT005', file: 'struct-005-raw-effects.json' },
  { rule: 'STRUCT006', file: 'struct-006-detached-instance.json' },
  { rule: 'STRUCT007', file: 'struct-007-unwrapped-variants.json' },
  { rule: 'STRUCT008', file: 'struct-008-auto-named.json' },
  { rule: 'STRUCT009', file: 'struct-009-bad-name-casing.json' },
  { rule: 'STRUCT010', file: 'struct-010-no-variant-props.json' },
];

for (const c of CASES) {
  test(`${c.rule}: fires on ${c.file}`, () => {
    const violations = run(loadFixture(c.file));
    const hits = violations.filter(v => v.rule === c.rule);
    assert.ok(hits.length > 0, `expected ${c.rule}, got: ${JSON.stringify(violations.map(v => v.rule))}`);
  });

  test(`${c.rule}: no other STRUCT rules fire on ${c.file}`, () => {
    const violations = run(loadFixture(c.file));
    const others = violations.filter(v => v.rule !== c.rule).map(v => v.rule);
    assert.deepEqual(others, [], `unexpected rules fired alongside ${c.rule}: ${others.join(', ')}`);
  });
}
