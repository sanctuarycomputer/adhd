import { expect, test } from "vitest";
import { scanOffSystem } from "../src/rules/off-system";
import type { Snapshot } from "../src/core/tokens";

const code: Snapshot = { side: "code", styles: [], tokens: [
  { path: "color/zinc/800", collection: "primitives", domain: "color", values: { default: "#27272a" } },
  { path: "spacing/2", collection: "primitives", domain: "spacing", values: { default: "8px" } },
]};

test("flags arbitrary classes and maps to the exact token", () => {
  const f = scanOffSystem([{ path: "app/x.tsx", content: `<div className="bg-[#27272a] p-2" />` }], code);
  expect(f).toHaveLength(1);
  expect(f[0]).toMatchObject({ kind: "arbitrary-class", nearestToken: { path: "color/zinc/800", exact: true } });
});

test("skips lines marked adhd:off-system", () => {
  const f = scanOffSystem([{ path: "a.tsx", content: `x // adhd:off-system — legacy\nconst c = "bg-[#123456]";` }], code);
  expect(f.map((x) => x.line)).toEqual([2]);
});

test("dimension arbitrary value maps to spacing token", () => {
  const f = scanOffSystem([{ path: "a.tsx", content: `"p-[8px]"` }], code);
  expect(f[0]?.nearestToken).toMatchObject({ path: "spacing/2", exact: true });
});
