import { AdhdError } from "../core/config";
import { fnv1a64, stableStringify } from "../core/hash";
import { rgbaToHex, type Rgba } from "../core/color";
import { pathToCssVar } from "../core/naming";
import { domainOf, type Mode, type Snapshot, type StyleShell, type Token } from "../core/tokens";
import {
  decodeCursor,
  type ExtractChunk,
  type FigmaPayload,
  type SerializedCollection,
  type SerializedStyle,
  type SerializedVariable,
} from "./extract";

export type { FigmaPayload } from "./extract";

/**
 * Reassembles the chunks returned by repeated `runExtract` calls into a single
 * FigmaPayload, verifying:
 *  - offsets are contiguous from 0 (no gap, no reorder, no duplicate/missing chunk)
 *  - `done` is true on the last chunk only
 *  - `hash` is null on every chunk except the last, and the last chunk's hash matches
 *    a hash recomputed over the reassembled payload (the M2 drift-check primitive —
 *    catches corruption/truncation in transit between the Figma script and the CLI).
 */
export function assembleChunks(chunks: ExtractChunk[]): FigmaPayload {
  if (chunks.length === 0) {
    throw new AdhdError("assembleChunks: no chunks provided — nothing to assemble");
  }

  const collectionsById = new Map<string, SerializedCollection>();
  const collectionOrder: string[] = [];
  let textStyles: SerializedStyle[] | undefined;
  let effectStyles: SerializedStyle[] | undefined;

  let expectedOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const isLast = i === chunks.length - 1;

    if (chunk.done !== isLast) {
      throw new AdhdError(
        `assembleChunks: chunk ${i} has done=${chunk.done}, but done must be true on the last chunk only`
      );
    }
    if (isLast) {
      if (typeof chunk.hash !== "string") {
        throw new AdhdError("assembleChunks: the final chunk is missing its hash");
      }
    } else if (chunk.hash !== null) {
      throw new AdhdError(`assembleChunks: chunk ${i} carries a hash, but hash must appear only on the final chunk`);
    }

    for (const col of chunk.collections ?? []) {
      let existing = collectionsById.get(col.id);
      if (!existing) {
        existing = { id: col.id, name: col.name, modes: col.modes, variables: [] };
        collectionsById.set(col.id, existing);
        collectionOrder.push(col.id);
      }
      existing.variables.push(...col.variables);
    }
    if (chunk.textStyles) textStyles = chunk.textStyles;
    if (chunk.effectStyles) effectStyles = chunk.effectStyles;

    const countThisChunk = (chunk.collections ?? []).reduce((n, c) => n + c.variables.length, 0);
    const expectedNextOffset = expectedOffset + countThisChunk;

    if (!isLast) {
      if (chunk.cursor == null) {
        throw new AdhdError(`assembleChunks: chunk ${i} has no cursor to continue from`);
      }
      if (decodeCursor(chunk.cursor) !== expectedNextOffset) {
        throw new AdhdError(
          `assembleChunks: chunk ${i}'s cursor does not continue from a contiguous offset — a chunk is missing, duplicated, or out of order`
        );
      }
    }
    expectedOffset = expectedNextOffset;
  }

  if (textStyles === undefined || effectStyles === undefined) {
    throw new AdhdError(
      "assembleChunks: no chunk carried textStyles/effectStyles — the first chunk (offset 0) is missing"
    );
  }

  const payload: FigmaPayload = {
    collections: collectionOrder.map((id) => collectionsById.get(id)!),
    textStyles,
    effectStyles,
  };

  const recomputed = fnv1a64(stableStringify(payload));
  const claimed = chunks[chunks.length - 1]!.hash;
  if (recomputed !== claimed) {
    throw new AdhdError("extraction corrupted in transit");
  }

  return payload;
}

// --- payload -> Snapshot -----------------------------------------------------

type IdIndex = Map<string, { name: string; collectionName: string }>;

function buildIdIndex(p: FigmaPayload): IdIndex {
  const idx: IdIndex = new Map();
  for (const col of p.collections) {
    for (const v of col.variables) idx.set(v.id, { name: v.name, collectionName: col.name });
  }
  return idx;
}

function isAlias(v: unknown): v is { type: "VARIABLE_ALIAS"; id: string } {
  return !!v && typeof v === "object" && (v as any).type === "VARIABLE_ALIAS";
}

function isRgba(v: unknown): v is Rgba {
  return !!v && typeof v === "object" && "r" in (v as any) && "g" in (v as any) && "b" in (v as any);
}

