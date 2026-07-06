import { expect, test } from "vitest";
import { parseColor, normalizeColor, colorsEqual } from "../src/core/color";

test("parses hex, rgb(), oklch(), named", () => {
  expect(parseColor("#27272a")).toEqual({ r: 0x27 / 255, g: 0x27 / 255, b: 0x2a / 255, a: 1 });
  expect(parseColor("rgb(39 39 42)")).toMatchObject({ a: 1 });
  expect(parseColor("oklch(0.21 0.006 285.885)")).not.toBeNull();
  expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  expect(parseColor("not-a-color")).toBeNull(); // never throws
  expect(parseColor("oklch(from var(--x) l c h)")).toBeNull(); // relative syntax: unsyncable, not a crash
});

test("THE v1 killer bug: Tailwind oklch equals its own hex rendering", () => {
  // zinc-800 in Tailwind v4 is oklch(0.274 0.006 286.033); its sRGB hex is #27272a.
  expect(colorsEqual("oklch(0.274 0.006 286.033)", "#27272a")).toBe(true);
  expect(colorsEqual("oklch(0.274 0.006 286.033)", "#3f3f46")).toBe(false); // zinc-700 ≠ zinc-800
});

test("out-of-sRGB-gamut oklch is gamut-mapped, not channel-clamped", () => {
  const vivid = parseColor("oklch(0.7 0.32 150)"); // P3-ish green, outside sRGB
  expect(vivid).not.toBeNull();
  for (const ch of [vivid!.r, vivid!.g, vivid!.b]) { expect(ch).toBeGreaterThanOrEqual(0); expect(ch).toBeLessThanOrEqual(1); }
});

test("normalizeColor canonicalizes to lowercase hex", () => {
  expect(normalizeColor("#FFF")).toBe("#ffffff");
  expect(normalizeColor("rgb(255 0 0 / 0.5)")).toBe("#ff000080");
});
