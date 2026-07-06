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
  expect(Object.values(ids)).toContain("color/zinc/800");
});

test("assembleChunks throws on a missing chunk", async () => {
  const chunks = await extractAll();
  expect(() => assembleChunks(chunks.slice(1))).toThrow(/chunk/i);
});
