import type { AdhdLock } from "../core/config";
import { colorsEqual, parseColor } from "../core/color";
import type { Domain, Snapshot, Token } from "../core/tokens";

export interface Drift {
  valueDrift: Array<{ path: string; collection: string; mode: string; code: string; figma: string }>;
  existence: Array<{ path: string; collection: string; onlyIn: "code" | "figma"; value: string }>;
  structural: Array<{ path: string; kind: "alias-vs-literal" | "alias-target-differs"; code: string; figma: string; mode: string }>;
  renames: Array<{ from: string; to: string; confidence: "definite" | "probable"; side: "figma" }>;
  cannotSync: Array<{ path: string; side: "code" | "figma"; reason: string }>;
}

export interface DiffOpts {
  lock: AdhdLock | null;
  figmaIds: Record<string, string> | null;
}

// --- value comparators -----------------------------------------------------

// Parses a dimension string ("8px", "8", "0.5rem") into a px-equivalent number.
// Returns null for anything that isn't a bare number+unit (shadows, calc(), etc.
// fall through to exact-string comparison upstream).
function parseDimensionPx(s: string): number | null {
  const m = s.trim().match(/^(-?[0-9]*\.?[0-9]+)(px|rem)?$/);
  if (!m) return null;
  const num = parseFloat(m[1]!);
  const unit = m[2] ?? "";
  if (unit === "rem") return num * 16;
  return num; // "px" or unitless — both treated as raw px
}

// Local, deliberately narrow dimension-equivalence check: px / rem@16 / unitless-px
// are unified; anything else (shadows, multi-part strings) falls back to exact string.
function dimensionsEqual(a: string, b: string): boolean {
  const pa = parseDimensionPx(a);
  const pb = parseDimensionPx(b);
  if (pa !== null && pb !== null) return Math.abs(pa - pb) < 1e-6;
  return a === b;
}

function valuesEqual(domain: Domain, a: string, b: string): boolean {
  if (a === b) return true;
  if (domain === "color") return colorsEqual(a, b);
  if (domain === "spacing" || domain === "radius") return dimensionsEqual(a, b);
  // Domain classification is path-based (domainOf), so bare semantic names
  // like "background"/"foreground" land in "other" even though their values
  // are colors (e.g. code oklch(1 0 0) vs figma #ffffff). Fall back to a
  // tolerant color comparison whenever both sides actually parse as colors,
  // regardless of what domain the path was classified into.
  if (parseColor(a) && parseColor(b)) return colorsEqual(a, b);
  return false;
}

// "Do these two tokens look like the same underlying value?" — used by the
// probable-rename heuristic, which must compare every mode present on either side.
function tokensLookEqual(domain: Domain, a: Token, b: Token): boolean {
  const modes = new Set([...Object.keys(a.values ?? {}), ...Object.keys(b.values ?? {})]);
  if (modes.size === 0) return false;
  for (const m of modes) {
    const av = a.values?.[m as keyof Token["values"]];
    const bv = b.values?.[m as keyof Token["values"]];
    if (av === undefined || bv === undefined) return false;
    if (!valuesEqual(domain, av, bv)) return false;
  }
  return true;
}

// Positional segment comparison: paths must have equal segment count and
// differ in at most one segment (i.e. share all-but-one segment). For a
// single differing segment this only clears the bar once there are more than
// two segments total — two 2-segment paths that merely share one segment
// (e.g. "color/black" vs "color/ink") share only exactly half, which is
// "merely half" and must NOT count as similar; a 3+-segment path differing
// in just its last segment shares a strict majority and does.
function pathSimilar(a: string, b: string): boolean {
  const as = a.split("/");
  const bs = b.split("/");
  if (as.length !== bs.length) return false;
  let diff = 0;
  for (let i = 0; i < as.length; i++) {
    if (as[i] !== bs[i]) diff++;
  }
  if (diff > 1) return false;
  return (as.length - diff) * 2 > as.length;
}

