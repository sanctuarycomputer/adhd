# ADHD v2 — Milestone 1: Core + Lint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v2 TypeScript core (color/naming/css/snapshot/config/lock), the cursor-chunked Figma extraction script with a fake-`figma` test harness, port the STRUCT001–010 rules with their fixtures, add the three-class drift diff, and ship a working `/adhd:lint` as a thin skill over one CLI.

**Architecture:** Everything deterministic lives in `plugins/adhd/src/` (TypeScript, real deps), esbuild-bundled to committed `dist/` artifacts that consumers run with plain `node` — no install. The model's only jobs: relay CLI-emitted Figma scripts to `use_figma`, save responses to files, run the CLI, print the report. Spec: `docs/superpowers/specs/2026-07-05-adhd-v2-rebuild-design.md`.

**Tech Stack:** TypeScript (strict), esbuild, vitest, postcss, culori. Node ≥ 20. v1 JS libs stay in place untouched until Milestone 5.

## Global Constraints

- Work on branch `adhd/v2` (create via superpowers:using-git-worktrees at execution start). v1 code is never modified in M1 except `.github/workflows` (Task 14) and the lint skill + README row (Task 13).
- One Figma structure model everywhere: `Primitives` collection (no modes) + `Semantic` collection (`Light`/`Dark` modes). Never configurable.
- No silent loss: anything skipped or unsyncable must appear in the report with a reason.
- The model never authors/edits/substitutes scripts or composes JSON. Any placeholder substitution (`"__ADHD_ARGS__"`) happens inside the CLI.
- No hardcoded `/tmp`: the CLI takes paths as arguments; the skill passes a workdir.
- Parsers never throw on malformed input values — they return `null`/mark items unsyncable. CLI exits nonzero only with a structured, actionable message.
- `dist/` is committed; CI fails if it doesn't match `src/` (`node build.mjs --check`).
- All new commands run from `plugins/adhd/`: `npm ci`, `npx vitest run`, `node build.mjs`.

---

### Task 1: Toolchain bootstrap

**Files:**
- Create: `plugins/adhd/package.json`, `plugins/adhd/tsconfig.json`, `plugins/adhd/build.mjs`, `plugins/adhd/src/cli.ts`, `plugins/adhd/.gitignore`
- Test: build + run smoke (no vitest yet in this task's first step; vitest config included here)
- Create: `plugins/adhd/vitest.config.ts`

**Interfaces:**
- Produces: `dist/adhd.js` (CJS bundle, shebang, runnable via `node dist/adhd.js`), `node build.mjs` (build) and `node build.mjs --check` (freshness gate), `npx vitest run` test runner. All later tasks assume these exist.

- [ ] **Step 1: Write package.json, tsconfig, vitest config, .gitignore**

`plugins/adhd/package.json`:
```json
{
  "name": "adhd-plugin-dev",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24",
    "culori": "^4",
    "esbuild": "^0.25",
    "postcss": "^8",
    "typescript": "^5.8",
    "vitest": "^3"
  }
}
```

`plugins/adhd/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`plugins/adhd/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`plugins/adhd/.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Write build.mjs with freshness check**

```js
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const check = process.argv.includes("--check");

async function bundle(entry, outfile, opts = {}) {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
    ...opts,
  });
  return r.outputFiles[0].text;
}

mkdirSync("dist", { recursive: true });

const cli = "#!/usr/bin/env node\n" + (await bundle("src/cli.ts", "dist/adhd.js"));
// Figma-side scripts: bundled for a plain JS runtime (no node builtins allowed).
// Entries are added here as they are created (Task 7 adds extract).
const scripts = {};
try {
  scripts.extract = await bundle("src/figma/extract-entry.ts", null, { platform: "neutral" });
} catch { /* entry appears in Task 7 */ }