// Stringifies a resolved (non-alias) raw value. Colors -> hex; integer-valued numbers
// in the spacing/radius domains -> "<n>px" (Figma FLOATs are unitless px); other
// numbers/strings -> String(n). Returns `unsyncable` for anything else.
function stringifyValue(raw: unknown, path: string): { value?: string; unsyncable?: string } {
  if (isRgba(raw)) return { value: rgbaToHex(raw) };
  if (typeof raw === "number") {
    const domain = domainOf(path);
    if ((domain === "spacing" || domain === "radius") && Number.isInteger(raw)) return { value: `${raw}px` };
    return { value: String(raw) };
  }
  if (typeof raw === "string") return { value: raw };
  return { unsyncable: `unsupported value type for ${path}` };
}

function buildPrimitiveToken(v: SerializedVariable, col: SerializedCollection, ids: IdIndex): Token {
  const path = v.name;
  const domain = domainOf(path);
  // Structural problems with this variable that don't prevent us from also
  // resolving a value below — collected up front and merged into whatever
  // `unsyncable` reason the value-resolution path below produces, so neither
  // silently overwrites the other.
  const reasons: string[] = [];

  if (pathToCssVar(path) === null) {
    // Off-grammar Figma names (e.g. "Color/Zinc/800", TitleCase) would
    // otherwise sail through as a syncable path that the grammar-validated
    // CSS side (core/css.ts) can never match, producing a false
    // existence-drift error under --check. Flag it the same way css.ts flags
    // an off-grammar CSS var name, so it routes to cannotSync instead.
    reasons.push(`Figma variable name '${path}' is outside the token naming grammar`);
  }

  const extraModes = col.modes.slice(1).map((m) => m.name);
  if (extraModes.length > 0) {
    // The primitives model has a single mode ("default"); only modes[0] is
    // ever read below. A second (or later) mode's values would otherwise be
    // silently dropped — flag it instead of losing them quietly.
    reasons.push(
      `Primitives collection has additional mode(s) '${extraModes.join(", ")}' that the primitives model (single mode) can't represent`
    );
  }

  const withReasons = (token: Token): Token => {
    if (reasons.length > 0) {
      token.unsyncable = token.unsyncable ? [token.unsyncable, ...reasons].join("; ") : reasons.join("; ");
    }
    return token;
  };

  const modeId = col.modes[0]?.modeId;
  const raw = modeId !== undefined ? v.valuesByMode[modeId] : undefined;

  if (raw === undefined) {
    return withReasons({ path, collection: "primitives", domain, values: {}, unsyncable: "no value for the collection's mode" });
  }
  if (isAlias(raw)) {
    const target = ids.get(raw.id);
    if (!target) return withReasons({ path, collection: "primitives", domain, values: {}, unsyncable: "alias target not found" });
    return withReasons({ path, collection: "primitives", domain, values: {}, aliasOf: { default: target.name } });
  }
  const { value, unsyncable } = stringifyValue(raw, path);
  if (unsyncable) return withReasons({ path, collection: "primitives", domain, values: {}, unsyncable });
  return withReasons({ path, collection: "primitives", domain, values: { default: value! } });
}

// Semantic mode names are matched case-insensitively against "light"/"dark". Any other
// mode name is not part of the mandated structure: we don't silently drop it — the
// whole token is flagged unsyncable citing the unknown mode name — but we still keep
// whatever light/dark values *were* resolved, since Token has no per-mode unsyncable
// slot and dropping known-good data to represent an unrelated problem would itself be
// a silent loss.
function buildSemanticToken(v: SerializedVariable, col: SerializedCollection, ids: IdIndex): Token {
  const path = v.name;
  const domain = domainOf(path);
  const values: Partial<Record<Mode, string>> = {};
  const aliasOf: Partial<Record<Mode, string>> = {};
  const reasons: string[] = [];

  if (pathToCssVar(path) === null) {
    // Same off-grammar-name concern as buildPrimitiveToken: an unvalidated
    // Figma name here would produce a syncable path the CSS side can never
    // match, masquerading as existence drift instead of a naming problem.
    reasons.push(`Figma variable name '${path}' is outside the token naming grammar`);
  }

  for (const m of col.modes) {
    const lname = m.name.trim().toLowerCase();
    const mode: Mode | null = lname === "light" ? "light" : lname === "dark" ? "dark" : null;
    if (!mode) {
      reasons.push(`unknown mode '${m.name}' in Semantic collection`);
      continue;
    }
    const raw = v.valuesByMode[m.modeId];
    if (raw === undefined) continue;
    if (isAlias(raw)) {
      const target = ids.get(raw.id);
      if (!target) {
        reasons.push("alias target not found");
        continue;
      }
      aliasOf[mode] = target.name;
      continue;
    }
    const { value, unsyncable } = stringifyValue(raw, path);
    if (unsyncable) {
      reasons.push(unsyncable);
      continue;
    }
    values[mode] = value!;
  }

  const token: Token = { path, collection: "semantic", domain, values };
  if (Object.keys(aliasOf).length > 0) token.aliasOf = aliasOf;
  if (reasons.length > 0) token.unsyncable = reasons.join("; ");
  return token;
}

