import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { runExtract } from "../src/figma/extract";
import { assembleChunks, figmaPayloadToSnapshot } from "../src/figma/payload";
import { fakeFigma } from "./fake-figma";
import { runLint } from "../src/pipelines/lint";
import { formatReport, errorCount } from "../src/pipelines/report";
import type { AdhdLock } from "../src/core/config";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(REPO_ROOT, "dist", "adhd.js");
const SAMPLE_CSS = readFileSync(join(REPO_ROOT, "test", "fixtures", "sample-globals.css"), "utf-8");
const TOKENS_DOC = JSON.parse(readFileSync(join(REPO_ROOT, "test", "recordings", "tokens-doc.json"), "utf-8"));

async function extractAllChunks() {
  const figma = fakeFigma(TOKENS_DOC);
  const chunks: any[] = [];
  let cursor: string | null = null;
  do {
    const c = await runExtract(figma, { cursor, chunkSize: 30 });
    chunks.push(c);
    cursor = c.cursor;
  } while (!chunks.at(-1)!.done);
  return chunks;
}

function makeConsumerDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "adhd-e2e-"));
  writeFileSync(
    join(dir, "adhd.config.json"),
    JSON.stringify({ figma: { url: "https://www.figma.com/design/ABC123xyz/Test-File" } })
  );
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "globals.css"), SAMPLE_CSS);
  mkdirSync(join(dir, "components"), { recursive: true });
  // An arbitrary-value literal matching color/gold/400 exactly, for the
  // off-system section to have something to report.
  writeFileSync(
    join(dir, "components", "Button.tsx"),
    `export function Button() {\n  return <div className="bg-[#e6ad1f]">Click</div>;\n}\n`
  );
  return dir;
}

function writeChunks(dir: string, chunks: any[]): string {
  const chunksDir = join(dir, "chunks");
  mkdirSync(chunksDir, { recursive: true });
  chunks.forEach((c, i) => writeFileSync(join(chunksDir, `${String(i).padStart(2, "0")}.json`), JSON.stringify(c)));
  return chunksDir;
}

// git init + add (no commit needed — `git ls-files` reports staged files too)
// so the off-system scan's `git ls-files` step has real tracked files to see.
function gitInitAndAdd(dir: string) {
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["add", "-A"], { cwd: dir });
}

function buildLock(payload: ReturnType<typeof figmaPayloadToSnapshot>["snapshot"]): AdhdLock {
  return {
    baseSnapshot: payload,
    figmaIds: { variables: {}, styles: {} },
    components: [],
    lastSync: { at: "2026-01-01T00:00:00Z", figmaHash: "deadbeef" },
  };
}

// Hand-computed expectation for codeSnapshot(sample-globals.css) diffed
// against figmaSnapshot(test/recordings/tokens-doc.json). The two systems
// share no token paths (code is "gold", figma is "zinc"), so every
// non-unsyncable token on each side is existence-only EXCEPT the one shared
// path "background" (semantic, present on both sides), which IS matched and
// diffs structurally: code has literal light/dark values, figma's
// "background" aliases zinc/50 (light) and zinc/950 (dark) -> 2 structural
// entries, one per mode.
//   code tokens:  23 total, 0 unsyncable -> 23 in the map, 1 matched ("background")
//   figma tokens: 67 total, 1 unsyncable (rogue "Brand Extras/brand/accent") -> 66 in the map, 1 matched
//   existence  = (23 - 1) + (66 - 1) = 87
//   structural = 2 (alias-vs-literal, light + dark)
//   valueDrift = 0 (the only matched pair resolved as structural, not value, drift)
//   renames    = 0 (no cross-system path/value coincidences to pair on)
//   cannotSync = 1 (the rogue Brand Extras token)
//   errorCount = violations(0) + valueDrift(0) + existence(87) + structural(2) = 89
const EXPECTED = { violations: 0, valueDrift: 0, existence: 87, structural: 2, renames: 0, cannotSync: 1, errorCount: 89 };