const outputs = { "dist/adhd.js": cli, "dist/figma-scripts.json": JSON.stringify(scripts, null, 2) };
let stale = false;
for (const [path, content] of Object.entries(outputs)) {
  if (check) {
    let current = null;
    try { current = readFileSync(path, "utf8"); } catch {}
    if (current !== content) { console.error(`STALE: ${path} — run 'node build.mjs' and commit`); stale = true; }
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
}
if (check && stale) process.exit(1);
```

- [ ] **Step 3: Write the CLI skeleton**

`plugins/adhd/src/cli.ts`:
```ts
const [, , command, ...rest] = process.argv;

export function fail(message: string, fixup?: string): never {
  console.error(`✗ ${message}`);
  if (fixup) console.error(`  → ${fixup}`);
  process.exit(1);
}

const commands: Record<string, (args: string[]) => Promise<void>> = {};

async function main() {
  const handler = command ? commands[command] : undefined;
  if (!handler) fail(`Unknown command: ${command ?? "(none)"}`, "Available: (none yet)");
  await handler(rest);
}
main();
```

- [ ] **Step 4: Install, build, verify smoke + freshness**

Run: `cd plugins/adhd && npm install && node build.mjs && node dist/adhd.js nope; node build.mjs --check && echo FRESH`
Expected: `wrote dist/adhd.js`, `✗ Unknown command: nope` (exit 1 from the CLI is fine), then `FRESH`.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/package.json plugins/adhd/package-lock.json plugins/adhd/tsconfig.json \
  plugins/adhd/vitest.config.ts plugins/adhd/build.mjs plugins/adhd/src/cli.ts \
  plugins/adhd/.gitignore plugins/adhd/dist/
git commit -m "v2: toolchain bootstrap (esbuild bundle, dist freshness check, CLI skeleton)"
```

---

### Task 2: core/hash.ts + core/naming.ts

**Files:**
- Create: `plugins/adhd/src/core/hash.ts`, `plugins/adhd/src/core/naming.ts`
- Test: `plugins/adhd/test/hash.test.ts`, `plugins/adhd/test/naming.test.ts`

**Interfaces:**
- Produces: `stableStringify(v: unknown): string` (sorted object keys), `fnv1a64(s: string): string` (16-hex-char hash — chosen because it must also run inside the Figma JS runtime, which has no crypto). `cssVarToPath(cssVar: string): string`, `pathToCssVar(path: string): string`, `caseMatches(name: string, convention: NamingConvention): boolean`, `type NamingConvention = "kebab-case" | "PascalCase" | "camelCase" | false`.

- [ ] **Step 1: Write failing tests**

`test/hash.test.ts`:
```ts
import { expect, test } from "vitest";
import { stableStringify, fnv1a64 } from "../src/core/hash";

test("stableStringify sorts keys at every depth", () => {
  expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
});
test("fnv1a64 is deterministic and 16 hex chars", () => {
  expect(fnv1a64("adhd")).toMatch(/^[0-9a-f]{16}$/);
  expect(fnv1a64("adhd")).toBe(fnv1a64("adhd"));
  expect(fnv1a64("adhd")).not.toBe(fnv1a64("adhd2"));
});
```

`test/naming.test.ts`:
```ts
import { expect, test } from "vitest";
import { cssVarToPath, pathToCssVar, caseMatches } from "../src/core/naming";

test("cssVar ↔ path is bijective, lowercase, hyphens↔slashes", () => {
  expect(cssVarToPath("--color-zinc-800")).toBe("color/zinc/800");
  expect(pathToCssVar("color/zinc/800")).toBe("--color-zinc-800");
  expect(cssVarToPath(pathToCssVar("spacing/2"))).toBe("spacing/2");
});
test("composite companion vars map to nested paths", () => {
  // --text-lg--line-height → text/lg/line-height (double hyphen = segment boundary too)
  expect(cssVarToPath("--text-lg--line-height")).toBe("text/lg/line-height");
});
test("caseMatches enforces strict kebab (no slashes/dots — the v1 loophole)", () => {
  expect(caseMatches("status-dot", "kebab-case")).toBe(true);
  expect(caseMatches("Status Dot", "kebab-case")).toBe(false);
  expect(caseMatches("a/b.c", "kebab-case")).toBe(false); // v1's second alternative wrongly allowed this
  expect(caseMatches("anything", false)).toBe(true);
  expect(caseMatches("AvatarBody", "PascalCase")).toBe(true);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run test/hash.test.ts test/naming.test.ts`
Expected: FAIL (modules don't exist).

- [ ] **Step 3: Implement**

`src/core/hash.ts`:
```ts
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
```

`src/core/naming.ts`:
```ts
export type NamingConvention = "kebab-case" | "PascalCase" | "camelCase" | false;

export function cssVarToPath(cssVar: string): string {
  if (!cssVar.startsWith("--")) throw new Error(`Not a CSS variable name: ${cssVar}`);
  return cssVar.slice(2).toLowerCase().split(/-+/).filter(Boolean).join("/");
}

export function pathToCssVar(path: string): string {
  return "--" + path.toLowerCase().split("/").filter(Boolean).join("-");
}

export function caseMatches(name: string, convention: NamingConvention): boolean {
  if (convention === false) return true;
  if (convention === "kebab-case") return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
  if (convention === "PascalCase") return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  if (convention === "camelCase") return /^[a-z][a-zA-Z0-9]*$/.test(name);
  return true;
}
```
Note: `cssVarToPath` collapses `--text-lg--line-height` correctly because `split(/-+/)` treats the double hyphen as one boundary. Bijectivity holds for kebab-cased token names (the enforced convention); `pathToCssVar(cssVarToPath(x)) === x` for all kebab names.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run test/hash.test.ts test/naming.test.ts` — Expected: PASS.

- [ ] **Step 5: Rebuild dist, commit**

```bash
node build.mjs
git add src/core/hash.ts src/core/naming.ts test/hash.test.ts test/naming.test.ts dist/
git commit -m "v2: core hash (figma-runtime-safe) + the single css-var↔figma-path mapping"
```

---

### Task 3: core/color.ts

**Files:**
- Create: `plugins/adhd/src/core/color.ts`
- Test: `plugins/adhd/test/color.test.ts`

**Interfaces:**
- Produces: `type Rgba = { r: number; g: number; b: number; a: number }` (0–1 floats), `parseColor(input: string): Rgba | null` (hex/rgb()/oklch()/hsl()/named/transparent; null on unparseable — never throws), `rgbaToHex(c: Rgba): string` (lowercase `#rrggbb` or `#rrggbbaa`), `normalizeColor(input: string): string | null`, `colorsEqual(a: string | Rgba, b: string | Rgba, epsilon?: number): boolean` (default epsilon 0.004 ≈ 1/255; oklch compared after culori sRGB **gamut mapping**, not naive clamping — fixes v1's distortion of P3 Tailwind colors).

- [ ] **Step 1: Write failing tests**

`test/color.test.ts`:
```ts
import { expect, test } from "vitest";
import { parseColor, rgbaToHex, normalizeColor, colorsEqual } from "../src/core/color";

test("parses hex, rgb(), oklch(), named", () => {
  expect(parseColor("#27272a")).toEqual({ r: 0x27 / 255, g: 0x27 / 255, b: 0x2a / 255, a: 1 });
  expect(parseColor("rgb(39 39 42)")).toMatchObject({ a: 1 });
  expect(parseColor("oklch(0.21 0.006 285.885)")).not.toBeNull();
  expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  expect(parseColor("not-a-color")).toBeNull(); // never throws
  expect(parseColor("oklch(from var(--x) l c h)")).toBeNull(); // relative syntax: unsyncable, not a crash
});

test("THE v1 killer bug: Tailwind oklch equals its own hex rendering", () => {
  // zinc-800 in Tailwind v4 is oklch(0.274 0.006 286.033); its sRGB hex is #27272a.
  expect(colorsEqual("oklch(0.274 0.006 286.033)", "#27272a")).toBe(true);
  expect(colorsEqual("oklch(0.274 0.006 286.033)", "#3f3f46")).toBe(false); // zinc-700 ≠ zinc-800
});

test("out-of-sRGB-gamut oklch is gamut-mapped, not channel-clamped", () => {
  const vivid = parseColor("oklch(0.7 0.32 150)"); // P3-ish green, outside sRGB
  expect(vivid).not.toBeNull();
  for (const ch of [vivid!.r, vivid!.g, vivid!.b]) { expect(ch).toBeGreaterThanOrEqual(0); expect(ch).toBeLessThanOrEqual(1); }
});

test("normalizeColor canonicalizes to lowercase hex", () => {
  expect(normalizeColor("#FFF")).toBe("#ffffff");
  expect(normalizeColor("rgb(255 0 0 / 0.5)")).toBe("#ff000080");
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/color.test.ts`

- [ ] **Step 3: Implement with culori**

`src/core/color.ts`:
```ts
import { parse, converter, toGamut, formatHex, formatHex8 } from "culori";

export type Rgba = { r: number; g: number; b: number; a: number };

const toRgb = converter("rgb");
const gamutMap = toGamut("rgb", "oklch"); // CSS4 gamut mapping in oklch space

export function parseColor(input: string): Rgba | null {
  if (typeof input !== "string") return null;
  const parsed = parse(input.trim());
  if (!parsed) return null;
  const rgb = parsed.mode === "rgb" ? parsed : gamutMap(parsed);
  const c = toRgb(rgb);
  if (!c || [c.r, c.g, c.b].some((v) => typeof v !== "number" || Number.isNaN(v))) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { r: clamp(c.r), g: clamp(c.g), b: clamp(c.b), a: c.alpha ?? 1 };
}

export function rgbaToHex(c: Rgba): string {
  const color = { mode: "rgb" as const, r: c.r, g: c.g, b: c.b, alpha: c.a };
  return c.a >= 1 ? formatHex(color) : formatHex8(color);
}

export function normalizeColor(input: string): string | null {
  const c = parseColor(input);
  return c ? rgbaToHex(c) : null;
}

export function colorsEqual(a: string | Rgba, b: string | Rgba, epsilon = 0.004): boolean {
  const ca = typeof a === "string" ? parseColor(a) : a;
  const cb = typeof b === "string" ? parseColor(b) : b;
  if (!ca || !cb) return false;
  return (
    Math.abs(ca.r - cb.r) <= epsilon && Math.abs(ca.g - cb.g) <= epsilon &&
    Math.abs(ca.b - cb.b) <= epsilon && Math.abs(ca.a - cb.a) <= epsilon
  );
}
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run test/color.test.ts`
(If the zinc-800 assertion fails by a hair, verify the actual Tailwind value in `example/node_modules/tailwindcss/theme.css` and adjust the *fixture value*, not the epsilon, unless the delta exceeds 1/255.)

- [ ] **Step 5: Rebuild dist, commit**

```bash
node build.mjs && git add src/core/color.ts test/color.test.ts dist/ && \
git commit -m "v2: one color engine — culori parse/gamut-map/compare, oklch first-class"
```

---

### Task 4: core/tokens.ts + core/snapshot.ts

**Files:**
- Create: `plugins/adhd/src/core/tokens.ts`, `plugins/adhd/src/core/snapshot.ts`
- Test: `plugins/adhd/test/snapshot.test.ts`

**Interfaces:**
- Produces (used by every later task):
```ts
export type Domain = "color" | "spacing" | "radius" | "shadow" | "typography" | "other";
export type Mode = "default" | "light" | "dark";
export interface Token {
  path: string;                       // "color/zinc/800" — collection NOT included
  collection: "primitives" | "semantic";
  domain: Domain;
  values: Partial<Record<Mode, string>>; // canonical strings; colors normalized to hex by producers
  aliasOf?: string;                   // path of alias target, when the value is a reference
  unsyncable?: string;                // reason string ⇒ goes to the report's cannot-sync section
}
export interface StyleShell { kind: "text" | "effect"; name: string; boundPrimitives: string[]; unsyncable?: string; }
export interface Snapshot { side: "code" | "figma"; tokens: Token[]; styles: StyleShell[]; }
```
- `domainOf(path: string): Domain` (first segment: color/spacing/radius/shadow → same; `text` or `typography` → typography; else other)
- `canonicalize(s: Snapshot): Snapshot` (tokens sorted by collection then path; values keys sorted; styles sorted by kind+name)
- `contentHash(s: Snapshot): string` (`fnv1a64(stableStringify(canonicalize(s)))`)

- [ ] **Step 1: Write failing tests**

`test/snapshot.test.ts`:
```ts
import { expect, test } from "vitest";
import { domainOf } from "../src/core/tokens";
import { canonicalize, contentHash } from "../src/core/snapshot";
import type { Snapshot } from "../src/core/tokens";

const snap = (tokens: any[]): Snapshot => ({ side: "code", tokens, styles: [] });

test("domainOf maps first segment", () => {
  expect(domainOf("color/zinc/800")).toBe("color");
  expect(domainOf("text/lg/line-height")).toBe("typography");
  expect(domainOf("weird/thing")).toBe("other");
});

test("contentHash is order-insensitive (canonicalized)", () => {
  const a = snap([
    { path: "color/a", collection: "primitives", domain: "color", values: { default: "#111111" } },
    { path: "color/b", collection: "primitives", domain: "color", values: { default: "#222222" } },
  ]);
  const b = snap([a.tokens[1], a.tokens[0]]);
  expect(contentHash(a)).toBe(contentHash(b));
});

test("contentHash changes when a value changes", () => {
  const a = snap([{ path: "color/a", collection: "primitives", domain: "color", values: { default: "#111111" } }]);
  const b = snap([{ path: "color/a", collection: "primitives", domain: "color", values: { default: "#111112" } }]);
  expect(contentHash(a)).not.toBe(contentHash(b));
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/snapshot.test.ts`

- [ ] **Step 3: Implement**

`src/core/tokens.ts` holds the types above plus:
```ts
export function domainOf(path: string): Domain {
  const head = path.split("/")[0];
  if (head === "color" || head === "spacing" || head === "radius" || head === "shadow") return head;
  if (head === "text" || head === "typography" || head === "font" || head === "leading" || head === "tracking") return "typography";
  return "other";
}
```

`src/core/snapshot.ts`:
```ts
import { stableStringify, fnv1a64 } from "./hash";
import type { Snapshot } from "./tokens";

export function canonicalize(s: Snapshot): Snapshot {
  const key = (t: { collection: string; path: string }) => `${t.collection} ${t.path}`;
  return {
    side: s.side,
    tokens: [...s.tokens].sort((a, b) => key(a).localeCompare(key(b))),
    styles: [...s.styles].sort((a, b) => `${a.kind}${a.name}`.localeCompare(`${b.kind}${b.name}`)),
  };
}

export function contentHash(s: Snapshot): string {
  return fnv1a64(stableStringify(canonicalize(s)));
}
```

- [ ] **Step 4: Run, verify PASS**, then **Step 5: rebuild + commit**

```bash
node build.mjs && git add src/core/tokens.ts src/core/snapshot.ts test/snapshot.test.ts dist/ && \
git commit -m "v2: canonical snapshot model + content hash"
```

---

### Task 5: core/css.ts — postcss reader for globals.css

**Files:**
- Create: `plugins/adhd/src/core/css.ts`
- Create: `plugins/adhd/test/fixtures/sample-globals.css` (copy of `plugins/adhd/lib/lint-engine/__fixtures__/sample-globals.css` — copy, don't move; v1 tests still use the original)
- Test: `plugins/adhd/test/css.test.ts`

**Interfaces:**
- Consumes: `Token`, `Snapshot`, `domainOf`, `cssVarToPath`, `normalizeColor`.
- Produces: `parseCssSnapshot(css: string): Snapshot`. Section→collection/mode mapping (locked by spec §5): `@theme`/`@theme inline` → `primitives` with mode `default`; top-level `:root` → `semantic` mode `light`; `:root` inside `@media (prefers-color-scheme: dark)` or a `.dark` selector → `semantic` mode `dark`. A `var(--x)` value ⇒ `aliasOf: cssVarToPath("--x")` (aliases never flattened). Color values are normalized to hex; `oklch(from …)` relative syntax and gradients set `unsyncable`. Semantic tokens present in light but not dark (or vice versa) are still one Token with the modes it has.

- [ ] **Step 1: Write failing tests**

`test/css.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCssSnapshot } from "../src/core/css";

const css = readFileSync(new URL("./fixtures/sample-globals.css", import.meta.url), "utf8");
const snap = parseCssSnapshot(css);
const byPath = (p: string) => snap.tokens.find((t) => t.path === p);

test("@theme vars land in primitives/default, colors normalized to hex", () => {
  const t = snap.tokens.find((t) => t.collection === "primitives" && t.domain === "color");
  expect(t).toBeDefined();
  expect(t!.values.default).toMatch(/^#[0-9a-f]{6,8}$/);
});

test("semantic tokens carry light+dark modes from :root and the dark block", () => {
  const sem = snap.tokens.filter((t) => t.collection === "semantic");
  expect(sem.length).toBeGreaterThan(0);
  expect(sem.some((t) => t.values.light && t.values.dark)).toBe(true);
});

test("var() references become aliasOf, never flattened", () => {
  const alias = snap.tokens.find((t) => t.aliasOf);
  expect(alias).toBeDefined();
  expect(alias!.aliasOf).toMatch(/\//); // a path like color/zinc/800
});

test("unparseable values are unsyncable, not dropped and not a crash", () => {
  const weird = parseCssSnapshot(`@theme { --color-x: oklch(from var(--y) l c h); }`);
  expect(weird.tokens).toHaveLength(1);
  expect(weird.tokens[0].unsyncable).toBeTruthy();
});
```
Before finalizing assertions, open `test/fixtures/sample-globals.css` and pin one concrete expected token (exact path + hex) per section into the tests — concrete values beat shape assertions.

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/css.test.ts`

- [ ] **Step 3: Implement with postcss**

Implementation outline (real postcss AST walking — no regex over raw CSS):
```ts
import postcss, { type Root, type Rule, type AtRule, type Declaration } from "postcss";
import { cssVarToPath } from "./naming";
import { normalizeColor } from "./color";
import { domainOf, type Snapshot, type Token, type Mode } from "./tokens";

export function parseCssSnapshot(css: string): Snapshot {
  const root = postcss.parse(css);
  const tokens = new Map<string, Token>();

  const put = (name: string, raw: string, collection: Token["collection"], mode: Mode) => {
    const path = cssVarToPath(name);
    const t = tokens.get(`${collection}:${path}`) ??
      { path, collection, domain: domainOf(path), values: {} } as Token;
    const aliasMatch = raw.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/);
    if (aliasMatch) { t.aliasOf = cssVarToPath(aliasMatch[1]); t.values[mode] = raw; }
    else if (t.domain === "color") {
      const hex = normalizeColor(raw);
      if (hex) t.values[mode] = hex;
      else { t.values[mode] = raw; t.unsyncable = `unparseable color value: ${raw}`; }
    } else t.values[mode] = raw.trim();
    tokens.set(`${collection}:${path}`, t);
  };

  root.walkDecls((decl: Declaration) => {
    if (!decl.prop.startsWith("--")) return;
    const section = classify(decl); // "theme" | "root-light" | "root-dark" | null
    if (section === "theme") put(decl.prop, decl.value, "primitives", "default");
    if (section === "root-light") put(decl.prop, decl.value, "semantic", "light");
    if (section === "root-dark") put(decl.prop, decl.value, "semantic", "dark");
  });
  return { side: "code", tokens: [...tokens.values()], styles: [] };
}
```
`classify(decl)` walks `decl.parent` ancestors: an `AtRule` named `theme` ⇒ `"theme"`; a `Rule` with selector containing `:root` or `.dark` ⇒ light unless any ancestor is `@media (prefers-color-scheme: dark)` or the selector contains `.dark`/`[data-theme="dark"]` ⇒ `"root-dark"`. Anything else ⇒ `null` (ignored). Write it as a small pure function next to `parseCssSnapshot`.

- [ ] **Step 4: Run, verify PASS.** Also sanity-run against the real example app:
Run: `node -e "const{parseCssSnapshot}=require('./dist/adhd.js');" 2>/dev/null || true` — dist doesn't export internals; instead add a temporary check via vitest: parse `../../example/app/globals.css` in a test named `"parses the example app's real globals.css without unsyncable surprises"` asserting `tokens.length > 20` and listing any `unsyncable` reasons (expect none, or document why).

- [ ] **Step 5: Rebuild + commit**

```bash
node build.mjs && git add src/core/css.ts test/css.test.ts test/fixtures/sample-globals.css dist/ && \
git commit -m "v2: postcss-based globals.css reader → canonical snapshot"
```

---

### Task 6: core/config.ts + core/lock.ts

**Files:**
- Create: `plugins/adhd/src/core/config.ts`, `plugins/adhd/src/core/lock.ts`, `plugins/adhd/adhd.schema.json`
- Test: `plugins/adhd/test/config.test.ts`

**Interfaces:**
- Produces:
```ts
export interface AdhdConfig { figma: { url: string; fileKey: string }; naming: NamingConvention; cssEntry: string | null; }
export function loadConfig(dir: string): AdhdConfig;          // throws AdhdError with fixup text
export function resolveCssEntry(dir: string, cfg: AdhdConfig): string; // cfg.cssEntry, else app/globals.css → src/app/globals.css, else throw
export function fileKeyFromUrl(url: string): string | null;    // segment after /design/ or /file/
export interface AdhdLock { baseSnapshot: Snapshot; figmaIds: { variables: Record<string, string>; styles: Record<string, string> }; components: Array<{ nodeId: string; path: string }>; lastSync: { at: string; figmaHash: string }; }
export function loadLock(dir: string): AdhdLock | null;        // null when absent; throws AdhdError when present-but-corrupt
export class AdhdError extends Error { fixup?: string }
```
Config file: `adhd.config.json`. Validation is hand-rolled against the shape (few fields); `adhd.schema.json` ships in the plugin for editors, is not read at runtime.

- [ ] **Step 1: Write failing tests**

`test/config.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadConfig, fileKeyFromUrl, loadLock, AdhdError } from "../src/core/config";

const dir = () => mkdtempSync(join(tmpdir(), "adhd-"));

test("loads and validates a good config, derives fileKey, defaults naming", () => {
  const d = dir();
  writeFileSync(join(d, "adhd.config.json"), JSON.stringify({ figma: { url: "https://www.figma.com/design/ABC123xyz/My-File" } }));
  const cfg = loadConfig(d);
  expect(cfg.figma.fileKey).toBe("ABC123xyz");
  expect(cfg.naming).toBe("kebab-case");
});

test("missing config throws AdhdError with the /adhd:config fixup", () => {
  expect(() => loadConfig(dir())).toThrowError(AdhdError);
  try { loadConfig(dir()); } catch (e: any) { expect(e.fixup).toContain("/adhd:config"); }
});

test("bad figma url is a field-level error", () => {
  const d = dir();
  writeFileSync(join(d, "adhd.config.json"), JSON.stringify({ figma: { url: "https://example.com/nope" } }));
  expect(() => loadConfig(d)).toThrow(/figma\.url/);
});

test("absent lock is null, corrupt lock throws", () => {
  const d = dir();
  expect(loadLock(d)).toBeNull();
  writeFileSync(join(d, "adhd.lock.json"), "{not json");
  expect(() => loadLock(d)).toThrowError(AdhdError);
});
```
Note `fileKeyFromUrl` lives in config.ts (exported from there in the test import) — keep it there; the URL-scope parsing in Task 12 reuses it.

- [ ] **Step 2: Run, verify FAIL**, **Step 3: implement** (straightforward: `JSON.parse`, field checks producing `AdhdError("adhd.config.json: figma.url must be a figma.com/design URL", fixup)`; `fileKeyFromUrl` = `/\/(design|file)\/([A-Za-z0-9]+)/` capture 2; `AdhdLock` presence-checks `baseSnapshot`, `figmaIds`, `lastSync`), **Step 4: verify PASS**, **Step 5:**

Write `adhd.schema.json` (JSON Schema draft-07 documenting `figma.url` (string, required), `naming` (enum), `cssEntry` (string)) — 30 lines, mirrors the validator.

```bash
node build.mjs && git add src/core/config.ts src/core/lock.ts adhd.schema.json test/config.test.ts dist/ && \
git commit -m "v2: adhd.config.json + adhd.lock.json loaders with structured errors"
```

---

### Task 7: Figma extract script (cursor protocol) + fake-figma harness

**Files:**
- Create: `plugins/adhd/src/figma/extract.ts`, `plugins/adhd/src/figma/extract-entry.ts`, `plugins/adhd/src/figma/payload.ts`
- Create: `plugins/adhd/test/fake-figma.ts`, `plugins/adhd/test/recordings/tokens-doc.json`
- Test: `plugins/adhd/test/extract.test.ts`
- Modify: `plugins/adhd/build.mjs` (the `scripts.extract` entry now resolves — no code change needed, the try/catch from Task 1 starts succeeding; verify `dist/figma-scripts.json` gains `extract`)

**Interfaces:**
- Consumes: `fnv1a64`, `stableStringify` (bundled into the script — they are Figma-runtime-safe by construction).
- Produces:
```ts
// extract.ts — pure logic, figma passed in (testable):
export interface ExtractArgs { cursor?: string | null; chunkSize?: number }   // chunkSize default 30 variables
export interface ExtractChunk { done: boolean; cursor: string | null; hash: string | null; // hash only on final chunk
  collections?: SerializedCollection[]; textStyles?: SerializedStyle[]; effectStyles?: SerializedStyle[]; }
export async function runExtract(figma: FigmaLike, args: ExtractArgs): Promise<ExtractChunk>;
export type FigmaLike = { variables: { getLocalVariableCollectionsAsync(): Promise<any[]>; getVariableByIdAsync(id: string): Promise<any> };
  getLocalTextStylesAsync(): Promise<any[]>; getLocalEffectStylesAsync(): Promise<any[]> };
// payload.ts — CLI side:
export function assembleChunks(chunks: ExtractChunk[]): FigmaPayload;          // throws AdhdError on gap/mismatch
export function figmaPayloadToSnapshot(p: FigmaPayload): { snapshot: Snapshot; ids: Record<string, string> }; // ids: variableId → path
```
- `extract-entry.ts` is the bundling entry: `const args = JSON.parse("__ADHD_ARGS__"); return runExtract(figma, args)` wrapped in an async IIFE — the CLI replaces `__ADHD_ARGS__` (Task 12).
- Serialized shapes: collection `{ id, name, modes: [{ modeId, name }], variables: [{ id, name, resolvedType, valuesByMode }] }` where each `valuesByMode` value is either `{ r,g,b,a }`, a number, a string, or `{ type: "VARIABLE_ALIAS", id }`. `figmaPayloadToSnapshot` maps: collection name `Primitives` (case-insensitive) → `collection: "primitives"`, mode `default`; `Semantic` → `"semantic"` with modes matched by name `Light`/`Dark`; any OTHER collection name → every variable in it becomes a Token with `unsyncable: "collection '<name>' is not part of the mandated Primitives/Semantic structure"` (spec: no silent loss). Colors → hex via `rgbaToHex`; aliases → `aliasOf` path of the target (resolve id→path within the payload); numbers → `String(n)` + `"px"` for spacing/radius when integer-valued (document: Figma FLOATs are px).
- The final chunk's `hash` = `fnv1a64(stableStringify(<all serialized collections+styles>))` computed **inside the script** — the drift-check primitive for M2; assembleChunks re-verifies it CLI-side after reassembly.

- [ ] **Step 1: Build the recording + harness**

`test/recordings/tokens-doc.json` — hand-construct a realistic document state: a `Primitives` collection (1 mode) with ≥ 65 variables (to force 3 chunks at chunkSize 30: use a loop-generated committed JSON — write a tiny throwaway script or hand-paste; commit the JSON, not the generator) including `color/zinc/800` = `{r:0.153,g:0.153,b:0.165,a:1}` and `spacing/2` = 8; a `Semantic` collection (modes Light, Dark) with `background` aliasing `color/zinc/50` in Light and `color/zinc/950` in Dark; one rogue collection named `Brand Extras` with one variable; one text style + one effect style.

`test/fake-figma.ts`:
```ts
import type { FigmaLike } from "../src/figma/extract";
export function fakeFigma(doc: any): FigmaLike {
  const allVars = new Map<string, any>();
  for (const c of doc.collections) for (const v of c.variables) allVars.set(v.id, { ...v, variableCollectionId: c.id });
  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => doc.collections.map((c: any) => ({
        id: c.id, name: c.name, modes: c.modes, variableIds: c.variables.map((v: any) => v.id),
      })),
      getVariableByIdAsync: async (id: string) => allVars.get(id) ?? null,
    },
    getLocalTextStylesAsync: async () => doc.textStyles,
    getLocalEffectStylesAsync: async () => doc.effectStyles,
  };
}
```

- [ ] **Step 2: Write failing tests**

`test/extract.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { runExtract } from "../src/figma/extract";
import { assembleChunks, figmaPayloadToSnapshot } from "../src/figma/payload";
import { fakeFigma } from "./fake-figma";

