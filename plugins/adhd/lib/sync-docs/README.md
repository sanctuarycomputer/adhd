# lib/sync-docs

Deterministic helpers for `/adhd:sync-docs`. The skill (at
`plugins/adhd/skills/sync-docs/SKILL.md`) is the orchestrator; this
library is the testable engine.

Modules:
- `token-parser.js` — extract design-system tokens from a globals.css `@theme` block
- `prop-parser.js` — extract a component's prop interface
- `slug.js` — component path → URL slug
- `config-parser.js` — parse `adhd.config.ts` at sync time (components + cssEntry)
- `next-config-patcher.js` — idempotent patch of next.config.{ts,mjs,js}
- `robots-patcher.js` — idempotent patch of public/robots.txt
- `route-installer.js` — write the generated files at the target path, including per-sync `componentMap.tsx` and `tokenDomains.tsx` modules
- `templates.js` — page template strings (with substitution placeholders)
- `cli.js` — orchestrator surface invoked by SKILL.md

See `docs/superpowers/specs/2026-05-11-adhd-install-design-system-docs-route.md`
for the historical spec.
