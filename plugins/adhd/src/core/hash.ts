export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as object).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",") + "}";
}

// Two independent FNV-1a 32-bit passes with different seeds, concatenated to 64 bits
// of output. BigInt-free and Math.imul-based so it runs unchanged in the Figma sandbox;
// collision resistance is ample for drift detection (not a cryptographic use).
function fnv32(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function fnv1a64(s: string): string {
  const a = fnv32(s, 0x811c9dc5);
  const b = fnv32(s, 0x811c9dc5 ^ 0x5bd1e995);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