const doc = JSON.parse(readFileSync(new URL("./recordings/tokens-doc.json", import.meta.url), "utf8"));

async function extractAll() {
  const figma = fakeFigma(doc);
  const chunks = []; let cursor: string | null = null;
  do { const c = await runExtract(figma, { cursor, chunkSize: 30 }); chunks.push(c); cursor = c.cursor; } while (!chunks.at(-1)!.done);
  return chunks;
}

test("cursor protocol: multiple chunks, deterministic, hash on final chunk only", async () => {
  const chunks = await extractAll();
  expect(chunks.length).toBeGreaterThan(2);
  expect(chunks.slice(0, -1).every((c) => c.hash === null)).toBe(true);
  expect(chunks.at(-1)!.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(await extractAll()).toEqual(chunks); // determinism — the v1 byte-diff drift check's missing property
});

test("assemble + toSnapshot: aliases preserved, rogue collection unsyncable, ids map", async () => {
  const payload = assembleChunks(await extractAll());
  const { snapshot, ids } = figmaPayloadToSnapshot(payload);
  const bg = snapshot.tokens.find((t) => t.path === "background");
  expect(bg?.collection).toBe("semantic");
  expect(bg?.aliasOf).toBe("color/zinc/50"); // Light-mode alias target, never flattened
  const rogue = snapshot.tokens.filter((t) => t.unsyncable?.includes("Brand Extras"));
  expect(rogue.length).toBe(1);
  expect(Object.values(ids)).toContain("color/zinc/800");
});

test("assembleChunks throws on a missing chunk", async () => {
  const chunks = await extractAll();
  expect(() => assembleChunks(chunks.slice(1))).toThrow(/chunk/i);
});
```

- [ ] **Step 3: Run, verify FAIL**, then **Step 4: implement**

`runExtract`: list collections; flatten `[collectionIndex, variableId]` pairs in stable order; cursor = base64 of `String(offset)`; each call serializes the next `chunkSize` variables via `getVariableByIdAsync` (name, resolvedType, valuesByMode verbatim); the first chunk also carries collection metadata + styles; the last computes the hash over everything serialized so far — which requires re-walking: instead accumulate nothing across calls (stateless!), so the final chunk recomputes the hash by serializing ALL variables (names+values) in one pass **without** returning them (hash pass is cheap; payload pass is what's size-limited). Document this in a comment: the hash pass reads everything but returns only 16 chars.
`assembleChunks`: verify offsets are contiguous from 0 and `done` only on last; merge; recompute `fnv1a64(stableStringify(serialized))` and compare to the script's hash — mismatch ⇒ `AdhdError("extraction corrupted in transit")`.
`figmaPayloadToSnapshot`: per the Interfaces block above; alias resolution: `payload` contains every variable id→name, so `aliasOf` = path of the referenced id; a dangling alias id ⇒ `unsyncable: "alias target not found"`.

- [ ] **Step 5: Run, verify PASS; rebuild; verify dist/figma-scripts.json now has extract**

Run: `npx vitest run test/extract.test.ts && node build.mjs && node -e "const s=require('./dist/figma-scripts.json'); if(!s.extract||!s.extract.includes('__ADHD_ARGS__')) process.exit(1)" && echo SCRIPT-OK`
Expected: PASS, `SCRIPT-OK`.

- [ ] **Step 6: Commit**

```bash
git add src/figma/ test/fake-figma.ts test/recordings/tokens-doc.json test/extract.test.ts dist/ && \
git commit -m "v2: cursor-chunked Figma extract script, tested against a fake figma runtime"
```

---

### Task 8: Port STRUCT001–010 rules + real-Figma fixtures

**Files:**
- Create: `plugins/adhd/src/rules/struct.ts`
- Create: `plugins/adhd/test/fixtures/figma-real/` — copy all 11 JSON files from `plugins/adhd/lib/lint-engine/__fixtures__/figma-real/` (copy, don't move)
- Test: `plugins/adhd/test/struct.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Violation { rule: string; severity: "error" | "warning"; nodeId: string; nodePath: string; message: string; deepLink: string; }
export function checkStructure(root: FigmaNode, opts: { fileKey: string; naming: NamingConvention }): Violation[];
export type FigmaNode = Record<string, any> & { id: string; name: string; type: string; children?: FigmaNode[] };
```

**This is a port, not a rewrite.** Source of truth: `plugins/adhd/lib/lint-engine/structure-checker.js` (the walker with every exemption comment) and its expected outcomes in `plugins/adhd/lib/lint-engine/__tests__/struct-fixtures.test.js`. The exemptions are hard-won (four bug-fix commits) — carry every one, including: STRUCT001 single-shape-child exemption; STRUCT002/003/005 skip on COMPONENT_SET wrappers; invisible paints/effects excluded; empty `boundVariables: {}` is not a binding; STRUCT004 accepts `node.style` OR direct `fontSize`; auto-derived variant names exempt from STRUCT009. One deliberate change: STRUCT009 uses Task 2's strict `caseMatches` (the `/^[a-z0-9-/.]+$/` loophole is gone) — variant-value segments (`size=sm`) and path-like component names are handled by splitting on `/` and `=` *before* case-checking each segment, which is what the loophole was badly approximating.

- [ ] **Step 1: Copy fixtures; write the port's test as a table mirroring v1's**

`test/struct.test.ts` — read v1's `__tests__/struct-fixtures.test.js` and reproduce its fixture→expected-rules table exactly, e.g.:
```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { checkStructure } from "../src/rules/struct";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/figma-real/${n}.json`, import.meta.url), "utf8"));
const rulesHit = (n: string) => [...new Set(checkStructure(load(n), { fileKey: "TESTKEY", naming: "kebab-case" }).map((v) => v.rule))];

// EXPECTED table: transcribe from plugins/adhd/lib/lint-engine/__tests__/struct-fixtures.test.js
// (same fixture ⇒ same rule set). The two lines below are known-correct anchors:
test("00-clean is clean", () => expect(rulesHit("00-clean")).toEqual([]));
test("struct-001 fires only STRUCT001", () => expect(rulesHit("struct-001-no-autolayout")).toEqual(["STRUCT001"]));
// ... one test per remaining fixture, from the v1 table verbatim.
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/struct.test.ts`

- [ ] **Step 3: Port `structure-checker.js` → `src/rules/struct.ts`**

Mechanical translation to TS: keep the single `visit()` walker, the `push()` violation helper, `deepLink()`, `AUTO_NAME_RE`, `SINGLE_CHILD_SHAPE_EXEMPT`, `isVisiblePaint()`. Import `caseMatches` from `core/naming` instead of the local copy. Preserve every rule comment — they encode the false-positive history.

- [ ] **Step 4: Run, verify PASS** (all 11 fixtures). If a fixture disagrees with the v1 table only because of the STRUCT009 strictness change, adjust the *expectation* to the new strict behavior and note it in the test comment.

- [ ] **Step 5: Rebuild + commit**

```bash
node build.mjs && git add src/rules/struct.ts test/fixtures/figma-real/ test/struct.test.ts dist/ && \
git commit -m "v2: port STRUCT001-010 with all false-positive exemptions + real-figma fixtures"
```

---

### Task 9: Drift diff — value / existence / structural, renames, cannot-sync

**Files:**
- Create: `plugins/adhd/src/pipelines/diff.ts`
- Test: `plugins/adhd/test/diff.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Token`, `colorsEqual`, `AdhdLock`.
- Produces:
```ts
export interface Drift {
  valueDrift: Array<{ path: string; collection: string; mode: string; code: string; figma: string }>;
  existence: Array<{ path: string; collection: string; onlyIn: "code" | "figma"; value: string }>;
  structural: Array<{ path: string; kind: "alias-vs-literal" | "alias-target-differs"; code: string; figma: string }>;
  renames: Array<{ from: string; to: string; confidence: "definite" | "probable"; side: "figma" }>;
  cannotSync: Array<{ path: string; side: "code" | "figma"; reason: string }>;
}
export function diffSnapshots(code: Snapshot, figma: Snapshot, opts: { lock: AdhdLock | null; figmaIds: Record<string, string> | null }): Drift;
```
Matching key: `collection + path`. Value comparison: colors via `colorsEqual` (regression-guards the v1 oklch bug), dimensions unit-normalized (`8px` ≡ `8` ≡ `0.5rem` at 16px root — implement `dimensionsEqual` locally: parse number+unit, rem×16, px passthrough, else exact string), everything else exact string. Alias handling: both alias → compare `aliasOf` targets (`alias-target-differs` if different); one alias one literal → `alias-vs-literal` structural drift (never value drift). Renames: **definite** = `opts.lock.figmaIds.variables` has an id whose lock-time path ≠ the same id's current path in `opts.figmaIds` (both entries removed from `existence`); **probable** (no lock) = an existence pair (one `onlyIn: "code"`, one `onlyIn: "figma"`, same collection+domain) whose values are equal and whose paths share ≥ half their segments — pair them, remove from existence. `cannotSync` = every token with `unsyncable` on either side (verbatim reasons).

- [ ] **Step 1: Write failing tests**

`test/diff.test.ts`:
```ts
import { expect, test } from "vitest";
import { diffSnapshots } from "../src/pipelines/diff";
import type { Snapshot } from "../src/core/tokens";

const tok = (path: string, values: any, extra: any = {}) =>
  ({ path, collection: "primitives", domain: "color", values, ...extra });
const snap = (side: "code" | "figma", tokens: any[]): Snapshot => ({ side, tokens, styles: [] });
const noLock = { lock: null, figmaIds: null };

test("oklch in code equals its hex in figma — NO drift (v1 regression)", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/zinc/800", { default: "#27272a" })]),
    snap("figma", [tok("color/zinc/800", { default: "#27272a" })]), noLock);
  expect(d.valueDrift).toEqual([]);
});

test("real value drift is reported per mode", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/zinc/800", { default: "#27272a" })]),
    snap("figma", [tok("color/zinc/800", { default: "#3f3f46" })]), noLock);
  expect(d.valueDrift).toHaveLength(1);
  expect(d.valueDrift[0]).toMatchObject({ path: "color/zinc/800", mode: "default" });
});

test("dimension equivalence: 0.5rem == 8px", () => {
  const d = diffSnapshots(
    snap("code", [tok("spacing/2", { default: "0.5rem" }, { domain: "spacing" })]),
    snap("figma", [tok("spacing/2", { default: "8px" }, { domain: "spacing" })]), noLock);
  expect(d.valueDrift).toEqual([]);
});

test("alias-vs-literal is structural, not value, drift", () => {
  const d = diffSnapshots(
    snap("code", [tok("background", { light: "var(--color-zinc-50)" }, { collection: "semantic", aliasOf: "color/zinc/50" })]),
    snap("figma", [tok("background", { light: "#fafafa" }, { collection: "semantic" })]), noLock);
  expect(d.valueDrift).toEqual([]);
  expect(d.structural).toHaveLength(1);
  expect(d.structural[0].kind).toBe("alias-vs-literal");
});

test("definite rename via lock IDs; pair removed from existence", () => {
  const lock: any = { figmaIds: { variables: { "VariableID:1:1": "color/brand/gold" }, styles: {} },
    baseSnapshot: snap("figma", []), components: [], lastSync: { at: "", figmaHash: "" } };
  const d = diffSnapshots(
    snap("code", [tok("color/brand/gold", { default: "#d4a017" })]),
    snap("figma", [tok("color/brand/golden", { default: "#d4a017" })]),
    { lock, figmaIds: { "VariableID:1:1": "color/brand/golden" } });
  expect(d.renames).toEqual([{ from: "color/brand/gold", to: "color/brand/golden", confidence: "definite", side: "figma" }]);
  expect(d.existence).toEqual([]);
});

test("probable rename heuristic without a lock", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/brand/gold", { default: "#d4a017" })]),
    snap("figma", [tok("color/brand/golden", { default: "#d4a017" })]), noLock);
  expect(d.renames[0]?.confidence).toBe("probable");
});

test("unsyncable tokens land in cannotSync with reasons, on both sides", () => {
  const d = diffSnapshots(
    snap("code", [tok("color/weird", { default: "oklch(from var(--x) l c h)" }, { unsyncable: "relative color" })]),
    snap("figma", [tok("color/rogue", { default: "#000000" }, { unsyncable: "collection 'Brand Extras'..." })]), noLock);
  expect(d.cannotSync).toHaveLength(2);
});
```

- [ ] **Step 2: Run, verify FAIL**, **Step 3: implement `diff.ts`** per the Interfaces block (single pass building maps keyed by `collection:path`, then the rename post-passes), **Step 4: verify PASS**, **Step 5:**

```bash
node build.mjs && git add src/pipelines/diff.ts test/diff.test.ts dist/ && \
git commit -m "v2: three-class drift diff with lock-based definite renames"
```

---

### Task 10: Off-system scan

**Files:**
- Create: `plugins/adhd/src/rules/off-system.ts`
- Test: `plugins/adhd/test/off-system.test.ts`

**Interfaces:**
- Produces:
```ts
export interface OffSystemFinding { file: string; line: number; snippet: string; kind: "arbitrary-class" | "inline-hex"; nearestToken?: { path: string; exact: boolean }; }
export function scanOffSystem(files: Array<{ path: string; content: string }>, code: Snapshot): OffSystemFinding[];
```
Scope (spec §6 — deliberately narrow to avoid a false-positive swamp): Tailwind arbitrary-value classes matching `/\b[a-z-]+-\[[^\]]+\]/` in `.tsx/.jsx/.ts/.js` file contents, and hex colors in string literals. Lines containing `adhd:off-system` are skipped (the sanctioned escape marker). `nearestToken`: exact when a color token's value `colorsEqual`s the literal (or a dimension token equals it); near (`exact: false`) when a color is within epsilon 0.02.

- [ ] **Step 1: Write failing tests**

`test/off-system.test.ts`:
```ts
import { expect, test } from "vitest";
import { scanOffSystem } from "../src/rules/off-system";
import type { Snapshot } from "../src/core/tokens";

const code: Snapshot = { side: "code", styles: [], tokens: [
  { path: "color/zinc/800", collection: "primitives", domain: "color", values: { default: "#27272a" } },
  { path: "spacing/2", collection: "primitives", domain: "spacing", values: { default: "8px" } },
]};

test("flags arbitrary classes and maps to the exact token", () => {
  const f = scanOffSystem([{ path: "app/x.tsx", content: `<div className="bg-[#27272a] p-2" />` }], code);
  expect(f).toHaveLength(1);
  expect(f[0]).toMatchObject({ kind: "arbitrary-class", nearestToken: { path: "color/zinc/800", exact: true } });
});

test("skips lines marked adhd:off-system", () => {
  const f = scanOffSystem([{ path: "a.tsx", content: `x // adhd:off-system — legacy\nconst c = "bg-[#123456]";` }], code);
  expect(f.map((x) => x.line)).toEqual([2]);
});

