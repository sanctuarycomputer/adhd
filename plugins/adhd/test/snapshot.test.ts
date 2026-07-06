import { expect, test } from "vitest";
import { domainOf } from "../src/core/tokens";
import { canonicalize, contentHash } from "../src/core/snapshot";
import type { Snapshot } from "../src/core/tokens";

const snap = (tokens: any[]): Snapshot => ({ side: "code", tokens, styles: [] });

test("domainOf maps first segment", () => {
  expect(domainOf("color/zinc/800")).toBe("color");
  expect(domainOf("text/lg/line-height")).toBe("typography");
  expect(domainOf("weird/thing")).toBe("other");
});

test("contentHash is order-insensitive (canonicalized)", () => {
  const a = snap([
    { path: "color/a", collection: "primitives", domain: "color", values: { default: "#111111" } },
    { path: "color/b", collection: "primitives", domain: "color", values: { default: "#222222" } },
  ]);
  const b = snap([a.tokens[1]!, a.tokens[0]!]);
  expect(contentHash(a)).toBe(contentHash(b));
});

test("contentHash changes when a value changes", () => {
  const a = snap([{ path: "color/a", collection: "primitives", domain: "color", values: { default: "#111111" } }]);
  const b = snap([{ path: "color/a", collection: "primitives", domain: "color", values: { default: "#111112" } }]);
  expect(contentHash(a)).not.toBe(contentHash(b));
});
