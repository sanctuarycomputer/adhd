import { expect, test } from "vitest";
import { cssVarToPath, pathToCssVar, caseMatches } from "../src/core/naming";

test("cssVar ↔ path is bijective, lowercase, hyphens↔slashes", () => {
  expect(cssVarToPath("--color-zinc-800")).toBe("color/zinc/800");
  expect(pathToCssVar("color/zinc/800")).toBe("--color-zinc-800");
  expect(cssVarToPath(pathToCssVar("spacing/2")!)).toBe("spacing/2");
});

test("composite companion vars map to nested paths", () => {
  // --text-lg--line-height → text/lg/line-height (double hyphen = companion boundary)
  expect(cssVarToPath("--text-lg--line-height")).toBe("text/lg/line-height");
});

test("round-trip identities for representative in-domain values", () => {
  const cases: [string, string][] = [
    ["--color-zinc-800", "color/zinc/800"],
    ["--spacing-2", "spacing/2"],
    ["--text-lg", "text/lg"],
    ["--text-lg--line-height", "text/lg/line-height"],
  ];
  for (const [cssVar, path] of cases) {
    expect(cssVarToPath(cssVar)).toBe(path);
    expect(pathToCssVar(path)).toBe(cssVar);
    expect(pathToCssVar(cssVarToPath(cssVar)!)).toBe(cssVar);
    expect(cssVarToPath(pathToCssVar(path)!)).toBe(path);
  }
});

test("cssVarToPath returns null for out-of-domain double-hyphen inputs", () => {
  expect(cssVarToPath("--a--b")).toBeNull();
  expect(cssVarToPath("--a--b--c")).toBeNull();
});

test("cssVarToPath returns null (not throw) for non-css-var input", () => {
  expect(cssVarToPath("not-a-var")).toBeNull();
});

test("pathToCssVar returns null for non-final hyphenated segments", () => {
  expect(pathToCssVar("color/brand-x/500")).toBeNull();
});

test("pathToCssVar returns null for uppercase segments", () => {
  expect(pathToCssVar("Color/Zinc/800")).toBeNull();
});

test("caseMatches enforces strict kebab (no slashes/dots — the v1 loophole)", () => {
  expect(caseMatches("status-dot", "kebab-case")).toBe(true);
  expect(caseMatches("Status Dot", "kebab-case")).toBe(false);
  expect(caseMatches("a/b.c", "kebab-case")).toBe(false); // v1's second alternative wrongly allowed this
  expect(caseMatches("anything", false)).toBe(true);
  expect(caseMatches("AvatarBody", "PascalCase")).toBe(true);
});