test("dimension arbitrary value maps to spacing token", () => {
  const f = scanOffSystem([{ path: "a.tsx", content: `"p-[8px]"` }], code);
  expect(f[0]?.nearestToken).toMatchObject({ path: "spacing/2", exact: true });
});
```

- [ ] **Step 2: FAIL → Step 3: implement** (line-by-line scan; two regexes: `/\b[a-z][a-z-]*-\[([^\]]+)\]/g` and `/#[0-9a-fA-F]{3,8}\b/g` outside the first's matches; token lookup builds one array of `{path, kind, hexOrPx}` from the snapshot once), **Step 4: PASS → Step 5:**

```bash
node build.mjs && git add src/rules/off-system.ts test/off-system.test.ts dist/ && \
git commit -m "v2: off-system scan (arbitrary classes + inline hex, token-matched)"
```

---

### Task 11: Report formatter

**Files:**
- Create: `plugins/adhd/src/pipelines/report.ts`
- Test: `plugins/adhd/test/report.test.ts`, golden: `plugins/adhd/test/fixtures/report-golden.md`

**Interfaces:**
- Consumes: `Violation[]`, `Drift`, `OffSystemFinding[]`.
- Produces:
```ts
export interface LintResult { violations: Violation[]; drift: Drift | null; offSystem: OffSystemFinding[];
  meta: { target: string; targetUrl: string | null; mode: "live" | "offline"; lockPresent: boolean } }
export function formatReport(r: LintResult): string;   // markdown; PR-body-ready
export function errorCount(r: LintResult): number;     // violations(error) + valueDrift + existence + structural (renames/off-system/cannot-sync are warnings)
```
Report sections in order: header (`# ADHD lint report`, target, mode, `N errors, M warnings` — **no timestamp**: the report must be byte-stable for goldens and PR diffs), `## Structure` (violations grouped by rule, each with nodePath + deepLink), `## Drift` (three sub-sections), `## Likely renames` (with confidence), `## Off-system values in code`, `## Cannot sync` (path + side + reason — always rendered when non-empty, per the no-silent-loss constraint), and when `!lockPresent` a one-line note: `> No adhd.lock.json — drift is two-way (cannot attribute changes to a side); renames are heuristic.`

