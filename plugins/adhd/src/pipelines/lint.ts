import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { AdhdError, loadConfig, loadLock, resolveCssEntry, fileKeyFromUrl } from "../core/config";
import type { Snapshot } from "../core/tokens";
import { parseCssSnapshot } from "../core/css";
import { assembleChunks, figmaPayloadToSnapshot } from "../figma/payload";
import type { ExtractChunk } from "../figma/extract";
import { checkStructure, type FigmaNode, type Violation } from "../rules/struct";
import { scanOffSystem } from "../rules/off-system";
import { diffSnapshots } from "./diff";
import type { LintResult } from "./report";

export interface RunLintOpts {
  dir: string;
  chunksDir?: string;
  offline: boolean;
  scopeUrl?: string;
}

const CHUNKS_DIR_FIXUP =
  "check that --figma-chunks points at a directory of valid chunk JSON files saved from use_figma responses";

/**
 * Reads every `*.json` file directly inside `chunksDir`, sorted by filename
 * (the CLI writes/expects them as 00.json, 01.json, … so lexical sort is
 * chunk order), and parses each as raw JSON. Kept untyped (`any`) at this
 * stage — rather than `ExtractChunk[]` — because a chunk MAY carry a
 * `nodeTree` field that `ExtractChunk` doesn't declare (M1's extract script
 * never produces one; this is forward wiring for M2's scoped lint). Reading
 * generically lets us pull `nodeTree` out before handing the array to
 * `assembleChunks`, which only cares about the fields it already knows about.
 */
function readChunks(chunksDir: string): any[] {
  let entries: string[];
  try {
    entries = readdirSync(chunksDir);
  } catch (e: any) {
    throw new AdhdError(
      `--figma-chunks: could not read directory ${chunksDir} (${e.code ?? e.message})`,
      CHUNKS_DIR_FIXUP
    );
  }

  const files = entries.filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new AdhdError(`--figma-chunks: no chunk files found in ${chunksDir}`, CHUNKS_DIR_FIXUP);
  }

  return files.map((f) => {
    const filePath = join(chunksDir, f);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (e: any) {
      throw new AdhdError(`--figma-chunks: could not read ${filePath} (${e.code ?? e.message})`, CHUNKS_DIR_FIXUP);
    }
    try {
      return JSON.parse(raw);
    } catch (e: any) {
      throw new AdhdError(`--figma-chunks: ${filePath} is not valid JSON (${e.message})`, CHUNKS_DIR_FIXUP);
    }
  });
}

/**
 * `git ls-files` scoped to the consumer dir, restricted to *.tsx/*.jsx. Never
 * throws: if git isn't available or `dir` isn't (yet) a repo, off-system
 * scanning degrades to "no files found" rather than crashing the whole lint
 * run over an unrelated tooling gap.
 */
function listTsxJsxFiles(dir: string): string[] {
  const result = spawnSync("git", ["ls-files", "--", "*.tsx", "*.jsx"], {
    cwd: dir,
    encoding: "utf-8",
  });
  if (result.error || result.status !== 0) {
    console.error(`✗ git ls-files failed in ${dir}; off-system scan will be empty (not a git repo?)`);
    return [];
  }
  return result.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Extracts the `node-id` query param from a Figma URL, e.g.
// "https://www.figma.com/design/ABC/File?node-id=1-2" -> "1-2".
function nodeIdFromUrl(url: string): string | null {
  const m = url.match(/[?&]node-id=([^&]+)/);
  return m ? m[1]! : null;
}

export async function runLint(opts: RunLintOpts): Promise<LintResult> {
  if (opts.chunksDir && opts.offline) {
    throw new AdhdError(
      "runLint: --figma-chunks and --offline are mutually exclusive",
      "pass exactly one of chunksDir or offline"
    );
  }
  if (!opts.chunksDir && !opts.offline) {
    throw new AdhdError(
      "runLint: one of --figma-chunks or --offline is required",
      "pass --figma-chunks <dir> for a live extraction, or --offline to compare against adhd.lock.json"
    );
  }

  const cfg = loadConfig(opts.dir);
  const lock = loadLock(opts.dir);

  const cssPath = resolveCssEntry(opts.dir, cfg);
  const codeSnapshot = parseCssSnapshot(readFileSync(cssPath, "utf-8"));

  // --scope validation: the URL must point at the SAME Figma file this
  // consumer is configured against. Mismatch is an operational failure, not
  // a lint finding — showing both keys so the fixup is unambiguous.
  let target = "whole file";
  let targetUrl: string | null = null;
  if (opts.scopeUrl) {
    const scopeKey = fileKeyFromUrl(opts.scopeUrl);
    if (!scopeKey || scopeKey !== cfg.figma.fileKey) {
      throw new AdhdError(
        `--scope file key (${scopeKey ?? "none"}) does not match adhd.config.json's figma.fileKey (${cfg.figma.fileKey})`,
        "pass a --scope URL from the same Figma file configured in adhd.config.json"
      );
    }
    targetUrl = opts.scopeUrl;
    const nodeId = nodeIdFromUrl(opts.scopeUrl);
    if (nodeId) target = nodeId;
  }

  let figmaSnapshot: Snapshot;
  let figmaIds: Record<string, string> | null = null;
  let violations: Violation[] = [];
  let mode: "live" | "offline";

  if (opts.offline) {
    mode = "offline";
    if (!lock) {
      throw new AdhdError(
        "adhd lint --offline: no adhd.lock.json found",
        "run a first sync or provide --figma-chunks"
      );
    }
    figmaSnapshot = lock.baseSnapshot;
  } else {
    mode = "live";
    const rawChunks = readChunks(opts.chunksDir!);
    const nodeTreeChunk = rawChunks.find((c) => c && c.nodeTree);

    let payload;
    try {
      payload = assembleChunks(rawChunks as ExtractChunk[]);
    } catch (e) {
      if (e instanceof AdhdError && !e.fixup) {
        e.fixup =
          "chunks are read in filename order — name them zero-padded (chunk-00.json, chunk-01.json, ...) in the order use_figma returned them";
      }
      throw e;
    }
    const built = figmaPayloadToSnapshot(payload);
    figmaSnapshot = built.snapshot;
    figmaIds = built.ids;

    if (nodeTreeChunk) {
      violations = checkStructure(nodeTreeChunk.nodeTree as FigmaNode, {
        fileKey: cfg.figma.fileKey,
        naming: cfg.naming,
      });
    }
  }

  const drift = diffSnapshots(codeSnapshot, figmaSnapshot, { lock, figmaIds });

  const offSystemFiles: Array<{ path: string; content: string }> = [];
  for (const p of listTsxJsxFiles(opts.dir)) {
    try {
      offSystemFiles.push({ path: p, content: readFileSync(join(opts.dir, p), "utf-8") });
    } catch (e: any) {
      console.error(`✗ could not read ${p} (${e.code ?? e.message}); skipping from off-system scan`);
    }
  }
  const offSystem = scanOffSystem(offSystemFiles, codeSnapshot);

  return {
    violations,
    drift,
    offSystem,
    meta: { target, targetUrl, mode, lockPresent: lock !== null },
  };
}
