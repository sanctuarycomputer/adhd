# ADHD — Agent-Driven Harmonious Development

This repo is **two things at once**:

1. A Claude Code marketplace hosting the **`adhd`** plugin — slash commands that keep design tokens synchronized between a Tailwind v4 codebase and a Figma file.
2. A Next.js 16 + Tailwind v4 reference app under `example/` that demonstrates the plugin in use, with component patterns (Avatar, AvatarGroup) and a three-layer design-token architecture (primitives → semantic roles → Tailwind exposure).

Plugin source lives at the repo root (`plugins/`, `docs/`, `scripts/`, etc.). The Next.js app lives in `example/` so the root stays clean.

## ADHD Plugin — Install

ADHD requires the **official Figma plugin** from the Claude Code marketplace for every command — it's how every skill talks to Figma. Install it first:

```
claude plugin install figma@claude-plugins-official
```

Then install ADHD itself:

```
/plugin marketplace add /absolute/path/to/this/repo
/plugin install adhd@adhd-reference
```

All three commands are persistent — Claude Code remembers the marketplaces and the enabled plugins across sessions. Run them once per machine.

After install, nine slash commands are available:

| Command | Args | Direction | What it does |
|---|---|---|---|
| `/adhd:config` | — | — | Interactive wizard that produces `adhd.config.ts`. Verifies the official Figma plugin is installed + authenticated before anything else. |
| `/adhd:lint` | `[<figma-url>]` | always interactive | Validates the Figma file (whole file or scoped) against the local design system + structure best-practices, then walks every violation through a per-rule resolution wizard. Per violation, designers pick from auto-fix in Figma (rebind to canonical / consolidate duplicates), add in code, take Figma's value, take code's value, annotate only, or skip. No flags — annotation and fix behavior are per-violation choices. |
| `/adhd:push-tokens` | `[--dry-run]` | code → Figma | Pushes globals.css variables + named styles into Figma directly via the remote MCP. Runs an interactive 7-question wizard on every invocation to set per-domain push policy: push the full Tailwind palette or only your semantic colors? Push the full spacing scale or only your authored tokens? Skip opacity entirely? Route shadows through effect styles? `--dry-run` previews exactly what would be added or skipped (reflecting your wizard answers) without writing. |
| `/adhd:pull-tokens` | `[--dry-run]` | Figma → code | Pulls Figma variables + named styles into globals.css. `--dry-run` previews without writing. |
| `/adhd:push-component` | `<path> [--max-variants <n>]` | code → Figma | Pushes a React component to Figma as a structured Component Set with variant properties + variable bindings, plus a preflight lint check. Per-variable STRUCT015/STRUCT016 resolution prompts let you sync mismatches in either direction; annotations land automatically on any abort. |
| `/adhd:push-all-components` | `[--continue-on-error] [--max-variants <n>]` | code → Figma | Bulk version of `push-component` — iterates over every entry in `adhd.config.ts`'s components map. Sequential, halt-on-first-failure by default. |
| `/adhd:pull-component` | `<path \| figma-url> [--allow-unbound]` | Figma → code | Pulls a Figma Component Set into a React source file; updates lookup tables and union types only (function body untouched). Per-variable STRUCT015/STRUCT016 resolution prompts let you sync mismatches in either direction; annotations land automatically on any abort. Records an 8-char fingerprint + ISO `pulledAt` in `adhd.config.ts`; subsequent pulls short-circuit (no lint, no diff, no commit) when the Figma extract + pull-relevant config still hash to the same value. |
| `/adhd:pull-all-components` | `[--continue-on-error] [--allow-unbound]` | Figma → code | Bulk version of `pull-component` — iterates over every entry in `adhd.config.ts`'s components map. Sequential, halt-on-first-failure by default. Components whose stored fingerprint matches the fresh Figma extract are reported as `unchanged` and skipped (no lint, no diff, no commit). |
| `/adhd:sync-docs` | — | install | Generates a design-system docs route in your Next.js consumer app. Tokens read live from globals.css; components are statically imported from adhd.config.ts at setup time — re-run after editing the components map. Excluded from production builds by default. |

Every command above drives Figma exclusively through the `figma@claude-plugins-official` plugin. `/adhd:config` checks it's installed + authenticated up front so setup errors surface where you can fix them, not mid-pipeline.

## ADHD Plugin — Use in your repo

In your consumer repo, run `/adhd:config`. The wizard walks through:

1. Figma file URL + reachability test via the Figma MCP
2. Naming convention (kebab-case is the default)
3. CSS entry path auto-detect (`app/globals.css` or `src/app/globals.css`)

ADHD always syncs every supported token domain (colors, spacing, typography, radius, shadow, and any future additions). No per-domain opt-out — the design system is treated as a whole.

It produces `adhd.config.ts` at the repo root:

```ts
const config = {
  figma: {
    url: "https://www.figma.com/design/<KEY>/<NAME>",
  },
  // optional: naming: "kebab-case" | "PascalCase" | "camelCase" | false,
  // optional: cssEntry: "src/app/globals.css",
};

export default config;
```

Then:

```
/adhd:lint                                       # validate the whole Figma file
/adhd:lint https://figma.com/design/<KEY>?node-id=12-2   # validate a single page/frame/component
/adhd:push-tokens                                # apply (code → Figma; will prompt before writing)
/adhd:push-tokens --dry-run                      # preview what would change without writing
/adhd:pull-tokens                                # apply (Figma → code; will prompt before writing)
/adhd:pull-tokens --dry-run                      # preview what would change without writing
/adhd:push-component app/components/avatar/index.tsx     # push a React component to Figma
```

### Scoped lint

Pass any Figma URL that includes a `node-id` query parameter — `/adhd:lint` will validate just that subtree (a single Component Set, page, frame, or component) instead of the whole file. Copy the URL straight from Figma's "Copy link to selection" right-click menu.

```
# Whole file
/adhd:lint

# Just the Avatar Component Set on the Avatar page
/adhd:lint https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/ADHD-Reference?node-id=91-18
```

The scoped report covers the same rules (STRUCT001–016 + variable mismatches), just narrowed to the selected subtree. The URL must point at the file configured in `adhd.config.ts`; mismatched file keys abort with a fix-up message.

### Annotate violations in Figma

`/adhd:lint` is always interactive — every violation goes through a per-rule wizard with "Annotate only" as one of the options. Picking it pushes the violation to Figma as a node-bound annotation in a dedicated **"lint"** category (orange); picking anything else either resolves the issue directly (auto-fix in Figma, add in code, take Figma's value, take code's value) or skips it (no annotation, no fix). Stale annotations from prior runs get cleaned up automatically when their nodes drop out of the picks list — designer-authored annotations and any non-"lint" category are never touched.

For `/adhd:push-component` and `/adhd:pull-component`, annotation is **automatic on any abort** — when the SKILL aborts due to preflight violations (including a "Don't sync" pick on the per-variable STRUCT015/STRUCT016 prompts), every blocking violation is pushed to Figma before exit. On successful runs the same annotation script clears prior-run annotations from the scope so Figma stays clean. No flag needed.

```
/adhd:lint                                                # whole file — walks every violation
/adhd:lint https://www.figma.com/design/<KEY>?node-id=91-18 # scoped — walks every violation
/adhd:push-component app/components/avatar/index.tsx       # annotates on abort
/adhd:pull-component https://www.figma.com/design/<KEY>?node-id=91-18 # annotates on abort
```

### Push a component

```
# From the consumer repo with adhd.config.ts at the root
/adhd:push-component app/components/avatar/index.tsx
```

The skill parses the component's TypeScript prop unions, generates a temp preview route, auto-starts the Next.js dev server if needed, captures via `generate_figma_design`, wraps the captured frames into a Component Set with variant properties, rebinds raw values to existing design-system variables, and runs the same lint engine `/adhd:lint` uses as a preflight check before finalizing. If the Cartesian product would exceed 30 variants, pass `--max-variants <n>` to cap with coverage-first selection.

### Pull a component

```
# From the consumer repo, with a mapping already established by /adhd:push-component:
/adhd:pull-component app/components/avatar/index.tsx

# Or by Figma URL — reverse-resolves to the path via adhd.config.ts:
/adhd:pull-component https://www.figma.com/design/<KEY>?node-id=91-18

# Pre-flight is strict by default — if Figma has unbound raw values, pull aborts and asks the designer to bind them.
# To accept hardcoded fallbacks anyway (with adhd:off-system comments for greppability):
/adhd:pull-component app/components/avatar/index.tsx --allow-unbound
```

The skill reads the Figma Component Set, diffs it against the React file's `Record<Union, string>` lookup tables, prompts on each divergence, and rewrites only those tables (plus union type members). Function body, JSX, hooks, handlers, and imports are never modified.