- [ ] **Step 1: Write the test with an inline fixture covering EVERY section, snapshot to the golden file**

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { formatReport, errorCount } from "../src/pipelines/report";
// build a LintResult literal with ≥1 item in every section (reuse shapes from Tasks 8-10 tests)
// ...
test("golden report", () => {
  const md = formatReport(result);
  expect(md).toBe(readFileSync(new URL("./fixtures/report-golden.md", import.meta.url), "utf8"));
});
test("errorCount counts errors + all drift, not warnings", () => {
  expect(errorCount(result)).toBe(/* hand-count from the fixture literal */);
});
```
First run: write `formatReport`, eyeball its output, THEN freeze it as the golden (create the golden from the reviewed output — do not reverse-engineer).

- [ ] **Step 2–4: FAIL → implement → PASS** (pure string building; ~120 lines; keep v1 report-formatter's deepLink/hint affordances — see `plugins/adhd/lib/lint-engine/report-formatter.js` for tone).

- [ ] **Step 5:**
```bash
node build.mjs && git add src/pipelines/report.ts test/report.test.ts test/fixtures/report-golden.md dist/ && \
git commit -m "v2: lint report formatter (byte-stable, PR-body-ready)"
```

---

### Task 12: CLI wiring + end-to-end golden test

**Files:**
- Modify: `plugins/adhd/src/cli.ts`
- Create: `plugins/adhd/src/pipelines/lint.ts`
- Test: `plugins/adhd/test/cli-e2e.test.ts`

**Interfaces:**
- Produces the CLI contract the skill (Task 13) depends on — exact invocations:
```
node dist/adhd.js figma-script extract [--cursor <cursor>]
    → stdout: the ready-to-run use_figma script (dist/figma-scripts.json's extract with
      "__ADHD_ARGS__" replaced by JSON.stringify({cursor})). Never printed with placeholders.
