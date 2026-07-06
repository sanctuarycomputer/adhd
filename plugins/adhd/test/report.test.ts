import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { formatReport, errorCount, type LintResult } from "../src/pipelines/report";

// Covers every section with >=1 item: two violation groups (error + warning),
// all three drift classes, a definite AND a probable rename, an exact AND a
// near off-system finding, and a cannotSync entry. lockPresent: false so the
// no-lock note also renders.
const result: LintResult = {
  violations: [
    {
      rule: "STRUCT001",
      severity: "error",
      nodeId: "1:1",
      nodePath: "Page 1 > Card",
      message: "Frame has children but auto-layout is not enabled.",
      deepLink: "https://figma.com/design/abc?node-id=1-1",
    },
    {
      rule: "STRUCT001",
      severity: "error",
      nodeId: "1:2",
      nodePath: "Page 1 > Card > Icon Frame",
      message: "Frame has children but auto-layout is not enabled.",
      deepLink: "https://figma.com/design/abc?node-id=1-2",
    },
    {
      rule: "STRUCT008",
      severity: "warning",
      nodeId: "1:3",
      nodePath: "Page 1 > Frame 42",
      message: 'Layer is auto-named ("Frame 42"); rename for clarity.',
      deepLink: "https://figma.com/design/abc?node-id=1-3",
    },
  ],
  drift: {
    valueDrift: [
      { path: "color/zinc/800", collection: "primitives", mode: "default", code: "#27272a", figma: "#3f3f46" },
    ],
    existence: [
      { path: "color/brand/teal", collection: "primitives", onlyIn: "figma", value: "default: #0f766e" },
    ],
    structural: [
      {
        path: "background",
        kind: "alias-vs-literal",
        mode: "light",
        code: "color/zinc/50",
        figma: "#fafafa",
      },
    ],
    renames: [
      { from: "color/brand/gold", to: "color/brand/golden", confidence: "definite", side: "figma" },
      { from: "color/brand/sky", to: "color/brand/skyblue", confidence: "probable", side: "figma" },
    ],
    cannotSync: [{ path: "color/legacy/mystery", side: "figma", reason: "unresolvable alias chain" }],
  },
  offSystem: [
    {
      file: "app/Card.tsx",
      line: 12,
      snippet: "bg-[#27272a]",
      kind: "arbitrary-class",
      nearestToken: { path: "color/zinc/800", exact: true },
    },
    {
      file: "app/Card.tsx",
      line: 20,
      snippet: "#27272b",
      kind: "inline-hex",
      nearestToken: { path: "color/zinc/800", exact: false },
    },
  ],
  meta: {
    target: "Design System / Card",
    targetUrl: "https://figma.com/design/abc?node-id=0-1",
    mode: "live",
    lockPresent: false,
  },
};

test("golden report", () => {
  const md = formatReport(result);
  expect(md).toBe(readFileSync(new URL("./fixtures/report-golden.md", import.meta.url), "utf8"));
});

test("errorCount counts errors + all drift, not warnings", () => {
  // violations: 2 error (STRUCT001 x2) + 1 warning (STRUCT008) -> 2 errors
  // drift: 1 valueDrift + 1 existence + 1 structural -> 3 errors
  // renames (2), offSystem (2), cannotSync (1) are warnings, not counted
  expect(errorCount(result)).toBe(5);
});

test("byte-stable: no timestamp, calling twice yields identical output", () => {
  expect(formatReport(result)).toBe(formatReport(result));
});

test("omits empty sections and renders single-line report when nothing to report", () => {
  const empty: LintResult = {
    violations: [],
    drift: null,
    offSystem: [],
    meta: { target: "Design System / Card", targetUrl: null, mode: "offline", lockPresent: true },
  };
  const md = formatReport(empty);
  expect(md).toContain("No issues found.");
  expect(md).not.toContain("## Structure");
  expect(md).not.toContain("## Drift");
  expect(md).not.toContain("## Likely renames");
  expect(md).not.toContain("## Off-system values in code");
  expect(md).not.toContain("## Cannot sync");
  expect(errorCount(empty)).toBe(0);
});
