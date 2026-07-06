import { expect, test } from "vitest";
import { diffSnapshots } from "../src/pipelines/diff";
import { domainOf, type Snapshot } from "../src/core/tokens";

const tok = (path: string, values: any, extra: any = {}) =>
  ({ path, collection: "primitives", domain: "color", values, ...extra });
const snap = (side: "code" | "figma", tokens: any[]): Snapshot => ({ side, tokens, styles: [] });
const noLock = { lock: null, figmaIds: null };

test("oklch in code equals its hex in figma — NO drift (v1 regression)", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/zinc/800", { default: "oklch(0.274 0.006 286.033)" })]),
    snap("figma", [tok("color/zinc/800", { default: "#27272a" })]), noLock);
  expect(d.valueDrift).toEqual([]);
});

test("real value drift is reported per mode", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/zinc/800", { default: "#27272a" })]),
    snap("figma", [tok("color/zinc/800", { default: "#3f3f46" })]), noLock);
  expect(d.valueDrift).toHaveLength(1);
  expect(d.valueDrift[0]).toMatchObject({ path: "color/zinc/800", mode: "default" });
});

test("dimension equivalence: 0.5rem == 8px", () => {
  const d = diffSnapshots(
    snap("code", [tok("spacing/2", { default: "0.5rem" }, { domain: "spacing" })]),
    snap("figma", [tok("spacing/2", { default: "8px" }, { domain: "spacing" })]), noLock);
  expect(d.valueDrift).toEqual([]);
});

test("alias-vs-literal is structural, not value, drift", () => {
  const d = diffSnapshots(
    snap("code", [tok("background", { light: "var(--color-zinc-50)" }, { collection: "semantic", aliasOf: { light: "color/zinc/50" } })]),
    snap("figma", [tok("background", { light: "#fafafa" }, { collection: "semantic" })]), noLock);
  expect(d.valueDrift).toEqual([]);
  expect(d.structural).toHaveLength(1);
  expect(d.structural[0]!.kind).toBe("alias-vs-literal");
  expect(d.structural[0]!.mode).toBe("light");
});

test("alias-target-differs is structural, per mode", () => {
  const d = diffSnapshots(
    snap("code", [tok("background", {}, { collection: "semantic", aliasOf: { light: "color/zinc/50" } })]),
    snap("figma", [tok("background", {}, { collection: "semantic", aliasOf: { light: "color/zinc/100" } })]), noLock);
  expect(d.valueDrift).toEqual([]);
  expect(d.structural).toEqual([
    { path: "background", kind: "alias-target-differs", code: "color/zinc/50", figma: "color/zinc/100", mode: "light" },
  ]);
});

test("definite rename via lock IDs; pair removed from existence", () => {
  const lock: any = { figmaIds: { variables: { "VariableID:1:1": "color/brand/gold" }, styles: {} },
    baseSnapshot: snap("figma", []), components: [], lastSync: { at: "", figmaHash: "" } };
  const d = diffSnapshots(
    snap("code", [tok("color/brand/gold", { default: "#d4a017" })]),
    snap("figma", [tok("color/brand/golden", { default: "#d4a017" })]),
    { lock, figmaIds: { "VariableID:1:1": "color/brand/golden" } });
  expect(d.renames).toEqual([{ from: "color/brand/gold", to: "color/brand/golden", confidence: "definite", side: "figma" }]);
  expect(d.existence).toEqual([]);
});

test("probable rename heuristic without a lock", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/brand/gold", { default: "#d4a017" })]),
    snap("figma", [tok("color/brand/golden", { default: "#d4a017" })]), noLock);
  expect(d.renames[0]?.confidence).toBe("probable");
  expect(d.existence).toEqual([]);
});

test("probable rename heuristic pairs 1:1 across multiple candidates by value", () => {
  const d = diffSnapshots(
    snap("code", [
      tok("color/brand/gold", { default: "#d4a017" }),
      tok("color/brand/silver", { default: "#c0c0c0" }),
    ]),
    snap("figma", [
      tok("color/brand/golden", { default: "#d4a017" }),
      tok("color/brand/silvery", { default: "#c0c0c0" }),
    ]),
    noLock
  );
  expect(d.existence).toEqual([]);
  expect(d.renames).toHaveLength(2);
  const byFrom = Object.fromEntries(d.renames.map((r) => [r.from, r.to]));
  expect(byFrom["color/brand/gold"]).toBe("color/brand/golden");
  expect(byFrom["color/brand/silver"]).toBe("color/brand/silvery");
  const froms = new Set(d.renames.map((r) => r.from));
  const tos = new Set(d.renames.map((r) => r.to));
  expect(froms.size).toBe(2);
  expect(tos.size).toBe(2);
});