node dist/adhd.js lint --dir <consumer-cwd> --figma-chunks <dir-of-NN.json> [--scope <figma-url>] --out <report.md> [--check]
node dist/adhd.js lint --dir <consumer-cwd> --offline --out <report.md> [--check]
    → writes report; prints "N errors, M warnings"; exit 1 iff --check and errorCount > 0;
      exit 2 on operational failure (bad config, unreadable chunks) with AdhdError fixup text.
```
- `pipelines/lint.ts`: `runLint(opts: { dir: string; chunksDir?: string; offline: boolean; scopeUrl?: string }): Promise<LintResult>` — loads config+lock, parses CSS (`resolveCssEntry`), builds figma snapshot from chunks (or `lock.baseSnapshot` when offline; offline with no lock ⇒ AdhdError "run a first sync or provide --figma-chunks"), runs `checkStructure` on any node tree present in chunks (M1: structure runs when the chunks include a `nodeTree` field — the extract script does not capture node trees yet; that arrives with scoped lint in M2's serialize-component work; the wiring + flag parsing land now so the report shape is final), `diffSnapshots`, `scanOffSystem` over `git ls-files "*.tsx" "*.jsx"` under `--dir`.
- `--scope <figma-url>`: validates the URL's file key against config (`fileKeyFromUrl` both sides; mismatch ⇒ AdhdError with both keys shown).

- [ ] **Step 1: Write the e2e test** — drive `runLint` directly (not a subprocess) against: a temp consumer dir containing `adhd.config.json` + the sample globals.css + one `.tsx` file with a `bg-[#...]` literal; `--figma-chunks` = chunk JSONs produced by running Task 7's `extractAll()` against `test/recordings/tokens-doc.json` and writing each chunk to `<tmp>/00.json…`. Assert: report contains all expected sections; `errorCount` matches hand-count; offline mode with a hand-built lock produces a report with the no-figma note absent and same drift vs `baseSnapshot`.

- [ ] **Step 2: FAIL → Step 3: implement `lint.ts` + register `figma-script` and `lint` in `cli.ts`** (args parsed with `node:util parseArgs`), **Step 4: PASS + a real subprocess smoke:**

Run: `node dist/adhd.js figma-script extract | grep -c __ADHD_ARGS__`
Expected: `0` (placeholder replaced).

- [ ] **Step 5:**
```bash
node build.mjs && git add src/cli.ts src/pipelines/lint.ts test/cli-e2e.test.ts dist/ && \
git commit -m "v2: adhd CLI — figma-script + lint subcommands, e2e golden"
```

---

### Task 13: Rewrite the lint skill as a thin wrapper + README row

**Files:**
- Modify: `plugins/adhd/skills/lint/SKILL.md` (full rewrite)
- Modify: `README.md` (the `/adhd:lint` row + scoped-lint section)

**Interfaces:**
- Consumes: the exact CLI contract from Task 12. The skill contains **zero** scripts, zero heredocs, zero JSON composition.

- [ ] **Step 1: Rewrite SKILL.md** (target < 80 lines). Frontmatter keeps `disable-model-invocation: true`, `argument-hint: "[<figma-url>] [--check]"`, allowed-tools `Read Write Bash mcp__plugin_figma_figma__use_figma`. Body, in full:

````markdown
# ADHD Lint

Read-only report: Figma structure violations + code↔Figma drift. All logic lives in
the bundled CLI; your only jobs are relaying scripts to Figma and saving responses.

## Steps

1. **Workdir.** Set `WORK=<session scratchpad>/adhd-lint` and `mkdir -p "$WORK"`.
2. **Extract loop.** Run `node <plugin-root>/dist/adhd.js figma-script extract` and call
   `use_figma` with the printed script verbatim as `code`. Save the JSON response to
   `$WORK/chunk-00.json`. While the response has `"done": false`, re-run with
   `--cursor <cursor from the response>` and save to `chunk-01.json`, `chunk-02.json`, …
   Never edit the script or the responses.
3. **Lint.** Run:
   `node <plugin-root>/dist/adhd.js lint --dir . --figma-chunks "$WORK" --out "$WORK/report.md"`
   plus `--scope <figma-url>` if the user passed a URL, plus `--check` if they passed it.
4. **Report.** Read `$WORK/report.md` and print it. If the CLI exited 2, show its error
   and fixup text and stop — do not improvise recovery.

`<plugin-root>` is this skill file's grandparent directory (`skills/lint/../..`).

## Errors

The CLI's stderr always contains the fix-up guidance (missing config → run /adhd:config,
file-key mismatch, corrupted chunks). Surface it verbatim.
````

