<!-- BEGIN:adhd-repo-layout -->
# Repo layout

This repo is the **`adhd` plugin marketplace** plus a **Next.js example consumer**.

- `plugins/`, `docs/`, `scripts/`, `.claude-plugin/`, `.github/` — plugin source, specs/plans, CI, marketplace metadata. Edit these for plugin work.
- `example/` — a Next.js 16 + Tailwind v4 app that demonstrates the plugin in use. Includes `adhd.config.ts`, `app/globals.css`, dependencies, etc. Run plugin slash commands from inside this dir (`cd example`) so relative paths resolve like a real consumer's repo.
<!-- END:adhd-repo-layout -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

The example app is Next.js 16 — breaking changes from your training data on APIs, conventions, and file structure. Read the relevant guide in `example/node_modules/next/dist/docs/` before writing Next.js code in `example/`. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