test("unsyncable tokens land in cannotSync with reasons, on both sides", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/weird", { default: "oklch(from var(--x) l c h)" }, { unsyncable: "relative color" })]),
    snap("figma", [tok("color/rogue", { default: "#000000" }, { unsyncable: "collection 'Brand Extras'..." })]), noLock);
  expect(d.cannotSync).toHaveLength(2);
});

// --- Amendments ---

test("figma-side rogue-collection token is excluded from existence, only in cannotSync", () => {
  const d = diffSnapshots(
    snap("code", []),
    snap("figma", [
      tok("rogue:Brand Extras/color/x", {}, { collection: "primitives", unsyncable: "collection 'Brand Extras'..." }),
    ]),
    noLock);
  expect(d.cannotSync).toEqual([
    { path: "rogue:Brand Extras/color/x", side: "figma", reason: "collection 'Brand Extras'..." },
  ]);
  expect(d.existence).toEqual([]);
});

test("mode present in code but missing in figma is valueDrift with '(missing)'", () => {
  const d = diffSnapshots(
    snap("code", [tok("background", { light: "#ffffff", dark: "#000000" }, { collection: "semantic" })]),
    snap("figma", [tok("background", { light: "#ffffff" }, { collection: "semantic" })]), noLock);
  expect(d.valueDrift).toEqual([
    { path: "background", collection: "semantic", mode: "dark", code: "#000000", figma: "(missing)" },
  ]);
});

test("mode wholly missing on one side routes to valueDrift, not alias-vs-literal", () => {
  const d = diffSnapshots(
    snap("code", [
      tok(
        "background",
        { light: "var(--color-zinc-50)", dark: "var(--color-zinc-900)" },
        { collection: "semantic", aliasOf: { light: "color/zinc/50", dark: "color/zinc/900" } }
      ),
    ]),
    snap("figma", [
      tok("background", { light: "#fafafa" }, { collection: "semantic", aliasOf: { light: "color/zinc/50" } }),
    ]),
    noLock
  );
  expect(d.structural.filter((s) => s.mode === "dark")).toEqual([]);
  expect(d.valueDrift).toHaveLength(1);
  expect(d.valueDrift[0]).toMatchObject({ path: "background", mode: "dark", figma: "(missing)" });
});

test("bare semantic color token (real domainOf, not hardcoded 'color') compares tolerantly — v2 regression", () => {
  // domainOf("background") classifies as "other" (no "/" in the path), unlike
  // the `tok` helper above which hardcodes domain: "color" by default. Build
  // this token honestly via the real domainOf so the test actually exercises
  // valuesEqual's domain === "other" fallback path.
  const domain = domainOf("background");
  expect(domain).toBe("other");
  const d = diffSnapshots(
    snap("code", [{ path: "background", collection: "semantic", domain, values: { default: "oklch(1 0 0)" } }]),
    snap("figma", [{ path: "background", collection: "semantic", domain, values: { default: "#ffffff" } }]),
    noLock,
  );
  expect(d.valueDrift).toEqual([]);
});

test("bare semantic color token with a genuinely different value still reports valueDrift", () => {
  const domain = domainOf("background");
  const d = diffSnapshots(
    snap("code", [{ path: "background", collection: "semantic", domain, values: { default: "#ffffff" } }]),
    snap("figma", [{ path: "background", collection: "semantic", domain, values: { default: "#000000" } }]),
    noLock,
  );
  expect(d.valueDrift).toHaveLength(1);
  expect(d.valueDrift[0]).toMatchObject({ path: "background", mode: "default", code: "#ffffff", figma: "#000000" });
});

// --- Fix pinning ---

test("two short (2-segment) paths sharing only one segment are NOT a probable rename — existence drift instead", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/black", { default: "#000000" })]),
    snap("figma", [tok("color/ink", { default: "#000000" })]),
    noLock
  );
  expect(d.renames).toEqual([]);
  expect(d.existence).toHaveLength(2);
  const paths = d.existence.map((e) => e.path).sort();
  expect(paths).toEqual(["color/black", "color/ink"]);
});

test("probable rename still pairs paths differing only in their last segment (3+ segments): gold→golden, silver→silvery", () => {
  const d = diffSnapshots(
    snap("code", [
      tok("color/brand/gold", { default: "#d4a017" }),
      tok("color/brand/silver", { default: "#c0c0c0" }),
    ]),
    snap("figma", [
      tok("color/brand/golden", { default: "#d4a017" }),
      tok("color/brand/silvery", { default: "#c0c0c0" }),
    ]),
    noLock
  );
  expect(d.existence).toEqual([]);
  expect(d.renames).toHaveLength(2);
});

