import { stableStringify, fnv1a64 } from "./hash";
import type { Snapshot } from "./tokens";

export function canonicalize(s: Snapshot): Snapshot {
  const key = (t: { collection: string; path: string }) => `${t.collection}/${t.path}`;
  return {
    side: s.side,
    tokens: [...s.tokens].sort((a, b) => key(a).localeCompare(key(b))),
    styles: [...s.styles].sort((a, b) => `${a.kind}${a.name}`.localeCompare(`${b.kind}${b.name}`)),
  };
}

export function contentHash(s: Snapshot): string {
  return fnv1a64(stableStringify(canonicalize(s)));
}
