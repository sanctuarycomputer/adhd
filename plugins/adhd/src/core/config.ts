import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NamingConvention } from "./naming";
import type { Snapshot } from "./tokens";

export class AdhdError extends Error {
  constructor(message: string, public fixup?: string) {
    super(message);
    this.name = "AdhdError";
  }
}

export interface AdhdConfig {
  figma: { url: string; fileKey: string };
  naming: NamingConvention;
  cssEntry: string | null;
}

export interface AdhdLock {
  baseSnapshot: Snapshot;
  figmaIds: { variables: Record<string, string>; styles: Record<string, string> };
  components: Array<{ nodeId: string; path: string }>;
  lastSync: { at: string; figmaHash: string };
}

/**
 * Extract the file key from a Figma URL.
 * Matches URLs like https://www.figma.com/design/ABC123xyz/... or /file/ABC123xyz/...
 * Returns the captured file key or null if the URL doesn't match the expected pattern.
 */
export function fileKeyFromUrl(url: string): string | null {
  const match = url.match(/\/(design|file)\/([A-Za-z0-9]+)/);
  return match ? match[2]! : null;
}

/**
 * Loads and validates adhd.config.json from the given directory.
 * Throws AdhdError with a fixup hint if the config is missing or invalid.
 */
export function loadConfig(dir: string): AdhdConfig {
  const configPath = join(dir, "adhd.config.json");
  let rawData: unknown;

  try {
    const content = readFileSync(configPath, "utf-8");
    rawData = JSON.parse(content);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new AdhdError(
        `adhd.config.json: invalid JSON`,
        "/adhd:config to generate a template"
      );
    }
    throw new AdhdError(
      `adhd.config.json: file not found`,
      "/adhd:config to generate a template"
    );
  }

  // Validate the structure
  if (!rawData || typeof rawData !== "object") {
    throw new AdhdError(
      `adhd.config.json: must be an object`,
      "/adhd:config to generate a template"
    );
  }

  const cfg = rawData as any;

  // Validate figma.url
  if (!cfg.figma || typeof cfg.figma !== "object") {
    throw new AdhdError(
      `adhd.config.json: figma must be an object`,
      "/adhd:config to generate a template"
    );
  }

  if (typeof cfg.figma.url !== "string") {
    throw new AdhdError(
      `adhd.config.json: figma.url must be a string`,
      "/adhd:config to generate a template"
    );
  }

  const fileKey = fileKeyFromUrl(cfg.figma.url);
  if (!fileKey) {
    throw new AdhdError(
      `adhd.config.json: figma.url must be a figma.com/design URL`,
      "/adhd:config to generate a template"
    );
  }

  // Validate and default naming
  let naming: NamingConvention = "kebab-case";
  if (cfg.naming !== undefined) {
    if (!["kebab-case", "PascalCase", "camelCase", false].includes(cfg.naming)) {
      throw new AdhdError(
        `adhd.config.json: naming must be one of "kebab-case", "PascalCase", "camelCase", or false`,
        "/adhd:config to generate a template"
      );
    }
    naming = cfg.naming;
  }

  // Default cssEntry to null
  let cssEntry: string | null = null;
  if (cfg.cssEntry !== undefined) {
    if (typeof cfg.cssEntry !== "string") {
      throw new AdhdError(
        `adhd.config.json: cssEntry must be a string`,
        "/adhd:config to generate a template"
      );
    }
    cssEntry = cfg.cssEntry;
  }

  return {
    figma: { url: cfg.figma.url, fileKey },
    naming,
    cssEntry,
  };
}

/**
 * Resolves the CSS entry file path for the given config.
 * Tries cfg.cssEntry first, then looks for app/globals.css or src/app/globals.css.
 * Throws AdhdError if none are found.
 */
export function resolveCssEntry(dir: string, cfg: AdhdConfig): string {
  // Try cfg.cssEntry first
  if (cfg.cssEntry) {
    return cfg.cssEntry;
  }

  // Try app/globals.css
  const appPath = join(dir, "app", "globals.css");
  try {
    readFileSync(appPath, "utf-8");
    return appPath;
  } catch {
    // not found, try next
  }

  // Try src/app/globals.css
  const srcAppPath = join(dir, "src", "app", "globals.css");
  try {
    readFileSync(srcAppPath, "utf-8");
    return srcAppPath;
  } catch {
    // not found, throw error
  }

  throw new AdhdError(
    `CSS entry not found: tried cfg.cssEntry, app/globals.css, src/app/globals.css`,
    "Set cssEntry in adhd.config.json or create app/globals.css or src/app/globals.css"
  );
}

export { loadLock } from "./lock";
