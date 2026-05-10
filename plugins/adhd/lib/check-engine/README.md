# check-engine

Pure-JS engine that powers `/adhd:check` and `/adhd:sync`. Takes pre-fetched
Figma MCP responses + a local `globals.css` and produces a violation report.

## Usage

```bash
node plugins/adhd/lib/check-engine/cli.js \
  --variable-defs /tmp/vars.json \
  --design-context /tmp/ctx.json \
  --globals-css example/app/globals.css \
  --config example/adhd.config.ts \
  --target "Page 1 / Card" \
  --target-url "https://figma.com/design/<file>?node-id=123-456" \
  --output adhd-check-report.md
```

Emits the full markdown report to `--output` and a JSON summary to stdout.
Exit 0 = no errors (warnings allowed); exit 1 = at least one error.

## Tests

```bash
node --test plugins/adhd/lib/check-engine/__tests__/
```

## Architecture

- `name-normalizer.js` — Figma path ↔ CSS var name
- `value-normalizer.js` — domain-aware comparable values
- `theme-parser.js` — globals.css → comparable map
- `variable-categorizer.js` — missing / same / conflict
- `structure-checker.js` — STRUCT001–STRUCT010
- `report-formatter.js` — markdown output
- `cli.js` — orchestrator