- [ ] **Step 2: Update README** — replace the `/adhd:lint` row's description with the v2 semantics (structure + drift + renames + off-system + cannot-sync; `--check`), and note in the scoped-lint section that `--offline` exists for CI once a lock file lands (M2).

- [ ] **Step 3: Manual verification** — from `example/`: run `/adhd:lint` in a Claude Code session against the real configured Figma file (needs `adhd.config.json` in `example/` — create it from the existing `adhd.config.ts` values by hand for now; v1 config migration is M5). Expect: a report, no hand-authored scripts anywhere in the transcript, ≤ 6 tool calls for a small file.

- [ ] **Step 4: Commit**
```bash
git add plugins/adhd/skills/lint/SKILL.md README.md
git commit -m "v2: /adhd:lint as a thin wrapper over the CLI (README row updated)"
```

---

### Task 14: CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a `v2` job** alongside the existing jobs (v1 lib tests keep running until M5):
```yaml
  v2:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: plugins/adhd/package-lock.json }
      - run: npm ci
        working-directory: plugins/adhd
      - run: node build.mjs --check     # committed dist must match src
        working-directory: plugins/adhd
      - run: npx vitest run
        working-directory: plugins/adhd
```

- [ ] **Step 2: Verify locally** — `cd plugins/adhd && npm ci && node build.mjs --check && npx vitest run` all green.

