import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadConfig, loadLock, AdhdError, resolveCssEntry } from "../src/core/config";

const dir = () => mkdtempSync(join(tmpdir(), "adhd-"));

test("loads and validates a good config, derives fileKey, defaults naming", () => {
  const d = dir();
  writeFileSync(join(d, "adhd.config.json"), JSON.stringify({ figma: { url: "https://www.figma.com/design/ABC123xyz/My-File" } }));
  const cfg = loadConfig(d);
  expect(cfg.figma.fileKey).toBe("ABC123xyz");
  expect(cfg.naming).toBe("kebab-case");
});

test("missing config throws AdhdError with the adhd.config.json fixup", () => {
  expect(() => loadConfig(dir())).toThrowError(AdhdError);
  try { loadConfig(dir()); } catch (e: any) { expect(e.fixup).toContain("adhd.config.json"); }
});

test("bad figma url is a field-level error", () => {
  const d = dir();
  writeFileSync(join(d, "adhd.config.json"), JSON.stringify({ figma: { url: "https://example.com/nope" } }));
  expect(() => loadConfig(d)).toThrow(/figma\.url/);
});

test("absent lock is null, corrupt lock throws", () => {
  const d = dir();
  expect(loadLock(d)).toBeNull();
  writeFileSync(join(d, "adhd.lock.json"), "{not json");
  expect(() => loadLock(d)).toThrowError(AdhdError);
});

test("cssEntry: null in config loads with cssEntry === null", () => {
  const d = dir();
  writeFileSync(join(d, "adhd.config.json"), JSON.stringify({ figma: { url: "https://www.figma.com/design/ABC123xyz/My-File" }, cssEntry: null }));
  const cfg = loadConfig(d);
  expect(cfg.cssEntry).toBeNull();
});

test("resolveCssEntry with cssEntry set anchors to dir and returns joined path", () => {
  const d = dir();
  // Create app/custom.css
  const customDir = join(d, "app");
  require("node:fs").mkdirSync(customDir, { recursive: true });
  writeFileSync(join(customDir, "custom.css"), "/* custom css */");

  const cfg = { figma: { url: "https://www.figma.com/design/ABC/X", fileKey: "ABC" }, naming: "kebab-case" as const, cssEntry: "app/custom.css" };
  const result = resolveCssEntry(d, cfg);
  expect(result).toBe(join(d, "app", "custom.css"));
});

test("resolveCssEntry with missing cssEntry file throws AdhdError", () => {
  const d = dir();
  const cfg = { figma: { url: "https://www.figma.com/design/ABC/X", fileKey: "ABC" }, naming: "kebab-case" as const, cssEntry: "missing.css" };
  expect(() => resolveCssEntry(d, cfg)).toThrow(/cssEntry/);
  try { resolveCssEntry(d, cfg); } catch (e: any) { expect(e.fixup).toContain("missing.css"); }
});

// Tests for loadLock nested shape validation
test("loadLock with figmaIds missing .variables throws AdhdError", () => {
  const d = dir();
  const lock = {
    baseSnapshot: { side: "figma", tokens: [], styles: [] },
    figmaIds: { styles: {} },
    lastSync: { at: "2025-01-01T00:00:00Z", figmaHash: "abc123" }
  };
  writeFileSync(join(d, "adhd.lock.json"), JSON.stringify(lock));
  expect(() => loadLock(d)).toThrowError(AdhdError);
  try { loadLock(d); } catch (e: any) {
    expect(e.message).toContain("adhd.lock.json");
    expect(e.fixup).toContain("Delete adhd.lock.json");
  }
});

test("loadLock with figmaIds missing .styles throws AdhdError", () => {
  const d = dir();
  const lock = {
    baseSnapshot: { side: "figma", tokens: [], styles: [] },
    figmaIds: { variables: {} },
    lastSync: { at: "2025-01-01T00:00:00Z", figmaHash: "abc123" }
  };
  writeFileSync(join(d, "adhd.lock.json"), JSON.stringify(lock));
  expect(() => loadLock(d)).toThrowError(AdhdError);
  try { loadLock(d); } catch (e: any) {
    expect(e.message).toContain("adhd.lock.json");
    expect(e.fixup).toContain("Delete adhd.lock.json");
  }
});

test("loadLock with baseSnapshot missing .tokens throws AdhdError", () => {
  const d = dir();
  const lock = {
    baseSnapshot: { side: "figma", styles: [] },
    figmaIds: { variables: {}, styles: {} },
    lastSync: { at: "2025-01-01T00:00:00Z", figmaHash: "abc123" }
  };
  writeFileSync(join(d, "adhd.lock.json"), JSON.stringify(lock));
  expect(() => loadLock(d)).toThrowError(AdhdError);
  try { loadLock(d); } catch (e: any) {
    expect(e.message).toContain("adhd.lock.json");
    expect(e.fixup).toContain("Delete adhd.lock.json");
  }
});

test("loadLock with baseSnapshot missing .styles throws AdhdError", () => {
  const d = dir();
  const lock = {
    baseSnapshot: { side: "figma", tokens: [] },
    figmaIds: { variables: {}, styles: {} },
    lastSync: { at: "2025-01-01T00:00:00Z", figmaHash: "abc123" }
  };
  writeFileSync(join(d, "adhd.lock.json"), JSON.stringify(lock));
  expect(() => loadLock(d)).toThrowError(AdhdError);
  try { loadLock(d); } catch (e: any) {
    expect(e.message).toContain("adhd.lock.json");
    expect(e.fixup).toContain("Delete adhd.lock.json");
  }
});

test("loadLock with lastSync missing .at throws AdhdError", () => {
  const d = dir();
  const lock = {
    baseSnapshot: { side: "figma", tokens: [], styles: [] },
    figmaIds: { variables: {}, styles: {} },
    lastSync: { figmaHash: "abc123" }
  };
  writeFileSync(join(d, "adhd.lock.json"), JSON.stringify(lock));
  expect(() => loadLock(d)).toThrowError(AdhdError);
  try { loadLock(d); } catch (e: any) {
    expect(e.message).toContain("adhd.lock.json");
    expect(e.fixup).toContain("Delete adhd.lock.json");
  }
});

test("loadLock with lastSync missing .figmaHash throws AdhdError", () => {
  const d = dir();
  const lock = {
    baseSnapshot: { side: "figma", tokens: [], styles: [] },
    figmaIds: { variables: {}, styles: {} },
    lastSync: { at: "2025-01-01T00:00:00Z" }
  };
  writeFileSync(join(d, "adhd.lock.json"), JSON.stringify(lock));
  expect(() => loadLock(d)).toThrowError(AdhdError);
  try { loadLock(d); } catch (e: any) {
    expect(e.message).toContain("adhd.lock.json");
    expect(e.fixup).toContain("Delete adhd.lock.json");
  }
});

test("loadLock with well-formed lock loads successfully", () => {
  const d = dir();
  const lock = {
    baseSnapshot: { side: "figma", tokens: [], styles: [] },
    figmaIds: { variables: {}, styles: {} },
    lastSync: { at: "2025-01-01T00:00:00Z", figmaHash: "abc123" }
  };
  writeFileSync(join(d, "adhd.lock.json"), JSON.stringify(lock));
  const result = loadLock(d);
  expect(result).not.toBeNull();
  expect(result?.baseSnapshot.side).toBe("figma");
  expect(result?.figmaIds.variables).toEqual({});
  expect(result?.figmaIds.styles).toEqual({});
  expect(result?.lastSync.at).toBe("2025-01-01T00:00:00Z");
});
