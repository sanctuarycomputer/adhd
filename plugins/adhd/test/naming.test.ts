import { expect, test } from "vitest";
import { cssVarToPath, pathToCssVar, caseMatches } from "../src/core/naming";

test("cssVar ↔ path is bijective, lowercase, hyphens↔slashes", () => {
  expect(cssVarToPath("--color-zinc-800")).toBe("color/zinc/800");
  expect(pathToCssVar("color/zinc/800")).toBe("--color-zinc-800");
  expect(cssVarToPath(pathToCssVar("spacing/2"))).toBe("spacing/2");
});
test("composite companion vars map to nested paths", () => {
  // --text-lg--line-height → text/lg/line-height (double hyphen = segment boundary too)
  expect(cssVarToPath("--text-lg--line-height")).toBe("text/lg/line-height");
});
test("caseMatches enforces strict kebab (no slashes/dots — the v1 loophole)", () => {
  expect(caseMatches("status-dot", "kebab-case")).toBe(true);
  expect(caseMatches("Status Dot", "kebab-case")).toBe(false);
  expect(caseMatches("a/b.c", "kebab-case")).toBe(false); // v1's second alternative wrongly allowed this
  expect(caseMatches("anything", false)).toBe(true);
  expect(caseMatches("AvatarBody", "PascalCase")).toBe(true);
});
