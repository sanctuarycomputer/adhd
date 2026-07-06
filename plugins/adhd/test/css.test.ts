import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCssSnapshot } from "../src/core/css";

const css = readFileSync(new URL("./fixtures/sample-globals.css", import.meta.url), "utf8");
const snap = parseCssSnapshot(css);
const byPath = (collection: string, p: string) =>
  snap.tokens.find((t) => t.collection === collection && t.path === p);

test("@theme vars land in primitives/default, colors normalized to hex", () => {
  const t = snap.tokens.find((t) => t.collection === "primitives" && t.domain === "color");
  expect(t).toBeDefined();
  expect(t!.values.default).toMatch(/^#[0-9a-f]{6,8}$/);
  // Pinned concrete value: fixture's --color-gold-100 is #faf0c5.
  const gold100 = byPath("primitives", "color/gold/100");
  expect(gold100).toBeDefined();
  expect(gold100!.values.default).toBe("#faf0c5");
});

test("semantic tokens carry light+dark modes from :root and the dark block", () => {
  const sem = snap.tokens.filter((t) => t.collection === "semantic");
  expect(sem.length).toBeGreaterThan(0);
  expect(sem.some((t) => t.values.light && t.values.dark)).toBe(true);
  // Pinned concrete value: fixture's --background is #ffffff light / #0a0a0a dark.
  const background = byPath("semantic", "background");
  expect(background).toBeDefined();
  expect(background!.values.light).toBe("#ffffff");
  expect(background!.values.dark).toBe("#0a0a0a");
});

test("var() references become aliasOf, never flattened", () => {
  const alias = snap.tokens.find((t) => t.aliasOf);
  expect(alias).toBeDefined();
  const targets = Object.values(alias!.aliasOf!);
  expect(targets.length).toBeGreaterThan(0);
  expect(targets[0]).toMatch(/\//); // a path like color/zinc/800
  // Pinned concrete value: @theme inline's --color-brand-on-surface aliases
  // :root's --brand-on-surface directly (aliases are never flattened, so
  // this points at "brand/on/surface", not the deeper "color/gold/800").
  // @theme (inline) declarations are always mode "default".
  const brandOnSurface = byPath("primitives", "color/brand/on/surface");
  expect(brandOnSurface).toBeDefined();
  expect(brandOnSurface!.aliasOf).toEqual({ default: "brand/on/surface" });
});

test("aliasOf targets differ per mode when a semantic token aliases a different primitive in light vs dark", () => {
  // Pinned concrete value: fixture's --brand-surface aliases
  // --color-gold-100 in :root (light) and --color-gold-900 in the
  // prefers-color-scheme: dark block. Silently collapsing these to one
  // last-write-wins target would lose the light alias entirely.
  const brandSurface = byPath("semantic", "brand/surface");
  expect(brandSurface).toBeDefined();
  expect(brandSurface!.aliasOf?.light).toBe("color/gold/100");
  expect(brandSurface!.aliasOf?.dark).toBe("color/gold/900");
});

test("unparseable values are unsyncable, not dropped and not a crash", () => {
  const weird = parseCssSnapshot(`@theme { --color-x: oklch(from var(--y) l c h); }`);
  expect(weird.tokens).toHaveLength(1);
  expect(weird.tokens[0]!.unsyncable).toBeTruthy();
});

test("css variable names outside the naming grammar produce an unsyncable stand-in token, not a silent drop", () => {
  const weird = parseCssSnapshot(`@theme { --color-X-bad: #fff; }`);
  expect(weird.tokens).toHaveLength(1);
  const t = weird.tokens[0]!;
  expect(t.path).toBe("--color-X-bad");
  expect(t.domain).toBe("other");
  expect(t.unsyncable).toContain("outside the token naming grammar");
});

test("parses the example app's real globals.css without unsyncable surprises", () => {
  // The example app lives at <repo-root>/example/app/globals.css; this test
  // file lives at <repo-root>/plugins/adhd/test/, so it's three levels up.
  const realCss = readFileSync(
    new URL("../../../example/app/globals.css", import.meta.url),
    "utf8",
  );
  const real = parseCssSnapshot(realCss);
  expect(real.tokens.length).toBeGreaterThan(20);
  const unsyncableReasons = real.tokens.filter((t) => t.unsyncable).map((t) => t.unsyncable);
  expect(unsyncableReasons).toEqual([]);
});
