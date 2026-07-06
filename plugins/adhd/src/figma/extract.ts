import { fnv1a64, stableStringify } from "../core/hash";

// This module is bundled verbatim (via extract-entry.ts) into a `platform: neutral`
// esbuild output that runs inside the Figma plugin sandbox — NOT Node. It must not
// import anything beyond core/hash (also Figma-runtime-safe by construction) and must
// not assume any Node globals (Buffer, process, etc). Cursor encoding below is a
// hand-rolled base64 for exactly this reason: we can't rely on Buffer, and we'd
// rather not gamble on atob/btoa being present in the sandbox.

export type FigmaLike = {
  variables: {
    getLocalVariableCollectionsAsync(): Promise<any[]>;
    getVariableByIdAsync(id: string): Promise<any>;
  };
  getLocalTextStylesAsync(): Promise<any[]>;
  getLocalEffectStylesAsync(): Promise<any[]>;
};

export interface ExtractArgs {
  cursor?: string | null;
  chunkSize?: number; // default 30 variables
}

export interface SerializedMode {
  modeId: string;
  name: string;
}

export interface SerializedVariable {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
}

export interface SerializedCollection {
  id: string;
  name: string;
  modes: SerializedMode[];
  variables: SerializedVariable[];
}

export interface SerializedStyle {
  id: string;
  name: string;
  boundPrimitiveIds?: string[];
}

// The fully-reassembled shape a CLI-side consumer builds out of all chunks. Defined
// here (rather than in payload.ts) because extract.ts's final-chunk hash pass needs to
// serialize this exact same shape — payload.ts imports the type from here, not the
// other way around, to keep this file free of any CLI/Node-side imports.
export interface FigmaPayload {
  collections: SerializedCollection[];
  textStyles: SerializedStyle[];
  effectStyles: SerializedStyle[];
}

export interface ExtractChunk {
  done: boolean;
  cursor: string | null;
  hash: string | null; // only non-null on the final chunk
  collections?: SerializedCollection[];
  textStyles?: SerializedStyle[];
  effectStyles?: SerializedStyle[];
}

const DEFAULT_CHUNK_SIZE = 30;

// --- cursor codec -----------------------------------------------------------
// cursor = base64 of the decimal offset string. Hand-rolled (no Buffer/atob/btoa
// dependency) so this runs unchanged in Node (tests) and the Figma sandbox (prod).

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64_CHARS[b2 & 0x3f];
  }
  return out;
}

function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = B64_CHARS.indexOf(ch);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

function encodeCursor(offset: number): string {
  const s = String(offset);
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  return bytesToBase64(bytes);
}

export function decodeCursor(cursor: string): number {
  const bytes = base64ToBytes(cursor);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new Error(`extract: invalid cursor "${cursor}"`);
  return n;
}

// --- serialization -----------------------------------------------------------

async function serializeVariable(figma: FigmaLike, id: string): Promise<SerializedVariable> {
  const v = await figma.variables.getVariableByIdAsync(id);
  if (!v) throw new Error(`extract: variable not found for id ${id}`);
  return { id: v.id, name: v.name, resolvedType: v.resolvedType, valuesByMode: v.valuesByMode };
}

function serializeStyle(s: any): SerializedStyle {
  return { id: s.id, name: s.name, boundPrimitiveIds: s.boundPrimitiveIds ?? [] };
}

interface CollectionMeta {
  id: string;
  name: string;
  modes: SerializedMode[];
  variableIds: string[];
}

interface FlatRef {
  collectionIndex: number;
  variableId: string;
}

async function readDocShape(figma: FigmaLike): Promise<{ collectionsMeta: CollectionMeta[]; flat: FlatRef[] }> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionsMeta: CollectionMeta[] = collections.map((c: any) => ({
    id: c.id,
    name: c.name,
    modes: c.modes,
    variableIds: c.variableIds,
  }));
  const flat: FlatRef[] = [];
  collectionsMeta.forEach((c, collectionIndex) => {
    for (const variableId of c.variableIds) flat.push({ collectionIndex, variableId });
  });
  return { collectionsMeta, flat };
}

/**
 * Stateless, cursor-chunked extraction. Each call is a self-contained pass over the
 * document — nothing is remembered between calls (the Figma script host may not keep
 * this module's state alive between invocations). Every call re-lists collections and
 * re-walks up to `chunkSize` variables starting at `cursor`'s offset.
 *
 * The first chunk (cursor undefined/null) additionally carries every collection's
 * metadata (id/name/modes) — even for collections with zero variables in this
 * particular slice — plus text/effect styles, so that information is never dependent
 * on which chunk happens to reach a given collection's variables first.
 *
 * The final chunk (the one that reaches the end of the flattened variable list) does
 * a SECOND, full pass — serializing every variable across every collection, plus
 * styles — purely to compute a drift-check hash. That full serialization is discarded
 * immediately; only the 16-hex-char fnv1a64 digest is returned. This keeps the
 * chunking protocol genuinely size-limited per response (the whole point of chunking)
 * while still being able to hash the *entire* document as the M2 drift-check
 * primitive. The extra pass is cheap (a hash, not a transfer).
 */
export async function runExtract(figma: FigmaLike, args: ExtractArgs): Promise<ExtractChunk> {
  const chunkSize = args.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const offset = args.cursor ? decodeCursor(args.cursor) : 0;

  const { collectionsMeta, flat } = await readDocShape(figma);

  const slice = flat.slice(offset, offset + chunkSize);
  const nextOffset = offset + slice.length;
  const done = nextOffset >= flat.length;

  const byCollection = new Map<number, SerializedVariable[]>();
  for (const ref of slice) {
    const serialized = await serializeVariable(figma, ref.variableId);
    const arr = byCollection.get(ref.collectionIndex) ?? [];
    arr.push(serialized);
    byCollection.set(ref.collectionIndex, arr);
  }

  const collectionsOut: SerializedCollection[] = [];
  if (offset === 0) {
    // First chunk: emit a self-describing entry for every collection (even ones with
    // no variables in this particular slice), so metadata is never lost regardless of
    // where in the stream a collection's variables happen to fall.
    collectionsMeta.forEach((c, i) => {
      collectionsOut.push({ id: c.id, name: c.name, modes: c.modes, variables: byCollection.get(i) ?? [] });
    });
  } else {
    for (const [i, vars] of byCollection) {
      const c = collectionsMeta[i]!;
      collectionsOut.push({ id: c.id, name: c.name, modes: c.modes, variables: vars });
    }
  }

  const chunk: ExtractChunk = {
    done,
    cursor: done ? null : encodeCursor(nextOffset),
    hash: null,
    collections: collectionsOut,
  };

  if (offset === 0) {
    chunk.textStyles = (await figma.getLocalTextStylesAsync()).map(serializeStyle);
    chunk.effectStyles = (await figma.getLocalEffectStylesAsync()).map(serializeStyle);
  }

  if (done) {
    const fullCollections: SerializedCollection[] = [];
    for (const c of collectionsMeta) {
      const variables: SerializedVariable[] = [];
      for (const id of c.variableIds) variables.push(await serializeVariable(figma, id));
      fullCollections.push({ id: c.id, name: c.name, modes: c.modes, variables });
    }
    const textStyles = (await figma.getLocalTextStylesAsync()).map(serializeStyle);
    const effectStyles = (await figma.getLocalEffectStylesAsync()).map(serializeStyle);
    const full: FigmaPayload = { collections: fullCollections, textStyles, effectStyles };
    chunk.hash = fnv1a64(stableStringify(full));
  }

  return chunk;
}
