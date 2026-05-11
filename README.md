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

After install, seven slash commands are available:

| Command | Args | Direction | What it does |
|---|---|---|---|
| `/adhd:config` | — | — | Interactive wizard that produces `adhd.config.ts`. Verifies the official Figma plugin is installed + authenticated before anything else. |
| `/adhd:lint` | `[<figma-url>]` | read-only | Validates the Figma file (whole file or scoped) against the local design system + structure best-practices |
| `/adhd:push-design-system` | — | code → Figma | Pushes globals.css variables + named styles into Figma directly via the remote MCP |
| `/adhd:pull-design-system` | — | Figma → code | Pulls Figma variables + named styles into globals.css |
| `/adhd:push-component` | `<path> [--max-variants <n>]` | code → Figma | Pushes a React component to Figma as a structured Component Set with variant properties + variable bindings, plus a preflight lint check |
| `/adhd:pull-component` | `<path \| figma-url> [--allow-unbound]` | Figma → code | Pulls a Figma Component Set into a React source file; updates lookup tables and union types only (function body untouched) |
| `/adhd:install-design-system-docs-route` | — | install | One-shot installer for a live, self-generating design-system docs route in your Next.js consumer app. Reads adhd.config.ts + globals.css at request time. Excluded from production builds by default. |

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
/adhd:push-design-system                         # apply (code → Figma; will prompt before writing)
/adhd:pull-design-system                         # apply (Figma → code; will prompt before writing)
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

The scoped report covers the same rules (STRUCT001–010 + variable mismatches), just narrowed to the selected subtree. The URL must point at the file configured in `adhd.config.ts`; mismatched file keys abort with a fix-up message.

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
/adhd:install-design-system-docs-route
```

This installs a live, self-generating documentation page that reads your
`adhd.config.ts` and `globals.css` at request time. The default URL is
`/-docs` (the hyphen prefix telegraphs "internal"), and files live under a
Next.js route group at `app/(design-system)/-docs/`. The page is a
sidebar-and-viewer layout:

- Sidebar: lists every Tailwind v4 token domain (colors, spacing, typography,
  font families, font weights, tracking, leading, radius, shadows,
  breakpoints, easing, animation), plus every component tracked in
  `adhd.config.ts`. Click a row to load that route in the main pane.
- Token pages: render whatever your `@theme` (or `@theme inline`) block
  declares for that domain. Empty domains link to Tailwind v4's docs for the
  defaults you're inheriting.
- Component pages: each component gets its own route with URL-driven prop
  toggles, derived from the component's TypeScript prop interface.

By default the route is excluded from production builds via Next.js's
`pageExtensions` trick — files use the `.design-system.tsx` extension and
the production build literally doesn't see them. You can opt out at install
time if you'd rather ship the route (it still has `<meta name="robots"
content="noindex, nofollow" />` either way).

Re-run the installer over time to pick up improved templates. Files you've
customized — by removing the `// design-system-docs-route` marker comment —
are left alone.

#### Caveat: broad dynamic import + Tailwind v4

The component page resolves its target via `import("@/" + componentPath)` so
adding to `adhd.config.ts` is enough — no re-install per component. The
trade-off: Webpack/Turbopack can't statically resolve the path, so it
creates a context module that pulls every `.ts`/`.tsx` under your project
root into this route's bundle. Tailwind v4 then scans all of them for
classes — a much wider surface than your other routes touch.

If your codebase has shadcn-v3-era classes that you never migrated (most
commonly `ring-offset-background`, used by Button/Input focus styles),
they'll surface as `Cannot apply unknown utility class …` errors during
route compilation, and the page will 500 with an ENOENT on
`app-build-manifest.json`. The layout pre-scans your `globals.css` for the
shadcn shibboleth and shows a diagnostic banner with the exact `@theme`
addition you need to make. There's also an `error.tsx` at the route boundary
for any runtime failures, and a Troubleshooting section on the landing page.

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
│   ├── skills/                   # config, lint, push-design-system, pull-design-system
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