test("duplicate collection+path key on either side routes the loser to cannotSync instead of silently overwriting", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/red", { default: "#ff0000" })]),
    snap("figma", [
      tok("color/red", { default: "#ff0000" }),
      tok("color/red", { default: "#ee0000" }),
    ]),
    noLock
  );
  const dup = d.cannotSync.find((c) => c.side === "figma");
  expect(dup).toBeDefined();
  expect(dup!.reason).toMatch(/duplicate token key 'primitives:color\/red'/);
  // The first figma occurrence still wins the match against code, so no
  // existence/valueDrift entries are produced for this path.
  expect(d.existence).toEqual([]);
  expect(d.valueDrift).toEqual([]);
});

test("typography dimension: code rem and figma bare-number FLOAT are unified — no valueDrift", () => {
  const d = diffSnapshots(
    snap("code", [tok("text/lg", { default: "1.125rem" }, { domain: "typography" })]),
    snap("figma", [tok("text/lg", { default: "18" }, { domain: "typography" })]), noLock);
  expect(d.valueDrift).toEqual([]);
});

test("typography dimension: a genuinely different pair still reports valueDrift", () => {
  const d = diffSnapshots(
    snap("code", [tok("text/lg", { default: "1.125rem" }, { domain: "typography" })]),
    snap("figma", [tok("text/lg", { default: "20" }, { domain: "typography" })]), noLock);
  expect(d.valueDrift).toHaveLength(1);
  expect(d.valueDrift[0]).toMatchObject({ path: "text/lg", mode: "default", code: "1.125rem", figma: "20" });
});

test("typography dimension: line-height rem vs bare-number FLOAT are unified — no valueDrift", () => {
  const d = diffSnapshots(
    snap("code", [tok("leading/normal", { default: "1rem" }, { domain: "typography" })]),
    snap("figma", [tok("leading/normal", { default: "16" }, { domain: "typography" })]), noLock);
  expect(d.valueDrift).toEqual([]);
});

test("typography font-weight (unitless): equal values produce no drift", () => {
  const d = diffSnapshots(
    snap("code", [tok("font/weight/medium", { default: "500" }, { domain: "typography" })]),
    snap("figma", [tok("font/weight/medium", { default: "500" }, { domain: "typography" })]), noLock);
  expect(d.valueDrift).toEqual([]);
});

test("typography font-weight (unitless): differing values still report valueDrift", () => {
  const d = diffSnapshots(
    snap("code", [tok("font/weight/medium", { default: "500" }, { domain: "typography" })]),
    snap("figma", [tok("font/weight/medium", { default: "700" }, { domain: "typography" })]), noLock);
  expect(d.valueDrift).toHaveLength(1);
  expect(d.valueDrift[0]).toMatchObject({ path: "font/weight/medium", mode: "default", code: "500", figma: "700" });
});

test("definite rename does not swallow a coincident value change", () => {
  const lock: any = { figmaIds: { variables: { "VariableID:1:1": "color/brand/gold" }, styles: {} },
    baseSnapshot: snap("figma", []), components: [], lastSync: { at: "", figmaHash: "" } };
  const d = diffSnapshots(
    snap("code", [tok("color/brand/gold", { default: "#d4a017" })]),
    snap("figma", [tok("color/brand/golden", { default: "#123456" })]),
    { lock, figmaIds: { "VariableID:1:1": "color/brand/golden" } });
  expect(d.renames).toEqual([{ from: "color/brand/gold", to: "color/brand/golden", confidence: "definite", side: "figma" }]);
  expect(d.existence).toEqual([]);
  expect(d.valueDrift).toHaveLength(1);
  expect(d.valueDrift[0]).toMatchObject({ path: "color/brand/gold", mode: "default", code: "#d4a017", figma: "#123456" });
});

test("describeValue includes both the alias and the literal mode for a mixed alias/literal token", () => {
  const d = diffSnapshots(
    snap("code", []),
    snap("figma", [
      tok(
        "background",
        { dark: "#000000" },
        { collection: "semantic", aliasOf: { light: "color/zinc/50" } }
      ),
    ]),
    noLock
  );
  expect(d.existence).toHaveLength(1);
  expect(d.existence[0]!.value).toContain("light: alias(color/zinc/50)");
  expect(d.existence[0]!.value).toContain("dark: #000000");
});
