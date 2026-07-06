import { parseColor, type Rgba } from "../core/color";
import type { Snapshot, Token } from "../core/tokens";

export interface OffSystemFinding {
  file: string;
  line: number;
  snippet: string;
  kind: "arbitrary-class" | "inline-hex";
  nearestToken?: { path: string; exact: boolean };
}

interface ColorTokenEntry {
  path: string;
  rgba: Rgba;
}

interface DimensionTokenEntry {
  path: string;
  px: number;
}

export function scanOffSystem(
  files: Array<{ path: string; content: string }>,
  code: Snapshot
): OffSystemFinding[] {
  const findings: OffSystemFinding[] = [];

  // Precompute parsed token forms ONCE — colors parsed to Rgba, dimensions
  // parsed to a px number — so per-match lookups never re-parse token values.
  const colorTokens: ColorTokenEntry[] = [];
  const dimensionTokens: DimensionTokenEntry[] = [];

  for (const token of code.tokens) {
    const value = token.values.default;
    if (!value) continue;

    if (token.domain === "color") {
      const rgba = parseColor(value);
      if (rgba) colorTokens.push({ path: token.path, rgba });
    } else if (token.domain === "spacing" || token.domain === "radius") {
      const px = normalizeDimension(value);
      if (px !== null) dimensionTokens.push({ path: token.path, px });
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
        const nearestToken = findNearestToken(arbMatch.value, colorTokens, dimensionTokens);

        findings.push({
          file: file.path,
          line: lineNumber,
          snippet: arbMatch.match,
          kind: "arbitrary-class",
          nearestToken,
        });
      }

      // Standalone hex is scanned ONLY inside string-literal spans on the
      // line (spec §6: matching hex anywhere — comments, JSX braces, URLs —
      // is a false-positive swamp). This is a line-local heuristic: it does
      // not track multi-line template literals, which are out of scope.
      const stringSpans = computeStringSpans(line);
      const coveredRanges = arbitraryMatches.map((m) => ({ start: m.start, end: m.end }));

      while ((m = hexRegex.exec(line)) !== null) {
        const hexStart = m.index;
        const hexEnd = m.index + m[0]!.length;

        const isInsideArbitraryClass = coveredRanges.some(
          (range) => hexStart >= range.start && hexEnd <= range.end
        );
        const isInsideString = stringSpans.some(
          (span) => hexStart >= span.start && hexEnd <= span.end
        );

        if (!isInsideArbitraryClass && isInsideString) {
          const hexValue = m[0]!;
          const nearestToken = findNearestToken(hexValue, colorTokens, dimensionTokens);

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
 * Compute the [start, end) spans of string literals on a single line, for
 * `'...'`, `"..."`, and `` `...` `` spans. This is a line-local heuristic:
 * it skips `\"` / `\'` escapes but does not otherwise validate escaping, and
 * it does not attempt to track template literals that span multiple lines
 * (an unterminated span at end-of-line is simply dropped).
 */
function computeStringSpans(line: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let quoteChar: string | null = null;
  let spanStart = -1;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (quoteChar) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quoteChar) {
        spans.push({ start: spanStart, end: i + 1 });
        quoteChar = null;
      }
      i++;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") {
        quoteChar = ch;
        spanStart = i;
      }
      i++;
    }
  }

  return spans;
}

/**
 * Parse a dimension value and return its normalized px number, or null if it
 * isn't a plain (unit-less or px) number.
 */
function normalizeDimension(value: string): number | null {
  const trimmed = value.trim();
  const pxMatch = trimmed.match(/^(\d+(?:\.\d+)?)(?:px)?$/);
  if (pxMatch) {
    return Number(pxMatch[1]);
  }
  return null;
}

/**
 * Find the nearest precomputed token for a raw value (from an arbitrary
 * class or a standalone hex match). Colors and dimensions are mutually
 * exclusive kinds of value, so a successful color parse returns immediately
 * — there is no fallthrough from color into dimension matching.
 */
function findNearestToken(
  value: string,
  colorTokens: ColorTokenEntry[],
  dimensionTokens: DimensionTokenEntry[]
): { path: string; exact: boolean } | undefined {
  const rgba = parseColor(value);
  if (rgba) {
    return matchColorToken(rgba, colorTokens);
  }

  const px = normalizeDimension(value);
  if (px !== null) {
    const dimensionToken = dimensionTokens.find((t) => t.px === px);
    if (dimensionToken) {
      return { path: dimensionToken.path, exact: true };
    }
  }

  return undefined;
}

/**
 * Match a parsed color against precomputed color tokens: exact first
 * (epsilon 0.004), then near (epsilon 0.02). Never re-parses token values —
 * both sides of the comparison are already-parsed Rgba.
 */
function matchColorToken(
  rgba: Rgba,
  colorTokens: ColorTokenEntry[]
): { path: string; exact: boolean } | undefined {
  const exact = colorTokens.find((t) => rgbaClose(rgba, t.rgba, 0.004));
  if (exact) {
    return { path: exact.path, exact: true };
  }

  const near = colorTokens.find((t) => rgbaClose(rgba, t.rgba, 0.02));
  if (near) {
    return { path: near.path, exact: false };
  }

  return undefined;
}

/** Component-wise closeness check between two already-parsed colors. */
function rgbaClose(a: Rgba, b: Rgba, eps: number): boolean {
  return (
    Math.abs(a.r - b.r) <= eps &&
    Math.abs(a.g - b.g) <= eps &&
    Math.abs(a.b - b.b) <= eps &&
    Math.abs(a.a - b.a) <= eps
  );
}
