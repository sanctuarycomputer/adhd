# Repo layout

This repo is the **`adhd` plugin marketplace** plus a **Next.js example consumer**.

- `plugins/`, `docs/`, `scripts/`, `.claude-plugin/`, `.github/` — plugin source, specs/plans, CI, marketplace metadata. Edit these for plugin work.
- `example/` — a Next.js 16 + Tailwind v4 app that demonstrates the plugin in use. Includes `adhd.config.ts`, `app/globals.css`, dependencies, etc. Has its own `AGENTS.md` with Next.js–specific guidance — read it before editing anything in `example/`. Run plugin slash commands from inside `example/` so relative paths resolve like a real consumer's repo.

# Conventions

**Keep `README.md` in sync with the plugin's commands.** Any time you add, remove, rename, or change a slash command's `argument-hint` in `plugins/adhd/skills/*/SKILL.md`, update the command table and any usage examples in the root `README.md` in the same PR. The README is the public surface — drift between SKILL frontmatter and README docs is a bug.
