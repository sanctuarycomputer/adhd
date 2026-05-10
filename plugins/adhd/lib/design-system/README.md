# design-system

Pure-JS engine that powers `/adhd:push-design-system` and
`/adhd:pull-design-system`. Parses both sides (globals.css and Figma
variables) into a canonical `DesignSystem` shape, compares them, and
emits conflict reports / write actions.

## Architecture

- `code-parser.js` — globals.css → DesignSystem
- `figma-parser.js` — use_figma extract result → DesignSystem
- `comparator.js` — { same, conflict, codeOnly, figmaOnly }
- `code-writer.js` — DesignSystem → globals.css edits
- `figma-write-actions.js` — resolved diff → action list
- `figma-extract-script.js` — JS to inject into use_figma to read state
- `figma-write-script.js` — JS to inject into use_figma to apply actions
- `cli.js` — orchestrator

## Tests

```bash
node --test plugins/adhd/lib/design-system/__tests__/
```
