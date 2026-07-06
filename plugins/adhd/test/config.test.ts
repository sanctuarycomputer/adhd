import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadConfig, fileKeyFromUrl, loadLock, AdhdError, resolveCssEntry } from "../src/core/config";

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