// Renders every mode present on the token (via values and/or aliasOf), so a
// token that's aliased in some modes but literal in others shows both —
// never silently drops the literal-mode values in favor of alias-only modes.
function describeValue(t: Token): string {
  const modes = new Set<string>([...Object.keys(t.values ?? {}), ...Object.keys(t.aliasOf ?? {})]);
  return Array.from(modes)
    .map((m) => {
      const aliasTarget = t.aliasOf?.[m as keyof Token["values"]];
      if (aliasTarget !== undefined) return `${m}: alias(${aliasTarget})`;
      return `${m}: ${t.values?.[m as keyof Token["values"]]}`;
    })
    .join(", ");
}

const key = (t: Token) => `${t.collection}:${t.path}`;

// --- main entry point --------------------------------------------------------

export function diffSnapshots(code: Snapshot, figma: Snapshot, opts: DiffOpts): Drift {
  const valueDrift: Drift["valueDrift"] = [];
  const structural: Drift["structural"] = [];
  const cannotSync: Drift["cannotSync"] = [];

  // Unsyncable tokens (either side) are pulled out before any matching happens —
  // they never participate in existence/value/structural diffing, only cannotSync.
  const codeMap = new Map<string, Token>();
  for (const t of code.tokens) {
    if (t.unsyncable) {
      cannotSync.push({ path: t.path, side: "code", reason: t.unsyncable });
      continue;
    }
    const k = key(t);
    if (codeMap.has(k)) {
      cannotSync.push({
        path: t.path,
        side: "code",
        reason: `duplicate token key '${k}' — check for duplicate collection names or paths`,
      });
      continue;
    }
    codeMap.set(k, t);
  }
  const figmaMap = new Map<string, Token>();
  for (const t of figma.tokens) {
    if (t.unsyncable) {
      cannotSync.push({ path: t.path, side: "figma", reason: t.unsyncable });
      continue;
    }
    const k = key(t);
    if (figmaMap.has(k)) {
      cannotSync.push({
        path: t.path,
        side: "figma",
        reason: `duplicate token key '${k}' — check for duplicate collection names or paths`,
      });
      continue;
    }
    figmaMap.set(k, t);
  }

  // existence records for keys that only appear on one side; kept as live
  // objects (not the final Drift shape) so the rename passes below can
  // consume/remove pairs before we render the final `existence` array.
  type ExistRecord = { token: Token; side: "code" | "figma" };
  const existRecords: ExistRecord[] = [];

  for (const [k, codeTok] of codeMap) {
    const figmaTok = figmaMap.get(k);
    if (!figmaTok) {
      existRecords.push({ token: codeTok, side: "code" });
      continue;
    }
    diffMatchedPair(codeTok, figmaTok, valueDrift, structural);
  }
  for (const [k, figmaTok] of figmaMap) {
    if (!codeMap.has(k)) existRecords.push({ token: figmaTok, side: "figma" });
  }

  const renames: Drift["renames"] = [];

  // Definite renames: driven by the lock's recorded Figma variable IDs. If an
  // ID's lock-time path differs from its current path, that's a hard rename —
  // remove the corresponding existence-only entries on both sides.
  if (opts.lock && opts.figmaIds) {
    const lockVars = opts.lock.figmaIds.variables;
    for (const [id, lockPath] of Object.entries(lockVars)) {
      const currentPath = opts.figmaIds[id];
      if (currentPath === undefined || currentPath === lockPath) continue;

      const fromIdx = existRecords.findIndex((r) => r.side === "code" && r.token.path === lockPath);
      const toIdx = existRecords.findIndex((r) => r.side === "figma" && r.token.path === currentPath);
      if (fromIdx === -1 || toIdx === -1) continue;

      renames.push({ from: lockPath, to: currentPath, confidence: "definite", side: "figma" });
      // Remove higher index first so the other index stays valid.
      const [i1, i2] = fromIdx < toIdx ? [toIdx, fromIdx] : [fromIdx, toIdx];
      existRecords.splice(i1, 1);
      existRecords.splice(i2, 1);
    }
  }

  // Probable renames: only attempted when there's no lock to consult. Greedy
  // pairing of remaining code-only/figma-only existence records that share a
  // collection+domain, have equal values, and similar-enough paths.
  if (!opts.lock) {
    const codeOnly = existRecords.filter((r) => r.side === "code");
    const consumed = new Set<ExistRecord>();
    for (const cRec of codeOnly) {
      const match = existRecords.find(
        (fRec) =>
          fRec.side === "figma" &&
          !consumed.has(fRec) &&
          fRec.token.collection === cRec.token.collection &&
          fRec.token.domain === cRec.token.domain &&
          tokensLookEqual(cRec.token.domain, cRec.token, fRec.token) &&
          pathSimilar(cRec.token.path, fRec.token.path)
      );
      if (match) {
        consumed.add(cRec);
        consumed.add(match);
        renames.push({ from: cRec.token.path, to: match.token.path, confidence: "probable", side: "figma" });
      }
    }
    for (let i = existRecords.length - 1; i >= 0; i--) {
      if (consumed.has(existRecords[i]!)) existRecords.splice(i, 1);
    }
  }

  const existence: Drift["existence"] = existRecords.map((r) => ({
    path: r.token.path,
    collection: r.token.collection,
    onlyIn: r.side,
    value: describeValue(r.token),
  }));

  return { valueDrift, existence, structural, renames, cannotSync };
}

