# lib/pull-component

Deterministic config-writer for `/adhd:pull-component`. The skill itself
(at `plugins/adhd/skills/pull-component/SKILL.md`) is the orchestrator
and handles all the LLM-driven work — reading the React source,
extracting the Figma Component Set, computing the diff, prompting the
user, applying Edit-tool changes.

This library is intentionally tiny: it only contains the schema-level
mutation of `adhd.config.ts` (adding/reading component mappings under
`components.<path>.figma.url`). Anything more intelligent lives in
the SKILL prompt where the LLM can reason about it.

See `docs/superpowers/specs/2026-05-10-adhd-pull-component.md` for the
authoritative spec.