test("runLint (live, --figma-chunks): golden e2e over sample-globals.css vs tokens-doc.json", async () => {
  const dir = makeConsumerDir();
  gitInitAndAdd(dir);
  const chunksDir = writeChunks(dir, await extractAllChunks());

  const result = await runLint({ dir, chunksDir, offline: false });

  expect(result.meta).toEqual({ target: "whole file", targetUrl: null, mode: "live", lockPresent: false });
  expect(result.violations).toHaveLength(EXPECTED.violations);
  expect(result.drift!.valueDrift).toHaveLength(EXPECTED.valueDrift);
  expect(result.drift!.existence).toHaveLength(EXPECTED.existence);
  expect(result.drift!.structural).toHaveLength(EXPECTED.structural);
  expect(result.drift!.renames).toHaveLength(EXPECTED.renames);
  expect(result.drift!.cannotSync).toHaveLength(EXPECTED.cannotSync);
  expect(result.offSystem).toHaveLength(1);
  expect(result.offSystem[0]).toMatchObject({
    file: "components/Button.tsx",
    kind: "arbitrary-class",
    nearestToken: { path: "color/gold/400", exact: true },
  });
  expect(errorCount(result)).toBe(EXPECTED.errorCount);

  const report = formatReport(result);
  expect(report).toContain("## Drift");
  expect(report).toContain("### Existence (87)");
  expect(report).toContain("### Structural (2)");
  expect(report).toContain("## Off-system values in code");
  expect(report).toContain("## Cannot sync");
  expect(report).not.toContain("## Structure"); // no nodeTree in these chunks -> no violations
  expect(report).not.toContain("## Likely renames"); // renames === 0
  expect(report).toContain("No adhd.lock.json"); // no lock present -> note renders
});

test("runLint (--offline) with a hand-built lock reproduces the same drift, no no-lock note", async () => {
  const dir = makeConsumerDir();
  gitInitAndAdd(dir);
  const chunks = await extractAllChunks();
  const chunksDir = writeChunks(dir, chunks);

  const liveResult = await runLint({ dir, chunksDir, offline: false });

  // baseSnapshot = the SAME figma snapshot the live run just diffed against.
  const { snapshot: figmaSnapshot } = figmaPayloadToSnapshot(assembleChunks(chunks));
  writeFileSync(join(dir, "adhd.lock.json"), JSON.stringify(buildLock(figmaSnapshot)));

  const offlineResult = await runLint({ dir, offline: true });

  expect(offlineResult.meta.mode).toBe("offline");
  expect(offlineResult.meta.lockPresent).toBe(true);
  expect(offlineResult.drift).toEqual(liveResult.drift);
  expect(errorCount(offlineResult)).toBe(errorCount(liveResult));

  expect(formatReport(offlineResult)).not.toContain("No adhd.lock.json");
});

test("runLint (--offline) with no lock present throws AdhdError with the first-sync fixup", async () => {
  const dir = makeConsumerDir();
  await expect(runLint({ dir, offline: true })).rejects.toMatchObject({
    name: "AdhdError",
    fixup: expect.stringContaining("--figma-chunks"),
  });
});

test("runLint: --scope file-key mismatch throws AdhdError showing both keys", async () => {
  const dir = makeConsumerDir();
  const chunksDir = writeChunks(dir, await extractAllChunks());
  const scopeUrl = "https://www.figma.com/design/OTHERKEY/Other-File";
  await expect(runLint({ dir, chunksDir, offline: false, scopeUrl })).rejects.toThrow(/ABC123xyz/);
  await expect(runLint({ dir, chunksDir, offline: false, scopeUrl })).rejects.toThrow(/OTHERKEY/);
});