function resolveBoundPrimitives(s: SerializedStyle, ids: IdIndex): { names: string[]; unsyncable?: string } {
  const names: string[] = [];
  const missingReasons: string[] = [];
  for (const id of s.boundPrimitiveIds ?? []) {
    const target = ids.get(id);
    if (target) {
      names.push(target.name);
    } else {
      // Never silently filter out an id that doesn't resolve — flag the
      // style so the drop is visible instead of the style just appearing to
      // have fewer bound primitives than it actually declares.
      missingReasons.push(`bound primitive id ${id} not found in extracted variables`);
    }
  }
  return { names, unsyncable: missingReasons.length > 0 ? missingReasons.join("; ") : undefined };
}

/**
 * Maps a reassembled FigmaPayload to a code-agnostic Snapshot, plus a variableId->path
 * index (`ids`) that downstream steps (diffing, writeback) use to talk about the same
 * variables Figma does.
 *
 * Collection-name routing: "Primitives" (case-insensitive) -> collection "primitives",
 * single mode "default". "Semantic" -> collection "semantic", modes matched by name
 * Light/Dark. Any other collection name is not part of the mandated structure: every
 * variable in it becomes a Token flagged unsyncable (spec: no silent loss) rather than
 * being dropped or silently merged into one of the two real buckets. Such tokens are
 * bucketed under `collection: "primitives"` purely because Token.collection has no
 * third literal to hold them — the `unsyncable` reason is what actually routes them to
 * the report's cannot-sync section, not the collection field.
 */
export function figmaPayloadToSnapshot(p: FigmaPayload): { snapshot: Snapshot; ids: Record<string, string> } {
  const idIndex = buildIdIndex(p);
  const ids: Record<string, string> = {};
  const tokens: Token[] = [];

  for (const col of p.collections) {
    const lname = col.name.trim().toLowerCase();
    for (const v of col.variables) ids[v.id] = v.name;

    if (lname === "primitives") {
      for (const v of col.variables) tokens.push(buildPrimitiveToken(v, col, idIndex));
    } else if (lname === "semantic") {
      for (const v of col.variables) tokens.push(buildSemanticToken(v, col, idIndex));
    } else {
      for (const v of col.variables) {
        // Collision-proofing: a rogue collection's variable could share a name with a
        // real primitives token (e.g. "color/zinc/50"), and downstream matching keys
        // tokens by `${collection}/${path}` (snapshot.ts, css.ts) — colliding with
        // `collection: "primitives"` would silently merge unrelated data. Prefixing the
        // path with "rogue:<collection name>/" makes collision impossible, since real
        // token paths are lowercase alnum/hyphen/slash only and can never contain ":".
        tokens.push({
          path: `rogue:${col.name}/${v.name}`,
          collection: "primitives",
          domain: domainOf(v.name),
          values: {},
          unsyncable: `collection '${col.name}' is not part of the mandated Primitives/Semantic structure`,
        });
      }
    }
  }

  const toStyleShell = (s: SerializedStyle, kind: StyleShell["kind"]): StyleShell => {
    const { names, unsyncable } = resolveBoundPrimitives(s, idIndex);
    const shell: StyleShell = { kind, name: s.name, boundPrimitives: names };
    if (unsyncable) {
      shell.unsyncable = shell.unsyncable ? `${shell.unsyncable}; ${unsyncable}` : unsyncable;
    }
    return shell;
  };

  const styles: StyleShell[] = [
    ...p.textStyles.map((s) => toStyleShell(s, "text")),
    ...p.effectStyles.map((s) => toStyleShell(s, "effect")),
  ];

  return { snapshot: { side: "figma", tokens, styles }, ids };
}
