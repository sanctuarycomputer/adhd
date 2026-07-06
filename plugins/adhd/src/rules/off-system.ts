import { colorsEqual, parseColor } from "../core/color";
import type { Snapshot, Token } from "../core/tokens";

export interface OffSystemFinding {
  file: string;
  line: number;
  snippet: string;
  kind: "arbitrary-class" | "inline-hex";
  nearestToken?: { path: string; exact: boolean };
}

export function scanOffSystem(
  files: Array<{ path: string; content: string }>,
  code: Snapshot
): OffSystemFinding[] {
  const findings: OffSystemFinding[] = [];

  // Build token lookup once from snapshot
  const tokensByColor = new Map<string, { path: string; exact: boolean }>();
  const tokensByDimension = new Map<string, { path: string; exact: boolean }>();

  for (const token of code.tokens) {
    const value = token.values.default;
    if (!value) continue;

    if (token.domain === "color") {
      // Exact match for colors using colorsEqual
      // Also add the normalized form for direct comparison
      tokensByColor.set(value.toLowerCase(), { path: token.path, exact: true });

      // Also check near matches using colorsEqual within epsilon 0.02
      // We'll do near matching during the finding generation
    } else if (token.domain === "spacing" || token.domain === "radius") {
      // For dimensions, normalize to px
      const normalized = normalizeDimension(value);
      if (normalized) {
        tokensByDimension.set(normalized, { path: token.path, exact: true });
      }
    }
  }

  // Regex patterns
  const arbitraryClassRegex = /\b[a-z][a-z-]*-\[([^\]]+)\]/g;
  const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;

  for (const file of files) {
    const lines = file.content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      const lineNumber = lineIdx + 1;

      // Skip lines marked with adhd:off-system
      if (line.includes("adhd:off-system")) {
        continue;
      }

      // Find all arbitrary class matches and their positions
      const arbitraryMatches: Array<{
        match: string;
        value: string;
        start: number;
        end: number;
      }> = [];
      let m;
      while ((m = arbitraryClassRegex.exec(line)) !== null) {
        arbitraryMatches.push({
          match: m[0]!,
          value: m[1]!,
          start: m.index,
          end: m.index + m[0]!.length,
        });
      }

      // Create findings for arbitrary classes
      for (const arbMatch of arbitraryMatches) {
        const nearestToken = findNearestToken(
          arbMatch.value,
          tokensByColor,
          tokensByDimension,
          code.tokens
        );

        findings.push({
          file: file.path,
          line: lineNumber,
          snippet: arbMatch.match,
          kind: "arbitrary-class",
          nearestToken,
        });
      }

      // Find hex matches that are NOT inside arbitrary classes
      const coveredRanges = arbitraryMatches.map((m) => ({ start: m.start, end: m.end }));

      while ((m = hexRegex.exec(line)) !== null) {
        const hexStart = m.index;
        const hexEnd = m.index + m[0]!.length;

        // Check if this hex is inside any arbitrary class
        const isInside = coveredRanges.some((range) => hexStart >= range.start && hexEnd <= range.end);

        if (!isInside) {
          const hexValue = m[0]!;
          const nearestToken = findNearestTokenByColor(
            hexValue,
            tokensByColor,
            code.tokens
          );

          findings.push({
            file: file.path,
            line: lineNumber,
            snippet: hexValue,
            kind: "inline-hex",
            nearestToken,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Parse a dimension value and return normalized px value (as number or string for comparison)
 */
function normalizeDimension(value: string): string | null {
  // Remove 'px' suffix if present
  const trimmed = value.trim();
  const pxMatch = trimmed.match(/^(\d+(?:\.\d+)?)(?:px)?$/);
  if (pxMatch) {
    return pxMatch[1]!; // Return just the number part for comparison
  }
  return null;
}

/**
 * Find the nearest token for a value extracted from an arbitrary class
 */
function findNearestToken(
  value: string,
  tokensByColor: Map<string, { path: string; exact: boolean }>,
  tokensByDimension: Map<string, { path: string; exact: boolean }>,
  tokens: Token[]
): { path: string; exact: boolean } | undefined {
  // Try to parse as color
  const color = parseColor(value);
  if (color) {
    // Check exact matches first
    const exact = findExactColorToken(value, tokens);
    if (exact) {
      return { path: exact, exact: true };
    }

    // Check near matches (within epsilon 0.02)
    const near = findNearColorToken(value, tokens);
    if (near) {
      return { path: near, exact: false };
    }
  }

  // Try to parse as dimension
  const normalized = normalizeDimension(value);
  if (normalized) {
    const token = tokensByDimension.get(normalized);
    if (token) {
      return token;
    }
  }

  return undefined;
}

/**
 * Find the nearest token for a hex color value
 */
function findNearestTokenByColor(
  hexValue: string,
  tokensByColor: Map<string, { path: string; exact: boolean }>,
  tokens: Token[]
): { path: string; exact: boolean } | undefined {
  // Check exact matches first
  const exact = findExactColorToken(hexValue, tokens);
  if (exact) {
    return { path: exact, exact: true };
  }

  // Check near matches (within epsilon 0.02)
  const near = findNearColorToken(hexValue, tokens);
  if (near) {
    return { path: near, exact: false };
  }

  return undefined;
}

/**
 * Find exact color token match using colorsEqual with default epsilon
 */
function findExactColorToken(color: string, tokens: Token[]): string | undefined {
  for (const token of tokens) {
    if (token.domain === "color") {
      const tokenValue = token.values.default;
      if (tokenValue && colorsEqual(color, tokenValue)) {
        return token.path;
      }
    }
  }
  return undefined;
}

/**
 * Find near color token match using colorsEqual with epsilon 0.02
 */
function findNearColorToken(color: string, tokens: Token[]): string | undefined {
  for (const token of tokens) {
    if (token.domain === "color") {
      const tokenValue = token.values.default;
      if (tokenValue && colorsEqual(color, tokenValue, 0.02)) {
        return token.path;
      }
    }
  }
  return undefined;
}
