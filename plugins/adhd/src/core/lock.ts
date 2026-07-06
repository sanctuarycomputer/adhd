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
    // File doesn't exist, return null
    return null;
  }

  // Try to parse JSON
  let rawData: unknown;
  try {
    rawData = JSON.parse(content);
  } catch (e) {
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

  return lock as AdhdLock;
}