// Diffs a single matched (same collection+path) pair across every mode present
// on either side, handling alias-vs-literal / alias-target-differs structural
// drift and falling back to value comparison (with "(missing)" rendering for
// modes present on only one side) otherwise.
function diffMatchedPair(
  code: Token,
  figma: Token,
  valueDrift: Drift["valueDrift"],
  structural: Drift["structural"]
): void {
  const modes = new Set<string>([
    ...Object.keys(code.values ?? {}),
    ...Object.keys(figma.values ?? {}),
    ...Object.keys(code.aliasOf ?? {}),
    ...Object.keys(figma.aliasOf ?? {}),
  ]);

  for (const mode of modes) {
    const codeAlias = code.aliasOf?.[mode as keyof Token["values"]];
    const figmaAlias = figma.aliasOf?.[mode as keyof Token["values"]];
    const codeVal = code.values?.[mode as keyof Token["values"]];
    const figmaVal = figma.values?.[mode as keyof Token["values"]];

    if (codeAlias !== undefined && figmaAlias !== undefined) {
      if (codeAlias !== figmaAlias) {
        structural.push({ path: code.path, kind: "alias-target-differs", code: codeAlias, figma: figmaAlias, mode });
      }
      continue;
    }

    // Alias-vs-literal only applies when the non-aliased side actually has a
    // literal value for this mode. When the other side has neither a value
    // nor an alias, the mode is wholly missing there — fall through to the
    // missing-mode valueDrift path below instead of misreporting a structural
    // alias-vs-literal drift against a side that has nothing at all for this mode.
    if (codeAlias !== undefined && figmaVal !== undefined) {
      structural.push({ path: code.path, kind: "alias-vs-literal", code: codeAlias, figma: figmaVal, mode });
      continue;
    }
    if (figmaAlias !== undefined && codeVal !== undefined) {
      structural.push({ path: code.path, kind: "alias-vs-literal", code: codeVal, figma: figmaAlias, mode });
      continue;
    }

    // Prefer describing an alias target over a resolved literal when
    // rendering a side below — an aliased token's `values` entry is just a
    // resolved artifact of the alias, not the "real" value being compared.
    const codeRendered = codeAlias !== undefined ? `alias(${codeAlias})` : codeVal;
    const figmaRendered = figmaAlias !== undefined ? `alias(${figmaAlias})` : figmaVal;

    if (codeRendered === undefined && figmaRendered === undefined) continue;
    if (codeRendered === undefined || figmaRendered === undefined) {
      valueDrift.push({
        path: code.path,
        collection: code.collection,
        mode,
        code: codeRendered ?? "(missing)",
        figma: figmaRendered ?? "(missing)",
      });
      continue;
    }
    if (!valuesEqual(code.domain, codeRendered, figmaRendered)) {
      valueDrift.push({ path: code.path, collection: code.collection, mode, code: codeRendered, figma: figmaRendered });
    }
  }
}
