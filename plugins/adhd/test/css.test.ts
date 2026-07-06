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
  expect(targets[0]).toMatch(/\//); // a path like color/gold/100
  // Pinned concrete value: :root's --brand-surface-raised aliases
  // --color-gold-200 directly in light and --color-gold-800 in dark
  // (aliases are never flattened, so these point at the primitive paths,
  // not a resolved hex value).
  const brandSurfaceRaised = byPath("semantic", "brand/surface/raised");
  expect(brandSurfaceRaised).toBeDefined();
  expect(brandSurfaceRaised!.aliasOf).toEqual({ light: "color/gold/200", dark: "color/gold/800" });
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
  // 18 real tokens (11 gold primitives + 2 text primitives + 5 semantic
  // roles). Previously 25: the file's `@theme inline` block contributes 7
  // Layer-3 exposure vars that bridge semantic roles into Tailwind's
  // utility namespace (--color-background, --color-foreground, --font-sans,
  // --font-mono, --color-brand-surface, --color-brand-surface-raised,
  // --color-brand-on-surface) — those are code-only plumbing with no Figma
  // counterpart, so they're correctly excluded rather than counted as
  // spurious "primitives" tokens.
  expect(real.tokens).toHaveLength(18);
  const unsyncableReasons = real.tokens.filter((t) => t.unsyncable).map((t) => t.unsyncable);
  expect(unsyncableReasons).toEqual([]);
  const paths = real.tokens.map((t) => `${t.collection}:${t.path}`);
  expect(paths).not.toContain("primitives:color/background");
  expect(paths).not.toContain("primitives:font/sans");
});

test("@theme inline exposure vars are excluded entirely, not emitted as primitives", () => {
  const css = `@theme inline {
    --color-background: var(--background);
  }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(0);
});

test("@theme inline static (Tailwind v4 combined modifiers) is also excluded", () => {
  const css = `@theme inline static {
    --color-background: var(--background);
  }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(0);
});

test("@theme inline reference (Tailwind v4 combined modifiers) is also excluded", () => {
  const css = `@theme inline reference {
    --x: var(--y);
  }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(0);
});

test("bare @theme still produces a primitives token (unaffected by the inline exclusion)", () => {
  const css = `@theme {
    --color-zinc-800: #27272a;
  }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(1);
  const t = result.tokens[0]!;
  expect(t.collection).toBe("primitives");
  expect(t.path).toBe("color/zinc/800");
  expect(t.values.default).toBe("#27272a");
});

test("unresolvable alias targets are marked unsyncable", () => {
  const css = `@theme { --color-x: var(--Bad--x); }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(1);
  const t = result.tokens[0]!;
  expect(t.path).toBe("color/x");
  expect(t.unsyncable).toContain("alias target");
  expect(t.aliasOf).toBeUndefined();
});

test(".dark selector (bare) lands as semantic/dark", () => {
  const css = `.dark { --background: #000; }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(1);
  const t = result.tokens[0]!;
  expect(t.collection).toBe("semantic");
  expect(t.path).toBe("background");
  expect(t.values.dark).toMatch(/^#[0-9a-f]+$/);
});

test("[data-theme=\"dark\"] selector lands as semantic/dark", () => {
  const css = `[data-theme="dark"] { --background: #000; }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(1);
  const t = result.tokens[0]!;
  expect(t.collection).toBe("semantic");
  expect(t.path).toBe("background");
  expect(t.values.dark).toMatch(/^#[0-9a-f]+$/);
});

test(".dark-mode selector contributes no tokens", () => {
  const css = `.dark-mode { --background: #000; }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(0);
});

test("bare semantic color token (domain 'other' via domainOf) is normalized to hex, not left raw", () => {
  // --background has no "/" in its path, so domainOf("background") classifies
  // it as "other", not "color" — but its value is still a color and must be
  // normalized the same way @theme color-domain values are, or the code-side
  // snapshot ends up with a non-canonical string (e.g. "oklch(1 0 0)") that
  // spuriously diffs against Figma's "#ffffff".
  const css = `:root { --background: oklch(1 0 0); }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(1);
  const t = result.tokens[0]!;
  expect(t.path).toBe("background");
  expect(t.domain).toBe("other");
  expect(t.values.light).toBe("#ffffff");
  expect(t.unsyncable).toBeUndefined();
});

test("a named color in a non-color-domain path still normalizes to hex", () => {
  // --x lands as domain "other" (single segment, no color/spacing/etc.
  // prefix). Its value "white" is a CSS named color, not a bare number, so
  // the numeric guard must not suppress normalization here — round-1's
  // intent (bare semantic colors get canonicalized) still applies.
  const css = `@theme { --x: white; }`;
  const result = parseCssSnapshot(css);
  expect(result.tokens).toHaveLength(1);
  const t = result.tokens[0]!;
  expect(t.domain).toBe("other");
  expect(t.values.default).toBe("#ffffff");
});

test("bare numeric design tokens in non-color domains are stored verbatim, not corrupted into hex", () => {
  // Regression: culori's parse() accepts bare hex-looking digit strings
  // WITHOUT a leading '#' (e.g. "500" parses as though it were "#500"), so
  // running every "other"-domain value through normalizeColor silently
  // corrupted numeric tokens like font-weight and spacing scales into
  // bogus hex colors.
  const css = `@theme {
    --font-weight-medium: 500;
    --font-weight-normal: 400;
    --font-weight-bold: 700;
    --spacing-lg: 100;
    --text-lg: 1.125rem;
  }`;
  const result = parseCssSnapshot(css);
  const byName = (path: string) => result.tokens.find((t) => t.path === path);

  expect(byName("font/weight/medium")!.values.default).toBe("500");
  expect(byName("font/weight/normal")!.values.default).toBe("400");
  expect(byName("font/weight/bold")!.values.default).toBe("700");
  expect(byName("spacing/lg")!.values.default).toBe("100");
  expect(byName("text/lg")!.values.default).toBe("1.125rem");

  for (const t of result.tokens) expect(t.unsyncable).toBeUndefined();
});
