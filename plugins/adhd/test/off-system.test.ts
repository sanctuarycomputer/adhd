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

test("flags inline hex inside a string literal with no matching token", () => {
  const f = scanOffSystem([{ path: "a.tsx", content: `const c = "#123456";` }], code);
  expect(f).toHaveLength(1);
  expect(f[0]).toMatchObject({ kind: "inline-hex", snippet: "#123456" });
  expect(f[0]?.nearestToken).toBeUndefined();
});

test("mixed line yields one arbitrary-class finding and one inline-hex finding", () => {
  const twoTokens: Snapshot = {
    side: "code",
    styles: [],
    tokens: [
      { path: "color/zinc/800", collection: "primitives", domain: "color", values: { default: "#27272a" } },
      { path: "color/zinc/700", collection: "primitives", domain: "color", values: { default: "#3f3f46" } },
    ],
  };
  const f = scanOffSystem(
    [{ path: "app/x.tsx", content: `<div className="bg-[#27272a]" style={{ color: "#3f3f46" }} />` }],
    twoTokens
  );
  expect(f).toHaveLength(2);
  expect(f).toContainEqual(
    expect.objectContaining({
      kind: "arbitrary-class",
      snippet: "bg-[#27272a]",
      nearestToken: { path: "color/zinc/800", exact: true },
    })
  );
  expect(f).toContainEqual(
    expect.objectContaining({
      kind: "inline-hex",
      snippet: "#3f3f46",
      nearestToken: { path: "color/zinc/700", exact: true },
    })
  );
});

test("near-match hex within 0.02 but outside 0.004 is flagged as non-exact", () => {
  // token is #27272a (39,39,42); #2a2a2d is +3/255 (~0.0118) per channel —
  // past the 0.004 exact epsilon but within the 0.02 near epsilon.
  const f = scanOffSystem([{ path: "a.tsx", content: `"bg-[#2a2a2d]"` }], code);
  expect(f).toHaveLength(1);
  expect(f[0]?.nearestToken).toMatchObject({ path: "color/zinc/800", exact: false });
});

test("hex outside any string literal is not flagged", () => {
  const f = scanOffSystem([{ path: "a.tsx", content: `// see #ABCDEF for details` }], code);
  expect(f).toHaveLength(0);
});
