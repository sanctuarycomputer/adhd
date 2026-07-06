import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdhdError, type AdhdLock } from "./config";

/**
 * Loads and validates adhd.lock.json from the given directory.
 * Returns null if the lock file doesn't exist.
 * Throws AdhdError if the lock file exists but is corrupt or invalid.
 */
export function loadLock(dir: string): AdhdLock | null {
  const lockPath = join(dir, "adhd.lock.json");

  // Check if file exists
  let content: string;
  try {
    content = readFileSync(lockPath, "utf-8");
  } catch (e) {
    // Only return null for genuine "file not found"
    if (e instanceof Error && "code" in e && e.code === "ENOENT") {
      return null;
    }
    // For other IO errors (EACCES, EISDIR, etc), throw AdhdError
    const errorCode = e instanceof Error && "code" in e ? String(e.code) : "UNKNOWN";
    throw new AdhdError(
      `adhd.lock.json: could not read (${errorCode})`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  // Try to parse JSON
  let rawData: unknown;
  try {
    rawData = JSON.parse(content);
  } catch {
    throw new AdhdError(
      `adhd.lock.json: invalid JSON`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  // Validate the structure
  if (!rawData || typeof rawData !== "object") {
    throw new AdhdError(
      `adhd.lock.json: must be an object`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  const lock = rawData as any;

  // Presence-check required fields
  if (!lock.baseSnapshot) {
    throw new AdhdError(
      `adhd.lock.json: baseSnapshot is required`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (!lock.figmaIds) {
    throw new AdhdError(
      `adhd.lock.json: figmaIds is required`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (!lock.lastSync) {
    throw new AdhdError(
      `adhd.lock.json: lastSync is required`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  // Validate nested shape
  // figmaIds structure
  if (typeof lock.figmaIds !== "object" || lock.figmaIds === null) {
    throw new AdhdError(
      `adhd.lock.json: figmaIds must be an object`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (typeof lock.figmaIds.variables !== "object" || lock.figmaIds.variables === null) {
    throw new AdhdError(
      `adhd.lock.json: figmaIds.variables must be an object`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (typeof lock.figmaIds.styles !== "object" || lock.figmaIds.styles === null) {
    throw new AdhdError(
      `adhd.lock.json: figmaIds.styles must be an object`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  // baseSnapshot structure
  if (typeof lock.baseSnapshot !== "object" || lock.baseSnapshot === null) {
    throw new AdhdError(
      `adhd.lock.json: baseSnapshot must be an object`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (!["code", "figma"].includes(lock.baseSnapshot.side)) {
    throw new AdhdError(
      `adhd.lock.json: baseSnapshot.side must be "code" or "figma"`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (!Array.isArray(lock.baseSnapshot.tokens)) {
    throw new AdhdError(
      `adhd.lock.json: baseSnapshot.tokens must be an array`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (!Array.isArray(lock.baseSnapshot.styles)) {
    throw new AdhdError(
      `adhd.lock.json: baseSnapshot.styles must be an array`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  // lastSync structure
  if (typeof lock.lastSync !== "object" || lock.lastSync === null) {
    throw new AdhdError(
      `adhd.lock.json: lastSync must be an object`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (typeof lock.lastSync.at !== "string") {
    throw new AdhdError(
      `adhd.lock.json: lastSync.at must be a string`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  if (typeof lock.lastSync.figmaHash !== "string") {
    throw new AdhdError(
      `adhd.lock.json: lastSync.figmaHash must be a string`,
      "Delete adhd.lock.json and re-sync"
    );
  }

  return lock as AdhdLock;
}
