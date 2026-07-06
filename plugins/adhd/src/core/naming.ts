export type NamingConvention = "kebab-case" | "PascalCase" | "camelCase" | false;

// A single path segment: lowercase alnum, hyphen-joined sub-tokens, non-empty.
const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Maps a validated Figma path (e.g. "text/lg/line-height") to its Tailwind v4
 * CSS custom property name (e.g. "--text-lg--line-height").
 *
 * Domain rules (must match cssVarToPath's domain exactly, so the two are
 * mutual inverses):
 *  - segments are lowercase, joined by "/"
 *  - every segment matches SEGMENT_RE (non-empty, no "/", no "--")
 *  - the first segment must be hyphen-free (it's the domain namespace)
 *  - only the final segment may contain hyphens (Tailwind companion keys,
 *    e.g. "line-height", are always the final segment)
 *
 * Returns null (never throws) if the path violates the domain.
 */
export function pathToCssVar(path: string): string | null {
  const segments = path.split("/");
  if (segments.some((s) => s.length === 0)) return null;
  if (!segments.every((s) => SEGMENT_RE.test(s))) return null;
  // Only the final segment may contain a hyphen; every earlier segment
  // (including the first, whether or not it's the only one) must be
  // hyphen-free — it's a domain namespace, never a companion key.
  if (segments.slice(0, -1).some((s) => s.includes("-"))) return null;
  // segments.length === 1 guarantees index 0 exists.
  if (segments.length === 1 && segments[0]!.includes("-")) return null;

  // String.split always returns a non-empty array, so the last index is
  // always in bounds.
  const last = segments[segments.length - 1]!;
  const head = segments.slice(0, -1);
  const joiner = last.includes("-") ? "--" : "-";
  if (head.length === 0) return "--" + last;
  return "--" + head.join("-") + joiner + last;
}

/**
 * Inverse of pathToCssVar. Maps a Tailwind v4 CSS custom property name back
 * to its Figma path. Returns null (never throws) if the input is outside the
 * validated domain.
 */
export function cssVarToPath(cssVar: string): string | null {
  if (!cssVar.startsWith("--")) return null;
  const rest = cssVar.slice(2);

  const parts = rest.split("--");
  if (parts.length !== 1 && parts.length !== 2) return null;

  // parts.length is checked to be 1 or 2 above, so index 0 always exists.
  const base = parts[0]!;
  const companion = parts[1];
  if (base.length === 0) return null;
  const baseSegments = base.split("-");
  if (baseSegments.some((s) => !/^[a-z0-9]+$/.test(s))) return null;

  if (companion === undefined) {
    return baseSegments.join("/");
  }

  // The companion part is only in-domain if it is itself hyphenated
  // (e.g. "line-height"); "--a--b" (non-hyphenated companion) is
  // unrecoverable — it's ambiguous with a plain "-" join — so reject it.
  if (!companion.includes("-")) return null;
  if (!SEGMENT_RE.test(companion)) return null;

  return [...baseSegments, companion].join("/");
}

export function caseMatches(name: string, convention: NamingConvention): boolean {
  if (convention === false) return true;
  if (convention === "kebab-case") return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
  if (convention === "PascalCase") return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  if (convention === "camelCase") return /^[a-z][a-zA-Z0-9]*$/.test(name);
  return true;
}
