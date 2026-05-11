# ADHD — Agent-Driven Harmonious Development

This repo is **two things at once**:

1. A Claude Code marketplace hosting the **`adhd`** plugin — slash commands that keep design tokens synchronized between a Tailwind v4 codebase and a Figma file.
2. A Next.js 16 + Tailwind v4 reference app under `example/` that demonstrates the plugin in use, with component patterns (Avatar, AvatarGroup) and a three-layer design-token architecture (primitives → semantic roles → Tailwind exposure).

Plugin source lives at the repo root (`plugins/`, `docs/`, `scripts/`, etc.). The Next.js app lives in `example/` so the root stays clean.

## ADHD Plugin — Install

```
/plugin marketplace add /absolute/path/to/this/repo
/plugin install adhd@adhd-reference
```

Both commands are persistent — Claude Code remembers the marketplace and the enabled plugin across sessions. Run them once per machine.

After install, six slash commands are available:

| Command | Args | Direction | What it does |
|---|---|---|---|
| `/adhd:config` | — | — | Interactive wizard that produces `adhd.config.ts` |
| `/adhd:lint` | `[<figma-url>]` | read-only | Validates the Figma file (whole file or scoped) against the local design system + structure best-practices |
| `/adhd:push-design-system` | — | code → Figma | Pushes globals.css variables + named styles into Figma directly via the remote MCP |
| `/adhd:pull-design-system` | — | Figma → code | Pulls Figma variables + named styles into globals.css |
| `/adhd:push-component` | `<path> [--max-variants <n>]` | code → Figma | Pushes a React component to Figma as a structured Component Set with variant properties + variable bindings, plus a preflight lint check |
| `/adhd:pull-component` | `<path \| figma-url> [--allow-unbound]` | Figma → code | Pulls a Figma Component Set into a React source file; updates lookup tables and union types only (function body untouched) |

`/adhd:push-design-system`, `/adhd:pull-design-system`, `/adhd:lint`, and `/adhd:push-component` all require the official Figma plugin — install it with:

```
claude plugin install figma@claude-plugins-official
```

## ADHD Plugin — Use in your repo

In your consumer repo, run `/adhd:config`. The wizard walks through:

1. Domains to sync (default: all five — colors, spacing, typography, radius, shadow)
2. Figma file URL + reachability test via the Figma MCP
3. CSS entry path auto-detect (`app/globals.css` or `src/app/globals.css`)

It produces `adhd.config.ts` at the repo root:

```ts
const config = {
  figma: {
    url: "https://www.figma.com/design/<KEY>/<NAME>",
  },
  // optional: domains: [...],
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
