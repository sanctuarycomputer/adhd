import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadConfig, fileKeyFromUrl, loadLock, AdhdError } from "../src/core/config";

const dir = () => mkdtempSync(join(tmpdir(), "adhd-"));

test("loads and validates a good config, derives fileKey, defaults naming", () => {
  const d = dir();
  writeFileSync(join(d, "adhd.config.json"), JSON.stringify({ figma: { url: "https://www.figma.com/design/ABC123xyz/My-File" } }));
  const cfg = loadConfig(d);
  expect(cfg.figma.fileKey).toBe("ABC123xyz");
  expect(cfg.naming).toBe("kebab-case");
});

test("missing config throws AdhdError with the /adhd:config fixup", () => {
  expect(() => loadConfig(dir())).toThrowError(AdhdError);
  try { loadConfig(dir()); } catch (e: any) { expect(e.fixup).toContain("/adhd:config"); }
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
