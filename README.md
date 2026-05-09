# ADHD — Agent-Driven Harmonious Development

This repo is **two things at once**:

1. A Next.js 16 + Tailwind v4 reference app demonstrating component patterns (Avatar, AvatarGroup) and a three-layer design-token architecture (primitives → semantic roles → Tailwind exposure).
2. A Claude Code marketplace hosting the **`adhd`** plugin — a workflow that syncs design tokens between this codebase and a Figma file.

## ADHD Plugin — Install

The plugin lives at `plugins/adhd/`. To use it from any Claude Code session:

```
/plugin marketplace add /absolute/path/to/this/repo
/plugin install adhd@adhd-reference
```

Both commands are persistent — Claude Code stores the marketplace in `~/.claude/plugins/known_marketplaces.json` and remembers the enabled plugin. You only run them once per machine.

After install, the slash command `/adhd:sync` becomes available. It reads `adhd.config.ts` at the consumer repo's root.

## ADHD Plugin — Use

In the consumer repo, create `adhd.config.ts` at the root:

```ts
const config = {
  leader: "figma" as const,           // "figma" pulls to code; "code" pushes to Figma (v2)
  figma: {
    url: "https://www.figma.com/design/<KEY>/<NAME>",
  },
  // optional:
  // domains: ["colors", "spacing", "typography", "radius", "shadow"],
  // cssEntry: "src/app/globals.css",  // defaults to app/globals.css
};

export default config;
```

Then in Claude Code:

```
/adhd:sync --dry-run         # see what would change
/adhd:sync                    # apply leader-wins
/adhd:sync --domains colors   # limit to one domain
```

The Figma file must follow the structure mandated in `docs/superpowers/specs/2026-05-09-adhd-token-sync-design.md` — a `Primitives` collection (no modes) and a `Semantic` collection (Light + Dark modes). The skill validates this and surfaces fix-up guidance on failure.

**v1 limitation:** `leader: "code"` (push to Figma) is not yet supported — the Figma MCP currently exposes only read tools. The skill aborts with a clear message in Phase 1 if this leader is configured. Use `leader: "figma"` for v1.

## Reference App — Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the homepage is currently a variant grid showcasing the Avatar component (sizes, shapes, status, image sources) and the AvatarGroup `surface="brand"` mode that pulls from the gold semantic tokens.

## Architecture Notes

- `app/globals.css` — three-layer Tailwind v4 token architecture (`@theme` primitives, `:root` + `@media dark` semantic roles, `@theme inline` Tailwind exposure). This is the file ADHD edits.
- `app/components/avatar/` and `app/components/avatar-group/` — sibling component folders. AvatarGroup uses `cloneElement` to inject size into Avatar children.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design specs and implementation plans for everything in this repo.
- `plugins/adhd/` — the plugin source.
- `.claude-plugin/marketplace.json` — declares this repo as a marketplace hosting the `adhd` plugin.

## Built With

- [Next.js 16](https://nextjs.org)
- [React 19](https://react.dev)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
