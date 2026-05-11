# lib/install-design-system-docs-route

Deterministic helpers for `/adhd:install-design-system-docs-route`. The
skill (at `plugins/adhd/skills/install-design-system-docs-route/SKILL.md`)
is the orchestrator; this library is the testable engine.

Modules:
- `token-parser.js` — extract design-system tokens from a globals.css `@theme` block
- `prop-parser.js` — extract a component's prop interface
- `slug.js` — component path → URL slug
- `next-config-patcher.js` — idempotent patch of next.config.{ts,mjs,js}
- `robots-patcher.js` — idempotent patch of public/robots.txt
- `route-installer.js` — write the 4 generated files at the target path
- `templates.js` — page template strings
- `cli.js` — orchestrator surface invoked by SKILL.md

See `docs/superpowers/specs/2026-05-11-adhd-install-design-system-docs-route.md`
for the authoritative spec.
