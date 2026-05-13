# This is NOT the Next.js you know

This is Next.js 16 — breaking changes from your training data on APIs, conventions, and file structure. Read the relevant guide in `node_modules/next/dist/docs/` (after running `npm install`) before writing Next.js code here. Heed deprecation notices.

# Tailwind

This app uses Tailwind v4 (CSS-first, no `tailwind.config.js`). Theme tokens live in `app/globals.css` under `@theme` blocks — that's the file `/adhd:sync` writes to.

# Running plugin commands

Run `/adhd:config`, `/adhd:export-for-figma`, `/adhd:sync`, etc. from this directory (`example/`) — relative paths in `adhd.config.ts` are resolved relative to CWD.