test("runLint: --scope with a node-id sets meta.target to the node-id, meta.targetUrl to the scope url", async () => {
  const dir = makeConsumerDir();
  const chunksDir = writeChunks(dir, await extractAllChunks());
  const scopeUrl = "https://www.figma.com/design/ABC123xyz/Test-File?node-id=1-2";
  const result = await runLint({ dir, chunksDir, offline: false, scopeUrl });
  expect(result.meta.target).toBe("1-2");
  expect(result.meta.targetUrl).toBe(scopeUrl);
});

test("runLint: a chunk carrying nodeTree (M2 forward wiring) runs checkStructure", async () => {
  const dir = makeConsumerDir();
  gitInitAndAdd(dir);
  const nodeTree = {
    id: "1:1",
    name: "Card",
    type: "FRAME",
    layoutMode: "NONE",
    children: [
      { id: "1:2", name: "Label", type: "TEXT", fontSize: 14 },
      { id: "1:3", name: "Body", type: "TEXT", fontSize: 14 },
    ],
  };
  const chunks = await extractAllChunks();
  const chunksWithTree = chunks.map((c, i) => (i === 0 ? { ...c, nodeTree } : c));
  const chunksDir = writeChunks(dir, chunksWithTree);

  const result = await runLint({ dir, chunksDir, offline: false });
  expect(result.violations.length).toBeGreaterThan(0);
  expect(result.violations.some((v) => v.rule === "STRUCT001")).toBe(true);
  expect(formatReport(result)).toContain("## Structure");
});

// --- Step 4: real subprocess smoke (requires `node build.mjs` to have run) --

test("subprocess: `figma-script extract` never prints the raw __ADHD_ARGS__ placeholder", () => {
  const result = spawnSync("node", [CLI, "figma-script", "extract"], { encoding: "utf-8" });
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("__ADHD_ARGS__");
  // Syntactic-validity check only (there's no `figma` global / sandbox here to
  // actually run it against). The script is an async IIFE that may contain a
  // bare top-level `await`, which `new Function(stdout)` alone would reject —
  // so wrap it in an async function body instead of executing it directly.
  expect(() => new Function("figma", `return (async () => {\n${result.stdout}\n})();`)).not.toThrow();
});

test("subprocess: `figma-script extract --cursor` bakes the cursor into the script's args", () => {
  const result = spawnSync("node", [CLI, "figma-script", "extract", "--cursor", "abc123"], { encoding: "utf-8" });
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("__ADHD_ARGS__");
  expect(result.stdout).toContain(JSON.stringify(JSON.stringify({ cursor: "abc123" })));
});

test("subprocess: `lint` with neither --figma-chunks nor --offline exits 2 (usage error)", () => {
  const dir = makeConsumerDir();
  const result = spawnSync("node", [CLI, "lint", "--dir", dir, "--out", join(dir, "report.md")], { encoding: "utf-8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("exactly one of");
});

test("subprocess: `lint --offline --check` exits 1 when errors > 0, exits 0 without --check", async () => {
  const dir = makeConsumerDir(); // deliberately NOT git-init'd: exercises the non-repo off-system fallback
  const chunks = await extractAllChunks();
  const { snapshot: figmaSnapshot } = figmaPayloadToSnapshot(assembleChunks(chunks));
  writeFileSync(join(dir, "adhd.lock.json"), JSON.stringify(buildLock(figmaSnapshot)));

  const outPath = join(dir, "report.md");
  const withCheck = spawnSync("node", [CLI, "lint", "--dir", dir, "--offline", "--out", outPath, "--check"], {
    encoding: "utf-8",
  });
  expect(withCheck.status).toBe(1);
  expect(withCheck.stdout.trim()).toMatch(/^\d+ errors?, \d+ warnings?$/);

  const withoutCheck = spawnSync("node", [CLI, "lint", "--dir", dir, "--offline", "--out", outPath], {
    encoding: "utf-8",
  });
  expect(withoutCheck.status).toBe(0);

  expect(readFileSync(outPath, "utf-8")).toContain("**Result:**");
});