- [ ] **Step 3: Commit; open the M1 PR**
```bash
git add .github/workflows/ci.yml && git commit -m "v2: CI job — dist freshness + vitest"
git push -u origin adhd/v2
gh pr create --title "ADHD v2 Milestone 1: core + lint" --body "$(cat <<'EOF'
Implements Milestone 1 of docs/superpowers/specs/2026-07-05-adhd-v2-rebuild-design.md:
TypeScript core (color/naming/css/snapshot/config/lock), cursor-chunked Figma extract
with fake-figma test harness, STRUCT001-010 ported with fixtures, three-class drift
diff with rename detection, off-system scan, and /adhd:lint as a thin CLI wrapper.
v1 remains untouched and its CI still runs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (resolved during planning)

- **Structure rules vs extract script**: the M1 extract captures variables+styles only; node-tree capture (whole-file structural lint) is wired but arrives with M2's serializer. `/adhd:lint` in M1 therefore reports drift/off-system/cannot-sync always, structure when chunks carry `nodeTree`. This is stated in Task 12 and the report's mode line — an honest, explicit gap rather than a silent one, consistent with the spec's no-silent-loss rule. If full structural lint is wanted inside M1, add the serializer task from M2 forward — decision for the executor's reviewer.
- **`fnv1a64` split-arithmetic**: flagged as fiddly; the test accepts the simpler dual-seed 32-bit fallback documented in Task 2.
- **STRUCT009 strictness change** is deliberate and called out in Tasks 2 and 8 (the v1 loophole regex is retired; segment-splitting replaces it).
- Type/name consistency verified across tasks: `Snapshot`/`Token` (T4) consumed by T5/T7/T9/T10; `Violation` (T8) by T11/T12; `Drift` (T9) by T11/T12; `LintResult` (T11) by T12; CLI contract (T12) by T13.
