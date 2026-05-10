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

After install, four slash commands are available:

| Command | Direction | What it does |
|---|---|---|
| `/adhd:config` | — | Interactive wizard that produces `adhd.config.ts` |
| `/adhd:lint` | read-only | Validates a Figma frame/page against local theme + structure best-practices |
| `/adhd:sync` | Figma → code | Pulls Figma values for the variables a frame uses into `globals.css` |
| `/adhd:export-for-figma` | code → Figma | Generates a DTCG JSON file you import into Figma via TokensBrücke |
| `/adhd:to-dtcg` | utility | Model-invocable converter wrapped by the user-facing skills |

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
/adhd:export-for-figma         # generate adhd-export-for-figma.json
/adhd:sync --dry-run           # see what /adhd:sync would change
/adhd:sync                     # apply (Figma → code; will prompt before writing)
```

For the export → Figma flow, the recommended import plugin is **[TokensBrücke](https://www.figma.com/community/plugin/1254538877056388290/tokensbr%C3%BCcke)**. See `plugins/adhd/lib/to-dtcg/README.md` for the recommended export settings and known round-trip caveats.

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
│   ├── skills/                   # config, sync, export-for-figma, to-dtcg
│   ├── lib/to-dtcg/              # zero-deps Node converter (CLI + tests + fixtures)
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