### Design system docs route

Run once in your consumer repo:

```
/adhd:sync-docs
```

This generates a documentation page that reads your `globals.css` live at
request time and statically imports the components listed in
`adhd.config.ts`. The default URL is `/-docs` (the hyphen prefix telegraphs
"internal"), and files live under a Next.js route group at
`app/(design-system)/-docs/`. The page is a sidebar-and-viewer layout:

- Sidebar: lists every Tailwind v4 token domain (colors, spacing, typography,
  font families, font weights, tracking, leading, radius, shadows,
  breakpoints, easing, animation), plus every component tracked in
  `adhd.config.ts`. Click a row to load that route in the main pane.
- Token pages: render whatever your `@theme` (or `@theme inline`) block
  declares for that domain. Empty domains link to Tailwind v4's docs for the
  defaults you're inheriting.
- Component pages: each component gets its own route with URL-driven prop
  toggles, derived from the component's TypeScript prop interface.

The setup command asks **where the docs route should render** with three
options:

- **Dev only** (default) — files use `.design-system.tsx`; `pageExtensions`
  in `next.config.ts` gates on `process.env.NODE_ENV === 'production'`. The
  production build literally doesn't see the files.
- **Dev + Vercel preview** — same file extension, but `pageExtensions`
  gates on `process.env.VERCEL_ENV === 'production' || (!VERCEL && NODE_ENV === 'production')`.
  The route renders on local dev *and* Vercel preview deploys, but stays out
  of Vercel production (and out of any non-Vercel production deploy too, so
  CI builds don't accidentally ship it).
- **Everywhere** — no `pageExtensions` patch; route files use plain `.tsx`
  and ship in production. The layout's metadata still emits `<meta
  name="robots" content="noindex, nofollow" />` so it won't be indexed.

#### Re-running after `adhd.config.ts` changes

The setup command generates a `componentMap.tsx` with explicit static
imports per component. After **adding, renaming, or removing entries** in
`adhd.config.ts`'s `components` map, re-run
`/adhd:sync-docs` to regenerate the static imports.
Tokens don't need this — they're read from `globals.css` at request time.

Files where you've removed the `// design-system-docs-route` marker comment
are preserved across re-runs.

The static-import architecture is deliberate: it keeps the docs route's
bundle scoped to exactly your tracked components, sidestepping the
`Cannot apply unknown utility class …` failure mode that broad dynamic
imports trigger under Tailwind v4 (legacy shadcn classes in unrelated parts
of your codebase get bundled and explode during PostCSS).

You can also trigger the install at the end of `/adhd:config` if you're
setting up ADHD for the first time.

### Figma file structure

The Figma file must follow the structure mandated in the spec — a `Primitives` collection (no modes) and a `Semantic` collection (Light + Dark modes). The skill validates this and surfaces fix-up guidance on failure.

## Reference app — run

```bash
cd example
npm install
npm run dev
```

Open <http://localhost:3000> — the homepage is a variant grid showcasing the Avatar component (sizes, shapes, status, image sources) and the AvatarGroup `surface="brand"` mode using the gold semantic tokens.

To exercise ADHD against the example:

```bash
cd example
# from this directory, slash commands resolve relative paths like a real consumer
# (adhd.config.ts, app/globals.css, node_modules/tailwindcss/theme.css all live here)
```

## Repo layout

```
.
├── plugins/adhd/                 # The plugin source
│   ├── skills/                   # config, lint, push-tokens, pull-tokens
│   ├── lib/                      # zero-deps Node libraries (lint-engine, design-system)
│   └── .claude-plugin/           # plugin manifest
├── docs/superpowers/
│   ├── specs/                    # design specs
│   └── plans/                    # implementation plans
├── scripts/                      # repo-level scripts (skill frontmatter validator)
├── .claude-plugin/               # marketplace declaration
├── .github/workflows/            # CI (lib unit tests + project hygiene)
├── example/                      # Next.js + Tailwind v4 demo consumer
│   ├── app/                      # Next.js App Router source
│   ├── adhd.config.ts            # the example consumer's config
│   ├── package.json              # Next.js / Tailwind / npm deps
│   └── …                         # next.config.ts, tsconfig.json, etc.
└── README.md, AGENTS.md, CLAUDE.md
```

## Built with

- [Next.js 16](https://nextjs.org)
- [React 19](https://react.dev)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
