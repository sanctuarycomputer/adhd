import type { AdhdLock } from "../core/config";
import { colorsEqual } from "../core/color";
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

function pathSimilar(a: string, b: string): boolean {
  const as = a.split("/");
  const bs = b.split("/");
  const shared = as.filter((s) => bs.includes(s)).length;
  return shared * 2 >= Math.min(as.length, bs.length);
}

function describeValue(t: Token): string {
  if (t.aliasOf && Object.keys(t.aliasOf).length > 0) {
    return Object.entries(t.aliasOf)
      .map(([m, v]) => `${m}: alias(${v})`)
      .join(", ");
  }
  const entries = Object.entries(t.values ?? {});
  return entries.map(([m, v]) => `${m}: ${v}`).join(", ");
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
    } else {
      codeMap.set(key(t), t);
    }
  }
  const figmaMap = new Map<string, Token>();
  for (const t of figma.tokens) {
    if (t.unsyncable) {
      cannotSync.push({ path: t.path, side: "figma", reason: t.unsyncable });
    } else {
      figmaMap.set(key(t), t);
    }
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

    if (codeAlias !== undefined || figmaAlias !== undefined) {
      const aliasIsCode = codeAlias !== undefined;
      const literalVal = aliasIsCode ? figmaVal : codeVal;
      structural.push({
        path: code.path,
        kind: "alias-vs-literal",
        code: aliasIsCode ? codeAlias! : literalVal ?? "(missing)",
        figma: aliasIsCode ? literalVal ?? "(missing)" : figmaAlias!,
        mode,
      });
      continue;
    }

    if (codeVal === undefined && figmaVal === undefined) continue;
    if (codeVal === undefined || figmaVal === undefined) {
      valueDrift.push({
        path: code.path,
        collection: code.collection,
        mode,
        code: codeVal ?? "(missing)",
        figma: figmaVal ?? "(missing)",
      });
      continue;
    }
    if (!valuesEqual(code.domain, codeVal, figmaVal)) {
      valueDrift.push({ path: code.path, collection: code.collection, mode, code: codeVal, figma: figmaVal });
    }
  }
}
