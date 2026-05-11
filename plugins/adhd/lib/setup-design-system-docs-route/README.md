# lib/setup-design-system-docs-route

Deterministic helpers for `/adhd:setup-design-system-docs-route`. The
skill (at `plugins/adhd/skills/setup-design-system-docs-route/SKILL.md`)
is the orchestrator; this library is the testable engine.

Modules:
- `token-parser.js` — extract design-system tokens from a globals.css `@theme` block
- `prop-parser.js` — extract a component's prop interface
- `slug.js` — component path → URL slug
- `config-parser.js` — parse `adhd.config.ts` at install time (components + cssEntry)
- `next-config-patcher.js` — idempotent patch of next.config.{ts,mjs,js}
- `robots-patcher.js` — idempotent patch of public/robots.txt
- `route-installer.js` — write the seven generated files at the target path, including a per-install `componentMap.tsx` with static imports
- `templates.js` — page template strings (with substitution placeholders)
- `cli.js` — orchestrator surface invoked by SKILL.md

See `docs/superpowers/specs/2026-05-11-adhd-install-design-system-docs-route.md`
for the historical spec.
