# push-component

Pure-JS engine that powers `/adhd:push-component`. Parses a React component
file's variant axes, emits a temp Next.js preview page for `generate_figma_design`
capture, then assembles a `use_figma` consolidation script that wraps the
captured frames into a Component Set with variant properties + variable bindings.

The preflight lint step calls `lib/lint-engine/`'s existing modules — same code
path /adhd:lint uses, no duplicates.

## Subcommands

- `parse <component-path>` — TS analysis → manifest JSON
- `generate-preview` — manifest → preview TSX
- `consolidation-script` — manifest + captured page ID → use_figma JS string
- `preflight` — Figma extract → lint report

## Tests

```bash
node --test plugins/adhd/lib/push-component/__tests__/
```
