import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { checkStructure } from "../src/rules/struct";

const load = (n: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/figma-real/${n}.json`, import.meta.url), "utf8"));

const rulesHit = (n: string) => [
  ...new Set(checkStructure(load(n), { fileKey: "TESTKEY", naming: "kebab-case" }).map((v) => v.rule)),
];

// EXPECTED table transcribed from plugins/adhd/lib/lint-engine/__tests__/struct-fixtures.test.js
// (same fixture ⇒ same rule set — verified against the v1 checker directly).
// Each struct-NNN fixture has exactly one rule-isolating mutation applied to a
// single node, so exactly that rule (and no other STRUCT rule) fires.

test("00-clean is clean", () => expect(rulesHit("00-clean")).toEqual([]));

test("struct-001 fires only STRUCT001", () =>
  expect(rulesHit("struct-001-no-autolayout")).toEqual(["STRUCT001"]));

test("struct-002 fires only STRUCT002", () =>
  expect(rulesHit("struct-002-raw-spacing")).toEqual(["STRUCT002"]));

test("struct-003 fires only STRUCT003", () =>
  expect(rulesHit("struct-003-raw-color")).toEqual(["STRUCT003"]));

test("struct-004 fires only STRUCT004", () =>
  expect(rulesHit("struct-004-raw-typography")).toEqual(["STRUCT004"]));

test("struct-005 fires only STRUCT005", () =>
  expect(rulesHit("struct-005-raw-effects")).toEqual(["STRUCT005"]));

test("struct-006 fires only STRUCT006", () =>
  expect(rulesHit("struct-006-detached-instance")).toEqual(["STRUCT006"]));

test("struct-007 fires only STRUCT007", () =>
  expect(rulesHit("struct-007-unwrapped-variants")).toEqual(["STRUCT007"]));

test("struct-008 fires only STRUCT008", () =>
  expect(rulesHit("struct-008-auto-named")).toEqual(["STRUCT008"]));

test("struct-009 fires only STRUCT009", () =>
  expect(rulesHit("struct-009-bad-name-casing")).toEqual(["STRUCT009"]));

test("struct-010 fires only STRUCT010", () =>
  expect(rulesHit("struct-010-no-variant-props")).toEqual(["STRUCT010"]));
