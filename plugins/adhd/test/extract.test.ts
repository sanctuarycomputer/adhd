import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { runExtract } from "../src/figma/extract";
import { assembleChunks, figmaPayloadToSnapshot } from "../src/figma/payload";
import { fakeFigma } from "./fake-figma";

const doc = JSON.parse(readFileSync(new URL("./recordings/tokens-doc.json", import.meta.url), "utf8"));

async function extractAll() {
  const figma = fakeFigma(doc);
  const chunks = []; let cursor: string | null = null;
  do { const c = await runExtract(figma, { cursor, chunkSize: 30 }); chunks.push(c); cursor = c.cursor; } while (!chunks.at(-1)!.done);
  return chunks;
}

test("cursor protocol: multiple chunks, deterministic, hash on final chunk only", async () => {
  const chunks = await extractAll();
  expect(chunks.length).toBeGreaterThan(2);
  expect(chunks.slice(0, -1).every((c) => c.hash === null)).toBe(true);
  expect(chunks.at(-1)!.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(await extractAll()).toEqual(chunks); // determinism — the v1 byte-diff drift check's missing property
});

test("assemble + toSnapshot: aliases preserved, rogue collection unsyncable, ids map", async () => {
  const payload = assembleChunks(await extractAll());
  const { snapshot, ids } = figmaPayloadToSnapshot(payload);
  const bg = snapshot.tokens.find((t) => t.path === "background");
  expect(bg?.collection).toBe("semantic");
  // Semantic aliasOf is per-mode (Task 7 amendment): Light aliases zinc/50, Dark aliases zinc/950.
  expect(bg?.aliasOf).toEqual({ light: "color/zinc/50", dark: "color/zinc/950" });
  const rogue = snapshot.tokens.filter((t) => t.unsyncable?.includes("Brand Extras"));
  expect(rogue.length).toBe(1);
  expect(rogue[0]!.path.startsWith("rogue:Brand Extras/")).toBe(true);
  expect(Object.values(ids)).toContain("color/zinc/800");
});

test("assembleChunks throws on a missing chunk", async () => {
  const chunks = await extractAll();
  expect(() => assembleChunks(chunks.slice(1))).toThrow(/chunk/i);
});

// --- negative-path tests via minimal inline docs -----------------------------
// These build tiny synthetic docs directly (rather than editing the large committed
// recording) so each failure mode is isolated and obvious at the call site.

function minimalDoc(overrides: {
  collections: any[];
  textStyles?: any[];
  effectStyles?: any[];
}) {
  return {
    collections: overrides.collections,
    textStyles: overrides.textStyles ?? [],
    effectStyles: overrides.effectStyles ?? [],
  };
}

async function extractAllFrom(doc: any) {
  const figma = fakeFigma(doc);
  const chunks: any[] = [];
  let cursor: string | null = null;
  do {
    const c = await runExtract(figma, { cursor, chunkSize: 30 });
    chunks.push(c);
    cursor = c.cursor;
  } while (!chunks.at(-1)!.done);
  return chunks;
}

test("assembleChunks throws on a corrupted final-chunk hash", async () => {
  const doc = minimalDoc({
    collections: [
      {
        id: "C-p",
        name: "Primitives",
        modes: [{ modeId: "m1", name: "Default" }],
        variables: [
          {
            id: "V-1",
            name: "color/zinc/50",
            resolvedType: "COLOR",
            valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
          },
        ],
      },
    ],
  });
  const chunks = await extractAllFrom(doc);
  const corrupted = [...chunks.slice(0, -1), { ...chunks.at(-1)!, hash: "0000000000000000" }];
  expect(() => assembleChunks(corrupted)).toThrow(/corrupted/i);
});

test("buildSemanticToken: dangling alias -> unsyncable 'alias target not found'", async () => {
  const doc = minimalDoc({
    collections: [
      {
        id: "C-s",
        name: "Semantic",
        modes: [
          { modeId: "lm", name: "Light" },
          { modeId: "dm", name: "Dark" },
        ],
        variables: [
          {
            id: "V-bg",
            name: "background",
            resolvedType: "COLOR",
            valuesByMode: {
              lm: { type: "VARIABLE_ALIAS", id: "VariableID:9:999" },
            },
          },
        ],
      },
    ],
  });
  const chunks = await extractAllFrom(doc);
  const payload = assembleChunks(chunks);
  const { snapshot } = figmaPayloadToSnapshot(payload);
  const bg = snapshot.tokens.find((t) => t.path === "background");
  expect(bg?.unsyncable).toMatch(/alias target not found/);
});

test("buildSemanticToken: unknown mode name -> unsyncable \"unknown mode 'Hover'\"", async () => {
  const doc = minimalDoc({
    collections: [
      {
        id: "C-s",
        name: "Semantic",
        modes: [
          { modeId: "lm", name: "Light" },
          { modeId: "dm", name: "Dark" },
          { modeId: "hm", name: "Hover" },
        ],
        variables: [
          {
            id: "V-bg",
            name: "background",
            resolvedType: "COLOR",
            valuesByMode: {
              hm: { r: 0, g: 0, b: 0, a: 1 },
            },
          },
        ],
      },
    ],
  });
  const chunks = await extractAllFrom(doc);
  const payload = assembleChunks(chunks);
  const { snapshot } = figmaPayloadToSnapshot(payload);
  const bg = snapshot.tokens.find((t) => t.path === "background");
  expect(bg?.unsyncable).toMatch(/unknown mode 'Hover'/);
});

test("collection/mode name matching is case-insensitive", async () => {
  const doc = minimalDoc({
    collections: [
      {
        id: "C-p",
        name: "primitives",
        modes: [{ modeId: "m1", name: "Default" }],
        variables: [
          {
            id: "V-1",
            name: "color/zinc/50",
            resolvedType: "COLOR",
            valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
          },
        ],
      },
      {
        id: "C-s",
        name: "Semantic",
        modes: [
          { modeId: "lm", name: "light" },
          { modeId: "dm", name: "dark" },
        ],
        variables: [
          {
            id: "V-bg",
            name: "background",
            resolvedType: "COLOR",
            valuesByMode: {
              lm: { type: "VARIABLE_ALIAS", id: "V-1" },
              dm: { type: "VARIABLE_ALIAS", id: "V-1" },
            },
          },
        ],
      },
    ],
  });
  const chunks = await extractAllFrom(doc);
  const payload = assembleChunks(chunks);
  const { snapshot } = figmaPayloadToSnapshot(payload);
  const prim = snapshot.tokens.find((t) => t.path === "color/zinc/50");
  expect(prim?.collection).toBe("primitives");
  expect(prim?.unsyncable).toBeUndefined();
  const bg = snapshot.tokens.find((t) => t.path === "background");
  expect(bg?.collection).toBe("semantic");
  expect(bg?.unsyncable).toBeUndefined();
  expect(bg?.aliasOf).toEqual({ light: "color/zinc/50", dark: "color/zinc/50" });
});
