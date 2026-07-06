import { expect, test } from "vitest";
import { stableStringify, fnv1a64 } from "../src/core/hash";

test("stableStringify sorts keys at every depth", () => {
  expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
});
test("fnv1a64 is deterministic and 16 hex chars", () => {
  expect(fnv1a64("adhd")).toMatch(/^[0-9a-f]{16}$/);
  expect(fnv1a64("adhd")).toBe(fnv1a64("adhd"));
  expect(fnv1a64("adhd")).not.toBe(fnv1a64("adhd2"));
});
