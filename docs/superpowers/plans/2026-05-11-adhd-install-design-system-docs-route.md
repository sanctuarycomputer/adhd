# /adhd:install-design-system-docs-route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/adhd:install-design-system-docs-route` — a one-shot installer that drops a live, self-generating design-system documentation route into a Next.js consumer app.

**Architecture:** Zero-deps Node library at `plugins/adhd/lib/install-design-system-docs-route/`, mirroring the shape of `lib/pull-component/`. Single skill at `plugins/adhd/skills/install-design-system-docs-route/SKILL.md` orchestrating a 9-phase install flow. The installed files are Next.js App Router server components that read `adhd.config.ts` and `globals.css` at request time — no regen needed. Re-running the installer is first-class: marker-comment detection drives wholesale `Write`-replacement of marker-bearing files, leaving marker-removed files alone (the user's opt-out).

**Tech Stack:** Node 20 (lib runs zero-deps), regex-based parsers (matching the established `lib/push-component/parse-component.js` style), `node --test` runner, Next.js App Router file conventions in the consumer app.

---

## File structure (lock-in)

**New library — `plugins/adhd/lib/install-design-system-docs-route/`:**

| File | Responsibility |
|---|---|
| `token-parser.js` | Parse `globals.css` `@theme` block → `{ colors, spacing, typography, radius, shadows, unknown }` |
| `prop-parser.js` | Parse a component source's `<Name>Props` interface → `{ propName: { type, values?, optional } }` |
| `slug.js` | Component path → URL-safe slug; collision detection across the components map |
| `next-config-patcher.js` | Idempotent patch of `next.config.{ts,mjs,js}` to add conditional `pageExtensions` |
| `robots-patcher.js` | Idempotent patch of `public/robots.txt` (Disallow entry; creates file if missing) |
| `route-installer.js` | Orchestrator: writes the 4 generated files at the right paths with the right extensions |
| `templates.js` | Template strings for `layout`, `page` (index), `[component]/page`, `PropToggle`. Exports plain-string content + the marker-comment constant. |
| `cli.js` | Subcommand surface: `parse-tokens`, `parse-props`, `slug`, `patch-next-config`, `patch-robots`, `detect-install`, `install` |
| `README.md` | One-paragraph module readme |
| `__tests__/token-parser.test.js` | Unit tests |
| `__tests__/prop-parser.test.js` | Unit tests |
| `__tests__/slug.test.js` | Unit tests |
| `__tests__/next-config-patcher.test.js` | Unit tests |
| `__tests__/robots-patcher.test.js` | Unit tests |
| `__tests__/route-installer.test.js` | Unit + golden-file tests |
| `__tests__/cli.test.js` | CLI surface tests |
| `__fixtures__/globals.css` | Sample Tailwind v4 globals for token-parser tests |
| `__fixtures__/avatar.tsx` | Sample component source for prop-parser tests |

**New skill — `plugins/adhd/skills/install-design-system-docs-route/SKILL.md`:** the 9-phase orchestrator.

**Modified files:**
- `plugins/adhd/skills/config/SKILL.md` — append optional final phase that invokes the install flow inline
- `.claude-plugin/marketplace.json` — bump description
- `README.md` — add command table row + "Install design system docs route" subsection
- `.github/workflows/ci.yml` — add test step

---

## Task 1: Scaffold lib, CI step, module README, cli stub

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/cli.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/README.md`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing test for cli `--help`**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

test('cli with --help prints subcommand usage and exits 0', () => {
  const r = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /parse-tokens/);
  assert.match(r.stdout, /parse-props/);
  assert.match(r.stdout, /slug/);
  assert.match(r.stdout, /patch-next-config/);
  assert.match(r.stdout, /patch-robots/);
  assert.match(r.stdout, /detect-install/);
  assert.match(r.stdout, /install/);
});

test('cli with no args exits 2', () => {
  assert.equal(spawnSync('node', [CLI], { encoding: 'utf8' }).status, 2);
});

test('cli with unknown subcommand exits 2', () => {
  assert.equal(spawnSync('node', [CLI, 'unknown'], { encoding: 'utf8' }).status, 2);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`
Expected: FAIL — `cli.js` does not exist.

- [ ] **Step 3: Implement cli stub**

`plugins/adhd/lib/install-design-system-docs-route/cli.js`:

```javascript
#!/usr/bin/env node
'use strict';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) { args[a.slice(2)] = argv[++i]; }
    else { args._.push(a); }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js parse-tokens --css <path> --output <json>
  cli.js parse-props --source <component.tsx> --output <json>
  cli.js slug --paths <comma-separated> --output <json>
  cli.js patch-next-config --config <path> --route-url <url>
  cli.js patch-robots --robots <path> --route-url <url>
  cli.js detect-install --app-dir <path>
  cli.js install --config <choices.json>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];
  // Subcommands wired in later tasks. Reject unknown to keep behavior strict.
  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
```

- [ ] **Step 4: Verify cli tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Add module README**

`plugins/adhd/lib/install-design-system-docs-route/README.md`:

```markdown
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
```

- [ ] **Step 6: Add CI step**

Modify `.github/workflows/ci.yml`. In the `lib-tests` job, after the existing `pull-component` test step:

```yaml
      - name: Run install-design-system-docs-route tests
        run: node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/
```

- [ ] **Step 7: Run all tests, verify green**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/`
Expected: 3 cli tests PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route .github/workflows/ci.yml
git commit -m "Scaffold lib/install-design-system-docs-route with cli stub"
```

---

## Task 2: token-parser.js — extract design tokens from globals.css

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/token-parser.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/token-parser.test.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__fixtures__/globals.css`

- [ ] **Step 1: Add the fixture file**

`plugins/adhd/lib/install-design-system-docs-route/__fixtures__/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-zinc-50: oklch(0.985 0 0);
  --color-zinc-900: oklch(0.21 0.034 264.665);
  --color-brand-500: #5e3aee;

  --spacing: 0.25rem;

  --text-xs: 0.75rem;
  --text-xs--line-height: 1rem;
  --text-base: 1rem;
  --text-base--line-height: 1.5rem;

  --radius-sm: 0.25rem;
  --radius-lg: 0.5rem;

  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);

  --font-sans: "Inter", system-ui, sans-serif;
}
```

- [ ] **Step 2: Write failing tests**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/token-parser.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTokens } = require('../token-parser');

const CSS = fs.readFileSync(
  path.resolve(__dirname, '..', '__fixtures__', 'globals.css'),
  'utf8',
);

test('extracts color tokens', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.colors.find(c => c.name === 'zinc-50'),
    { name: 'zinc-50', value: 'oklch(0.985 0 0)' },
  );
  assert.deepEqual(
    t.colors.find(c => c.name === 'brand-500'),
    { name: 'brand-500', value: '#5e3aee' },
  );
});

test('extracts the spacing multiplier', () => {
  const t = parseTokens(CSS);
  assert.equal(t.spacing.multiplier, '0.25rem');
});

test('extracts typography sizes with optional line-heights', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.typography.find(x => x.name === 'xs'),
    { name: 'xs', size: '0.75rem', lineHeight: '1rem' },
  );
  assert.deepEqual(
    t.typography.find(x => x.name === 'base'),
    { name: 'base', size: '1rem', lineHeight: '1.5rem' },
  );
});

test('extracts radius tokens', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.radius.find(r => r.name === 'sm'),
    { name: 'sm', value: '0.25rem' },
  );
});

test('extracts shadow tokens', () => {
  const t = parseTokens(CSS);
  assert.deepEqual(
    t.shadows.find(s => s.name === 'sm'),
    { name: 'sm', value: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
  );
});

test('puts unrecognized @theme vars in `unknown`', () => {
  const t = parseTokens(CSS);
  assert.ok(t.unknown.find(u => u.name === '--font-sans'));
});

test('returns empty domains when no @theme block exists', () => {
  const t = parseTokens('body { color: red; }');
  assert.deepEqual(t.colors, []);
  assert.deepEqual(t.typography, []);
  assert.deepEqual(t.radius, []);
  assert.deepEqual(t.shadows, []);
  assert.equal(t.spacing.multiplier, null);
});

test('handles multiple @theme blocks (merge)', () => {
  const css = `
@theme { --color-a-100: #fff; }
@theme { --color-b-200: #000; }
`;
  const t = parseTokens(css);
  assert.equal(t.colors.length, 2);
});
```

- [ ] **Step 3: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/token-parser.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement token-parser.js**

`plugins/adhd/lib/install-design-system-docs-route/token-parser.js`:

```javascript
'use strict';

// Extracts a single @theme block's body, or null. Brace-balanced across nested objects.
function extractAllThemeBodies(css) {
  const bodies = [];
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf('@theme', i);
    if (idx === -1) break;
    // Skip whitespace + optional modifiers like @theme inline
    let j = idx + '@theme'.length;
    while (j < css.length && css[j] !== '{' && css[j] !== ';') j++;
    if (css[j] !== '{') { i = j + 1; continue; }
    // Brace-balanced scan
    let depth = 1;
    let k = j + 1;
    while (k < css.length && depth > 0) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
      if (depth > 0) k++;
    }
    bodies.push(css.slice(j + 1, k));
    i = k + 1;
  }
  return bodies;
}

const DECL_RE = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

function classify(name) {
  if (name.startsWith('color-')) return { domain: 'colors', leaf: name.slice('color-'.length) };
  if (name === 'spacing') return { domain: 'spacing', leaf: null };
  if (name.startsWith('text-')) {
    // text-xs or text-xs--line-height
    const rest = name.slice('text-'.length);
    const lhIdx = rest.indexOf('--line-height');
    if (lhIdx >= 0) return { domain: 'typography', leaf: rest.slice(0, lhIdx), kind: 'lineHeight' };
    return { domain: 'typography', leaf: rest, kind: 'size' };
  }
  if (name.startsWith('radius-')) return { domain: 'radius', leaf: name.slice('radius-'.length) };
  if (name.startsWith('shadow-')) return { domain: 'shadows', leaf: name.slice('shadow-'.length) };
  return { domain: 'unknown' };
}

function parseTokens(globalsCss) {
  const out = {
    colors: [],
    spacing: { multiplier: null },
    typography: [], // [{ name, size, lineHeight }]
    radius: [],
    shadows: [],
    unknown: [],
  };
  const typographyByName = new Map();

  for (const body of extractAllThemeBodies(globalsCss)) {
    DECL_RE.lastIndex = 0;
    let m;
    while ((m = DECL_RE.exec(body)) !== null) {
      const name = m[1];
      const value = m[2].trim();
      const cls = classify(name);
      if (cls.domain === 'colors') {
        out.colors.push({ name: cls.leaf, value });
      } else if (cls.domain === 'spacing') {
        out.spacing.multiplier = value;
      } else if (cls.domain === 'typography') {
        let row = typographyByName.get(cls.leaf);
        if (!row) {
          row = { name: cls.leaf, size: null, lineHeight: null };
          typographyByName.set(cls.leaf, row);
          out.typography.push(row);
        }
        if (cls.kind === 'lineHeight') row.lineHeight = value;
        else row.size = value;
      } else if (cls.domain === 'radius') {
        out.radius.push({ name: cls.leaf, value });
      } else if (cls.domain === 'shadows') {
        out.shadows.push({ name: cls.leaf, value });
      } else {
        out.unknown.push({ name: '--' + name, value });
      }
    }
  }

  return out;
}

module.exports = { parseTokens };
```

- [ ] **Step 5: Verify tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/token-parser.test.js`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/token-parser.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/token-parser.test.js \
        plugins/adhd/lib/install-design-system-docs-route/__fixtures__/globals.css
git commit -m "token-parser: extract colors/spacing/typography/radius/shadows from globals.css @theme"
```

---

## Task 3: prop-parser.js — extract component prop interfaces

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/prop-parser.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/prop-parser.test.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__fixtures__/avatar.tsx`

- [ ] **Step 1: Add the fixture file**

`plugins/adhd/lib/install-design-system-docs-route/__fixtures__/avatar.tsx`:

```tsx
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "square";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  status?: "online" | "away" | "offline";
  count?: number;
  hidden?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

export function Avatar({ name, size = "md" }: AvatarProps) {
  return <span>{name}</span>;
}
```

- [ ] **Step 2: Write failing tests**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/prop-parser.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseProps } = require('../prop-parser');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', '__fixtures__', 'avatar.tsx'),
  'utf8',
);

test('returns the component name', () => {
  const r = parseProps(SOURCE);
  assert.equal(r.componentName, 'Avatar');
});

test('captures string props', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.name, { type: 'string', optional: false });
  assert.deepEqual(r.props.src, { type: 'string', optional: true });
});

test('captures number and boolean props', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.count, { type: 'number', optional: true });
  assert.deepEqual(r.props.hidden, { type: 'boolean', optional: true });
});

test('captures named-union references with their values', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.size, {
    type: 'union', unionName: 'AvatarSize', values: ['xs', 'sm', 'md', 'lg', 'xl'], optional: true,
  });
  assert.deepEqual(r.props.shape, {
    type: 'union', unionName: 'AvatarShape', values: ['circle', 'square'], optional: true,
  });
});

test('captures inline literal unions', () => {
  const r = parseProps(SOURCE);
  assert.deepEqual(r.props.status, {
    type: 'union', values: ['online', 'away', 'offline'], optional: true,
  });
});

test('marks function props as `function` (toggle-skipped)', () => {
  const r = parseProps(SOURCE);
  assert.equal(r.props.onClick.type, 'function');
});

test('marks ReactNode props as `reactnode` (toggle-skipped)', () => {
  const r = parseProps(SOURCE);
  assert.equal(r.props.children.type, 'reactnode');
});

test('returns componentName=null when no exported function found', () => {
  const r = parseProps('export const x = 42;');
  assert.equal(r.componentName, null);
  assert.deepEqual(r.props, {});
});
```

- [ ] **Step 3: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/prop-parser.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement prop-parser.js**

`plugins/adhd/lib/install-design-system-docs-route/prop-parser.js`:

```javascript
'use strict';

const TYPE_ALIAS_RE = /export\s+type\s+([A-Z][A-Za-z0-9]*)\s*=\s*([^;]+);/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+([A-Z][A-Za-z0-9]*Props)\s*\{([\s\S]*?)\}/;
const TYPE_PROPS_RE = /(?:export\s+)?type\s+([A-Z][A-Za-z0-9]*Props)\s*=\s*\{([\s\S]*?)\}/;
const EXPORT_FN_RE = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)\s*\(/;
const PROP_LINE_RE = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)(\?)?\s*:\s*([^;,]+)[;,]?\s*$/;

function parseLiteralUnion(typeText) {
  const trimmed = typeText.trim();
  if (!/^"[^"]*"(\s*\|\s*"[^"]*")*$/.test(trimmed)) return null;
  return trimmed.split('|').map(s => {
    const m = /"([^"]*)"/.exec(s.trim());
    return m ? m[1] : null;
  }).filter(Boolean);
}

function classify(typeText, knownUnions) {
  const t = typeText.trim();
  const inline = parseLiteralUnion(t);
  if (inline) return { type: 'union', values: inline };
  if (knownUnions[t]) return { type: 'union', unionName: t, values: knownUnions[t] };
  if (/^\([^)]*\)\s*=>/.test(t)) return { type: 'function' };
  if (/^(?:React\.)?Ref(?:Object|Callback|MutableRefObject)?</.test(t)) return { type: 'ref' };
  if (/^(?:React\.)?(?:ReactNode|ReactElement|ReactChild)$/.test(t)) return { type: 'reactnode' };
  if (/^JSX\.Element$/.test(t)) return { type: 'reactnode' };
  if (/^(?:React\.)?ReactElement<.*>$/.test(t)) return { type: 'reactnode' };
  if (t === 'string') return { type: 'string' };
  if (t === 'number') return { type: 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  if (/\[\]$/.test(t) || /^Array</.test(t) || /^ReadonlyArray</.test(t)) return { type: 'array' };
  if (/^\{.*\}$/.test(t)) return { type: 'object' };
  return { type: 'unknown' };
}

function parseProps(source) {
  // Pass 1: collect known unions
  const knownUnions = {};
  TYPE_ALIAS_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_ALIAS_RE.exec(source)) !== null) {
    const name = m[1];
    const body = m[2].trim();
    const lit = parseLiteralUnion(body);
    if (lit) knownUnions[name] = lit;
  }

  // Pass 2: locate component name
  const fnMatch = EXPORT_FN_RE.exec(source);
  const componentName = fnMatch ? fnMatch[1] : null;

  // Pass 3: locate props block
  let propsBody = null;
  const ifaceMatch = INTERFACE_RE.exec(source);
  const typeMatch = TYPE_PROPS_RE.exec(source);
  if (ifaceMatch) propsBody = ifaceMatch[2];
  else if (typeMatch) propsBody = typeMatch[2];

  const props = {};
  if (propsBody) {
    for (const rawLine of propsBody.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '');
      const pm = PROP_LINE_RE.exec(line);
      if (!pm) continue;
      const [, propName, optionalMark, typeText] = pm;
      const cls = classify(typeText, knownUnions);
      props[propName] = { ...cls, optional: !!optionalMark };
    }
  }

  return { componentName, props, unions: knownUnions };
}

module.exports = { parseProps };
```

- [ ] **Step 5: Verify tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/prop-parser.test.js`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/prop-parser.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/prop-parser.test.js \
        plugins/adhd/lib/install-design-system-docs-route/__fixtures__/avatar.tsx
git commit -m "prop-parser: extract component prop interface (unions, primitives, optional flag)"
```

---

## Task 4: slug.js — component path → URL slug + collision detection

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/slug.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/slug.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/slug.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugFor, slugMap } = require('../slug');

test('slugs a simple component path', () => {
  assert.equal(slugFor('app/components/avatar/index.tsx'), 'avatar');
});

test('preserves hyphens', () => {
  assert.equal(slugFor('app/components/avatar-group/index.tsx'), 'avatar-group');
});

test('handles files without /index.tsx', () => {
  assert.equal(slugFor('app/components/Logo.tsx'), 'logo');
});

test('lowercases', () => {
  assert.equal(slugFor('app/components/AvatarGroup/index.tsx'), 'avatargroup');
});

test('slugMap returns { path: slug } for unique paths', () => {
  const paths = [
    'app/components/avatar/index.tsx',
    'app/components/avatar-group/index.tsx',
  ];
  assert.deepEqual(slugMap(paths), {
    'app/components/avatar/index.tsx': 'avatar',
    'app/components/avatar-group/index.tsx': 'avatar-group',
  });
});

test('slugMap disambiguates collisions by prepending parent dir', () => {
  const paths = [
    'app/components/avatar/index.tsx',
    'app/design-system/avatar/index.tsx',
  ];
  const m = slugMap(paths);
  assert.equal(new Set(Object.values(m)).size, 2, 'slugs must be unique');
  // Both contain "avatar"; we expect e.g. "components-avatar" and "design-system-avatar"
  assert.ok(Object.values(m).every(s => s.includes('avatar')));
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/slug.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement slug.js**

`plugins/adhd/lib/install-design-system-docs-route/slug.js`:

```javascript
'use strict';

function baseSlug(componentPath) {
  // Strip /index.tsx or .tsx; take the last meaningful segment.
  let p = componentPath.replace(/\\/g, '/').replace(/\.tsx?$/, '').replace(/\/index$/, '');
  const segs = p.split('/').filter(Boolean);
  return (segs[segs.length - 1] || '').toLowerCase();
}

function slugFor(componentPath) {
  return baseSlug(componentPath);
}

function slugMap(paths) {
  // Pass 1: tentative slugs
  const tentative = paths.map(p => ({ path: p, slug: baseSlug(p) }));
  // Pass 2: find collisions
  const counts = {};
  for (const t of tentative) counts[t.slug] = (counts[t.slug] || 0) + 1;
  // Pass 3: resolve collisions by prepending the parent dir
  for (const t of tentative) {
    if (counts[t.slug] === 1) continue;
    const segs = t.path.replace(/\\/g, '/').replace(/\.tsx?$/, '').replace(/\/index$/, '').split('/').filter(Boolean);
    // Prepend one level of parent until unique
    let depth = 2;
    while (depth <= segs.length) {
      const candidate = segs.slice(segs.length - depth).join('-').toLowerCase();
      const colliders = tentative.filter(x => x !== t && x.slug === candidate).length;
      if (colliders === 0) {
        t.slug = candidate;
        break;
      }
      depth++;
    }
  }
  const out = {};
  for (const t of tentative) out[t.path] = t.slug;
  return out;
}

module.exports = { slugFor, slugMap };
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/slug.test.js`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/slug.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/slug.test.js
git commit -m "slug: component path → URL slug + collision disambiguation"
```

---

## Task 5: next-config-patcher.js — idempotent pageExtensions patch

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/next-config-patcher.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/next-config-patcher.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/next-config-patcher.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { patchNextConfig, isPatched } = require('../next-config-patcher');

const TS_MINIMAL = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.pravatar.cc" }],
  },
};

export default nextConfig;
`;

const TS_ALREADY_PATCHED = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.pravatar.cc" }],
  },
};

export default nextConfig;
`;

const TS_WITH_DIFFERENT_PAGE_EXTENSIONS = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: ['mdx', 'ts', 'tsx'],
};

export default nextConfig;
`;

test('patches a minimal next.config.ts with the conditional pageExtensions block', () => {
  const out = patchNextConfig(TS_MINIMAL);
  assert.match(out, /pageExtensions:\s*process\.env\.NODE_ENV/);
  assert.match(out, /'design-system\.tsx'/);
  // Existing config preserved
  assert.match(out, /images:/);
  assert.match(out, /remotePatterns:/);
});

test('isPatched returns true after patching', () => {
  const out = patchNextConfig(TS_MINIMAL);
  assert.equal(isPatched(out), true);
});

test('patchNextConfig is idempotent when already patched', () => {
  const out = patchNextConfig(TS_ALREADY_PATCHED);
  assert.equal(out, TS_ALREADY_PATCHED);
});

test('isPatched returns false on an unpatched file', () => {
  assert.equal(isPatched(TS_MINIMAL), false);
});

test('patchNextConfig refuses to silently overwrite an existing different pageExtensions; returns { conflict: true }', () => {
  const r = patchNextConfig(TS_WITH_DIFFERENT_PAGE_EXTENSIONS, { detectOnly: true });
  assert.equal(r.conflict, true);
  assert.match(r.existing, /pageExtensions:\s*\['mdx'/);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/next-config-patcher.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement next-config-patcher.js**

`plugins/adhd/lib/install-design-system-docs-route/next-config-patcher.js`:

```javascript
'use strict';

// Detection: look for the sentinel "design-system.tsx" pageExtension entry
// inside the conditional. This is the unique fingerprint of OUR patch.
const PATCHED_SENTINEL = /pageExtensions:\s*process\.env\.NODE_ENV\s*===\s*['"]production['"][\s\S]*?'design-system\.tsx'/;

// Detection: any other pageExtensions definition.
const EXISTING_PAGE_EXTENSIONS_RE = /pageExtensions:\s*\[/;

const PATCH_BLOCK = `  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],`;

function isPatched(source) {
  return PATCHED_SENTINEL.test(source);
}

function findConfigObjectStart(source) {
  // Look for either:
  //   const nextConfig: NextConfig = {
  //   const nextConfig = {
  //   export default {
  //   module.exports = {
  const patterns = [
    /const\s+nextConfig(?:\s*:\s*[^=]+)?\s*=\s*\{/,
    /export\s+default\s*\{/,
    /module\.exports\s*=\s*\{/,
  ];
  for (const re of patterns) {
    const m = re.exec(source);
    if (m) return m.index + m[0].length; // position after the opening `{`
  }
  return -1;
}

function patchNextConfig(source, opts = {}) {
  if (isPatched(source)) return source;

  // Detect existing different pageExtensions
  if (EXISTING_PAGE_EXTENSIONS_RE.test(source)) {
    if (opts.detectOnly) {
      const existing = /pageExtensions:[^,\n]+,?/.exec(source)[0];
      return { conflict: true, existing };
    }
    // Caller hasn't checked; we still refuse to silently merge.
    throw new Error('next.config already sets pageExtensions to a different value. Run with detectOnly: true to inspect and prompt the user.');
  }

  const insertAt = findConfigObjectStart(source);
  if (insertAt === -1) {
    throw new Error('Could not locate the config object in next.config. Manual edit required.');
  }

  // Insert the patch block immediately inside the object literal, before existing
  // properties. This puts it at the top of the config for visibility.
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt);
  // Add a newline if needed for clean formatting
  const sep = after.startsWith('\n') ? '' : '\n';
  return before + sep + PATCH_BLOCK + '\n' + after.replace(/^\n/, '');
}

module.exports = { patchNextConfig, isPatched };
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/next-config-patcher.test.js`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/next-config-patcher.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/next-config-patcher.test.js
git commit -m "next-config-patcher: idempotent conditional pageExtensions patch"
```

---

## Task 6: robots-patcher.js — idempotent robots.txt patch

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/robots-patcher.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/robots-patcher.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/robots-patcher.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { patchRobots } = require('../robots-patcher');

test('creates robots.txt content if input is empty', () => {
  const out = patchRobots('', '/-docs');
  assert.match(out, /User-agent: \*/);
  assert.match(out, /Disallow: \/-docs/);
});

test('creates robots.txt content if input is null/undefined', () => {
  const out = patchRobots(null, '/-docs');
  assert.match(out, /User-agent: \*/);
  assert.match(out, /Disallow: \/-docs/);
});

test('appends a Disallow line to an existing robots.txt', () => {
  const existing = `User-agent: *
Disallow: /admin
`;
  const out = patchRobots(existing, '/-docs');
  assert.match(out, /Disallow: \/admin/);
  assert.match(out, /Disallow: \/-docs/);
});

test('idempotent: re-patching an already-patched robots.txt returns unchanged', () => {
  const existing = `User-agent: *
Disallow: /-docs
`;
  const out = patchRobots(existing, '/-docs');
  assert.equal(out, existing);
});

test('idempotent: matching is exact (does not match /-docs-other)', () => {
  const existing = `User-agent: *
Disallow: /-docs-other
`;
  const out = patchRobots(existing, '/-docs');
  assert.match(out, /Disallow: \/-docs-other/);
  assert.match(out, /Disallow: \/-docs$/m);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/robots-patcher.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement robots-patcher.js**

`plugins/adhd/lib/install-design-system-docs-route/robots-patcher.js`:

```javascript
'use strict';

function patchRobots(source, routeUrl) {
  const disallowLine = `Disallow: ${routeUrl}`;
  if (!source) {
    return `User-agent: *\n${disallowLine}\n`;
  }
  // Idempotent: line-anchored exact match
  const exactRe = new RegExp(`^${disallowLine.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'm');
  if (exactRe.test(source)) return source;
  // Append (ensure newline before, single newline after)
  const trimmed = source.replace(/\n+$/, '');
  return trimmed + '\n' + disallowLine + '\n';
}

module.exports = { patchRobots };
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/robots-patcher.test.js`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/robots-patcher.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/robots-patcher.test.js
git commit -m "robots-patcher: idempotent Disallow entry for the docs route"
```

---

## Task 7: templates.js — page template content as string constants

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/templates.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/templates.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/templates.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKER_COMMENT, LAYOUT_TSX, INDEX_PAGE_TSX, COMPONENT_PAGE_TSX, PROP_TOGGLE_TSX } = require('../templates');

test('MARKER_COMMENT is a stable, non-ADHD-referencing string', () => {
  assert.match(MARKER_COMMENT, /design-system-docs-route/);
  assert.match(MARKER_COMMENT, /auto-generated installer artifact; safe to edit/);
  assert.equal(/adhd/i.test(MARKER_COMMENT), false, 'must not reference ADHD');
});

test('LAYOUT_TSX starts with the marker comment', () => {
  assert.ok(LAYOUT_TSX.startsWith(MARKER_COMMENT));
});

test('LAYOUT_TSX sets robots: noindex / nofollow', () => {
  assert.match(LAYOUT_TSX, /robots:\s*\{[^}]*index:\s*false[^}]*follow:\s*false/);
});

test('LAYOUT_TSX has no ADHD references outside marker', () => {
  // marker excluded
  const body = LAYOUT_TSX.replace(MARKER_COMMENT, '');
  assert.equal(/adhd/i.test(body), false);
});

test('INDEX_PAGE_TSX renders sections for each token domain', () => {
  for (const section of ['Colors', 'Spacing', 'Typography', 'Radius', 'Shadows', 'Components']) {
    assert.match(INDEX_PAGE_TSX, new RegExp(section));
  }
});

test('INDEX_PAGE_TSX reads adhd.config.ts and globals.css via fs', () => {
  assert.match(INDEX_PAGE_TSX, /adhd\.config\.ts/);
  assert.match(INDEX_PAGE_TSX, /globals\.css|cssEntry/);
});

test('COMPONENT_PAGE_TSX uses parametric template-string dynamic import', () => {
  assert.match(COMPONENT_PAGE_TSX, /await\s+import\(`/);
});

test('COMPONENT_PAGE_TSX reads searchParams for prop toggles', () => {
  assert.match(COMPONENT_PAGE_TSX, /searchParams/);
});

test('PROP_TOGGLE_TSX is a client component', () => {
  assert.match(PROP_TOGGLE_TSX, /^["']use client["']/);
});

test('PROP_TOGGLE_TSX uses router.replace for snappy URL updates', () => {
  assert.match(PROP_TOGGLE_TSX, /router\.replace/);
});

test('none of the templates contain "ADHD" outside the marker', () => {
  for (const [name, content] of Object.entries({ LAYOUT_TSX, INDEX_PAGE_TSX, COMPONENT_PAGE_TSX, PROP_TOGGLE_TSX })) {
    const body = content.replace(MARKER_COMMENT, '');
    assert.equal(/adhd/i.test(body), false, `${name} must not reference ADHD outside marker`);
  }
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/templates.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement templates.js**

`plugins/adhd/lib/install-design-system-docs-route/templates.js`:

```javascript
'use strict';

const MARKER_COMMENT = `// design-system-docs-route — auto-generated installer artifact; safe to edit.
// Remove this comment to disable future overwrites from re-running the installer.
`;

const LAYOUT_TSX = `${MARKER_COMMENT}import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design System Docs",
  robots: { index: false, follow: false },
};

export default function DesignSystemDocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 p-4">
        <div className="mx-auto max-w-5xl flex items-baseline gap-3">
          <h1 className="text-sm font-medium">Design System Docs</h1>
          <span className="text-xs text-zinc-500">Internal — not indexed</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-8">{children}</main>
    </div>
  );
}
`;

const INDEX_PAGE_TSX = `${MARKER_COMMENT}import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";

async function readConfig() {
  try {
    const src = await fs.readFile(path.resolve(process.cwd(), "adhd.config.ts"), "utf8");
    const components: Record<string, unknown> = {};
    const compMatch = /components:\\s*\\{([\\s\\S]*?)\\}\\s*[,;]?/.exec(src);
    if (compMatch) {
      const inner = compMatch[1];
      const re = /"([^"]+)"\\s*:\\s*\\{/g;
      let m;
      while ((m = re.exec(inner)) !== null) {
        components[m[1]] = true;
      }
    }
    const cssEntryMatch = /cssEntry\\s*:\\s*"([^"]+)"/.exec(src);
    const cssEntry = cssEntryMatch ? cssEntryMatch[1] : "app/globals.css";
    return { components: Object.keys(components), cssEntry };
  } catch {
    return { components: [], cssEntry: "app/globals.css" };
  }
}

async function readCss(cssEntry: string) {
  try {
    return await fs.readFile(path.resolve(process.cwd(), cssEntry), "utf8");
  } catch {
    return null;
  }
}

function extractTokens(css: string | null) {
  const empty = { colors: [], spacing: { multiplier: null }, typography: [], radius: [], shadows: [] };
  if (!css) return empty;
  const out = { colors: [] as Array<{ name: string; value: string }>,
                spacing: { multiplier: null as string | null },
                typography: [] as Array<{ name: string; size: string | null; lineHeight: string | null }>,
                radius: [] as Array<{ name: string; value: string }>,
                shadows: [] as Array<{ name: string; value: string }> };
  const themeRe = /@theme\\s*\\{([\\s\\S]*?)\\}/g;
  let body;
  while ((body = themeRe.exec(css)) !== null) {
    const declRe = /--([a-zA-Z0-9_-]+)\\s*:\\s*([^;]+);/g;
    let d;
    while ((d = declRe.exec(body[1])) !== null) {
      const name = d[1];
      const value = d[2].trim();
      if (name.startsWith("color-")) out.colors.push({ name: name.slice(6), value });
      else if (name === "spacing") out.spacing.multiplier = value;
      else if (name.startsWith("text-")) {
        const rest = name.slice(5);
        const lhIdx = rest.indexOf("--line-height");
        const leaf = lhIdx >= 0 ? rest.slice(0, lhIdx) : rest;
        let row = out.typography.find(t => t.name === leaf);
        if (!row) { row = { name: leaf, size: null, lineHeight: null }; out.typography.push(row); }
        if (lhIdx >= 0) row.lineHeight = value; else row.size = value;
      } else if (name.startsWith("radius-")) out.radius.push({ name: name.slice(7), value });
      else if (name.startsWith("shadow-")) out.shadows.push({ name: name.slice(7), value });
    }
  }
  return out;
}

export default async function DesignSystemIndex() {
  const cfg = await readConfig();
  const css = await readCss(cfg.cssEntry);
  const tokens = extractTokens(css);

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase text-zinc-500">Colors</h2>
        {tokens.colors.length === 0 ? <p className="text-sm text-zinc-500">No colors detected.</p> : (
          <div className="grid grid-cols-6 gap-3">
            {tokens.colors.map(c => (
              <div key={c.name} className="flex flex-col gap-1">
                <div className="h-12 w-full rounded border border-zinc-200 dark:border-zinc-800" style={{ backgroundColor: c.value }} />
                <span className="text-xs">{c.name}</span>
                <span className="text-[10px] text-zinc-500">{c.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium uppercase text-zinc-500">Spacing</h2>
        {tokens.spacing.multiplier ? <p className="text-sm">Multiplier: <code>{tokens.spacing.multiplier}</code></p> : <p className="text-sm text-zinc-500">No spacing variable detected.</p>}
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium uppercase text-zinc-500">Typography</h2>
        {tokens.typography.length === 0 ? <p className="text-sm text-zinc-500">No typography tokens detected.</p> : (
          <div className="flex flex-col gap-4">
            {tokens.typography.map(t => (
              <div key={t.name} className="flex items-baseline gap-4">
                <span className="text-xs text-zinc-500 w-20">text-{t.name}</span>
                <span style={{ fontSize: t.size ?? undefined, lineHeight: t.lineHeight ?? undefined }}>
                  The quick brown fox jumps over the lazy dog
                </span>
                <span className="text-[10px] text-zinc-500">{t.size}{t.lineHeight ? ` / ${t.lineHeight}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium uppercase text-zinc-500">Radius</h2>
        {tokens.radius.length === 0 ? <p className="text-sm text-zinc-500">No radius tokens detected.</p> : (
          <div className="flex gap-4">
            {tokens.radius.map(r => (
              <div key={r.name} className="flex flex-col gap-1">
                <div className="h-16 w-16 bg-zinc-200 dark:bg-zinc-800" style={{ borderRadius: r.value }} />
                <span className="text-xs">rounded-{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium uppercase text-zinc-500">Shadows</h2>
        {tokens.shadows.length === 0 ? <p className="text-sm text-zinc-500">No shadow tokens detected.</p> : (
          <div className="flex gap-6">
            {tokens.shadows.map(s => (
              <div key={s.name} className="flex flex-col gap-1">
                <div className="h-16 w-16 bg-white" style={{ boxShadow: s.value }} />
                <span className="text-xs">shadow-{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium uppercase text-zinc-500">Components</h2>
        {cfg.components.length === 0 ? <p className="text-sm text-zinc-500">No components tracked. Push one with /adhd:push-component &lt;path&gt;.</p> : (
          <div className="grid grid-cols-3 gap-4">
            {cfg.components.map(p => {
              const slug = p.replace(/\\.tsx?$/, "").replace(/\\/index$/, "").split("/").pop()?.toLowerCase() ?? p;
              return (
                <Link key={p} href={\`./\${slug}\`} className="rounded border border-zinc-200 dark:border-zinc-800 p-4 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <div className="text-sm font-medium">{slug}</div>
                  <div className="text-xs text-zinc-500 truncate">{p}</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
`;

const COMPONENT_PAGE_TSX = `${MARKER_COMMENT}import fs from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { PropToggle } from "../PropToggle";

async function readConfig() {
  try {
    const src = await fs.readFile(path.resolve(process.cwd(), "adhd.config.ts"), "utf8");
    const components: string[] = [];
    const compMatch = /components:\\s*\\{([\\s\\S]*?)\\}\\s*[,;]?/.exec(src);
    if (compMatch) {
      const inner = compMatch[1];
      const re = /"([^"]+)"\\s*:\\s*\\{/g;
      let m;
      while ((m = re.exec(inner)) !== null) components.push(m[1]);
    }
    return components;
  } catch {
    return [];
  }
}

function slugFor(p: string) {
  return p.replace(/\\.tsx?$/, "").replace(/\\/index$/, "").split("/").pop()?.toLowerCase() ?? p;
}

async function parseProps(componentPath: string) {
  try {
    const src = await fs.readFile(path.resolve(process.cwd(), componentPath), "utf8");
    const TYPE_ALIAS_RE = /export\\s+type\\s+([A-Z][A-Za-z0-9]*)\\s*=\\s*([^;]+);/g;
    const INTERFACE_RE = /(?:export\\s+)?interface\\s+([A-Z][A-Za-z0-9]*Props)\\s*\\{([\\s\\S]*?)\\}/;
    const PROP_LINE_RE = /^\\s*([a-zA-Z_$][a-zA-Z0-9_$]*)(\\??)\\s*:\\s*([^;,]+)[;,]?\\s*$/;

    const knownUnions: Record<string, string[]> = {};
    TYPE_ALIAS_RE.lastIndex = 0;
    let m;
    while ((m = TYPE_ALIAS_RE.exec(src)) !== null) {
      const body = m[2].trim();
      if (/^"[^"]*"(\\s*\\|\\s*"[^"]*")*$/.test(body)) {
        knownUnions[m[1]] = body.split("|").map(s => s.trim().replace(/"/g, ""));
      }
    }
    const iface = INTERFACE_RE.exec(src);
    if (!iface) return { props: {} as Record<string, any>, knownUnions };
    const props: Record<string, any> = {};
    for (const rawLine of iface[2].split("\\n")) {
      const line = rawLine.replace(/\\/\\/.*$/, "");
      const pm = PROP_LINE_RE.exec(line);
      if (!pm) continue;
      const [, name, opt, type] = pm;
      const t = type.trim();
      if (knownUnions[t]) props[name] = { type: "union", values: knownUnions[t], optional: !!opt };
      else if (/^"[^"]*"(\\s*\\|\\s*"[^"]*")*$/.test(t)) {
        props[name] = { type: "union", values: t.split("|").map(s => s.trim().replace(/"/g, "")), optional: !!opt };
      } else if (t === "string") props[name] = { type: "string", optional: !!opt };
      else if (t === "number") props[name] = { type: "number", optional: !!opt };
      else if (t === "boolean") props[name] = { type: "boolean", optional: !!opt };
      else props[name] = { type: "unknown", optional: !!opt };
    }
    return { props, knownUnions };
  } catch {
    return { props: {} as Record<string, any>, knownUnions: {} };
  }
}

export default async function ComponentPage({
  params,
  searchParams,
}: {
  params: Promise<{ component: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { component: slug } = await params;
  const sp = await searchParams;
  const paths = await readConfig();
  const componentPath = paths.find(p => slugFor(p) === slug);
  if (!componentPath) notFound();

  const { props } = await parseProps(componentPath);

  // Resolve current prop values from searchParams
  const current: Record<string, any> = {};
  for (const [name, def] of Object.entries(props)) {
    const v = sp[name];
    if (typeof v !== "string") continue;
    if (def.type === "union" && def.values.includes(v)) current[name] = v;
    else if (def.type === "boolean") current[name] = v === "true";
    else if (def.type === "string") current[name] = v;
    else if (def.type === "number") current[name] = Number(v);
  }

  // Dynamic import the component
  let Component: any = null;
  let importError: string | null = null;
  try {
    const mod = await import(\`@/\${componentPath.replace(/\\.tsx?$/, "")}\`);
    const name = Object.keys(mod).find(k => typeof mod[k] === "function") ?? "default";
    Component = mod.default ?? mod[name];
  } catch (e: any) {
    importError = e?.message ?? String(e);
  }

  const importPath = "@/" + componentPath.replace(/\\.tsx?$/, "").replace(/\\/index$/, "");
  const importStmt = Component ? \`import { \${Component.name ?? slug} } from "\${importPath}";\` : null;
  const jsxSnippet = Component
    ? \`<\${Component.name ?? slug}\${Object.entries(current).map(([k,v]) => \` \${k}={\${JSON.stringify(v)}}\`).join("")} />\`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">{slug}</h2>

      <section className="rounded border border-zinc-200 dark:border-zinc-800 p-4">
        <h3 className="mb-3 text-xs font-medium uppercase text-zinc-500">Props</h3>
        {Object.keys(props).length === 0 ? <p className="text-sm text-zinc-500">No prop introspection available.</p> : (
          <div className="flex flex-col gap-2">
            {Object.entries(props).map(([name, def]: [string, any]) => {
              if (def.type === "union") {
                return (
                  <PropToggle key={name} name={name} kind="union" values={def.values} value={current[name] ?? def.values[0]} />
                );
              }
              if (def.type === "boolean") {
                return (
                  <PropToggle key={name} name={name} kind="boolean" value={String(current[name] ?? false)} />
                );
              }
              if (def.type === "string" || def.type === "number") {
                return (
                  <PropToggle key={name} name={name} kind={def.type} value={String(current[name] ?? "")} />
                );
              }
              return (
                <div key={name} className="text-xs text-zinc-500">
                  {name}: <code>{def.type}</code> — toggle unavailable
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded border border-zinc-200 dark:border-zinc-800 p-8">
        {importError ? (
          <pre className="text-xs text-red-600 whitespace-pre-wrap">{importError}</pre>
        ) : Component ? (
          <Component {...current} />
        ) : null}
      </section>

      {importStmt && jsxSnippet && (
        <section className="flex flex-col gap-2">
          <pre className="rounded bg-zinc-100 dark:bg-zinc-900 p-3 text-xs overflow-x-auto"><code>{importStmt}</code></pre>
          <pre className="rounded bg-zinc-100 dark:bg-zinc-900 p-3 text-xs overflow-x-auto"><code>{jsxSnippet}</code></pre>
        </section>
      )}
    </div>
  );
}
`;

const PROP_TOGGLE_TSX = `${MARKER_COMMENT}"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Props =
  | { name: string; kind: "union"; values: string[]; value: string }
  | { name: string; kind: "boolean"; value: string }
  | { name: string; kind: "string"; value: string }
  | { name: string; kind: "number"; value: string };

export function PropToggle(p: Props) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();

  function setParam(v: string) {
    const next = new URLSearchParams(sp.toString());
    if (v === "") next.delete(p.name);
    else next.set(p.name, v);
    router.replace(\`\${path}?\${next}\`);
  }

  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-24 text-xs text-zinc-500">{p.name}</span>
      {p.kind === "union" ? (
        <select className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm" value={p.value} onChange={(e) => setParam(e.target.value)}>
          {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      ) : p.kind === "boolean" ? (
        <input type="checkbox" checked={p.value === "true"} onChange={(e) => setParam(String(e.target.checked))} />
      ) : (
        <input type={p.kind === "number" ? "number" : "text"} className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm" value={p.value} onChange={(e) => setParam(e.target.value)} />
      )}
    </label>
  );
}
`;

module.exports = { MARKER_COMMENT, LAYOUT_TSX, INDEX_PAGE_TSX, COMPONENT_PAGE_TSX, PROP_TOGGLE_TSX };
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/templates.test.js`
Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/templates.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/templates.test.js
git commit -m "templates: layout, index, component page, PropToggle (marker-prefixed, no ADHD refs)"
```

---

## Task 8: route-installer.js — write files at the target path with marker detection

**Files:**
- Create: `plugins/adhd/lib/install-design-system-docs-route/route-installer.js`
- Create: `plugins/adhd/lib/install-design-system-docs-route/__tests__/route-installer.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/adhd/lib/install-design-system-docs-route/__tests__/route-installer.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installRoute, detectExistingInstall } = require('../route-installer');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-install-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  return root;
}

test('installRoute writes 4 files with the .design-system.tsx extension when prodExcluded', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: true,
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, '[component]', 'page.design-system.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.design-system.tsx')));
});

test('installRoute writes plain .tsx files when not prodExcluded', () => {
  const root = makeTempProject();
  installRoute(root, {
    groupName: '(design-system)',
    routeSegment: '-docs',
    prodExcluded: false,
  });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, '[component]', 'page.tsx')));
  assert.ok(fs.existsSync(path.join(docsDir, 'PropToggle.tsx')));
});

test('all written files start with the marker comment', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const docsDir = path.join(root, 'app', '(design-system)', '-docs');
  for (const f of [
    'layout.design-system.tsx',
    'page.design-system.tsx',
    '[component]/page.design-system.tsx',
    'PropToggle.design-system.tsx',
  ]) {
    const content = fs.readFileSync(path.join(docsDir, f), 'utf8');
    assert.match(content, /design-system-docs-route/);
  }
});

test('detectExistingInstall scans for the marker and returns matching files', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const found = detectExistingInstall(root);
  assert.ok(found.length >= 4);
  assert.ok(found.every(p => p.includes('-docs')));
});

test('detectExistingInstall returns [] when no marker is present', () => {
  const root = makeTempProject();
  const found = detectExistingInstall(root);
  assert.deepEqual(found, []);
});

test('detectExistingInstall does not match unrelated files', () => {
  const root = makeTempProject();
  fs.writeFileSync(path.join(root, 'app', 'page.tsx'), 'export default function P() { return null; }\n');
  assert.deepEqual(detectExistingInstall(root), []);
});

test('re-running installRoute is safe (overwrites files cleanly)', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  // Modify a file
  const layoutPath = path.join(root, 'app', '(design-system)', '-docs', 'layout.design-system.tsx');
  fs.writeFileSync(layoutPath, 'corrupted');
  // Re-install
  installRoute(root, { groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true });
  const after = fs.readFileSync(layoutPath, 'utf8');
  assert.match(after, /design-system-docs-route/);
  assert.match(after, /DesignSystemDocsLayout/);
});

test('installRoute supports an empty groupName (no route group)', () => {
  const root = makeTempProject();
  installRoute(root, { groupName: '', routeSegment: '-docs', prodExcluded: true });
  const docsDir = path.join(root, 'app', '-docs');
  assert.ok(fs.existsSync(path.join(docsDir, 'layout.design-system.tsx')));
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/route-installer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement route-installer.js**

`plugins/adhd/lib/install-design-system-docs-route/route-installer.js`:

```javascript
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MARKER_COMMENT, LAYOUT_TSX, INDEX_PAGE_TSX, COMPONENT_PAGE_TSX, PROP_TOGGLE_TSX } = require('./templates');

function mkdirpSync(p) {
  fs.mkdirSync(p, { recursive: true });
}

function installRoute(projectRoot, opts) {
  const { groupName = '', routeSegment, prodExcluded } = opts;
  if (!routeSegment) throw new Error('routeSegment is required');

  const ext = prodExcluded ? '.design-system.tsx' : '.tsx';
  const segments = ['app'];
  if (groupName) segments.push(groupName);
  segments.push(routeSegment);
  const docsDir = path.join(projectRoot, ...segments);
  const componentDir = path.join(docsDir, '[component]');

  mkdirpSync(docsDir);
  mkdirpSync(componentDir);

  fs.writeFileSync(path.join(docsDir, `layout${ext}`), LAYOUT_TSX);
  fs.writeFileSync(path.join(docsDir, `page${ext}`), INDEX_PAGE_TSX);
  fs.writeFileSync(path.join(componentDir, `page${ext}`), COMPONENT_PAGE_TSX);
  fs.writeFileSync(path.join(docsDir, `PropToggle${ext}`), PROP_TOGGLE_TSX);

  return {
    files: [
      path.join(docsDir, `layout${ext}`),
      path.join(docsDir, `page${ext}`),
      path.join(componentDir, `page${ext}`),
      path.join(docsDir, `PropToggle${ext}`),
    ],
  };
}

function detectExistingInstall(projectRoot) {
  const found = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.next' || ent.name.startsWith('.git')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(ent.name)) {
        try {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes('design-system-docs-route')) {
            found.push(full);
          }
        } catch {}
      }
    }
  }
  walk(path.join(projectRoot, 'app'));
  return found;
}

module.exports = { installRoute, detectExistingInstall };
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/route-installer.test.js`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/route-installer.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/route-installer.test.js
git commit -m "route-installer: write the 4 page files; detect existing installs via marker"
```

---

## Task 9: cli.js — wire all subcommands

**Files:**
- Modify: `plugins/adhd/lib/install-design-system-docs-route/cli.js`
- Modify: `plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`

- [ ] **Step 1: Extend cli tests for each subcommand**

Append to `plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`:

```javascript
const fs = require('node:fs');
const os = require('node:os');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-ids-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, content);
  return p;
}

const FX_CSS = path.resolve(__dirname, '..', '__fixtures__', 'globals.css');
const FX_AVATAR = path.resolve(__dirname, '..', '__fixtures__', 'avatar.tsx');

test('parse-tokens subcommand outputs token JSON', () => {
  const out = tmp('tokens.json', '');
  const r = spawnSync('node', [CLI, 'parse-tokens', '--css', FX_CSS, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(t.colors.length > 0);
});

test('parse-props subcommand outputs props JSON', () => {
  const out = tmp('props.json', '');
  const r = spawnSync('node', [CLI, 'parse-props', '--source', FX_AVATAR, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(p.componentName, 'Avatar');
  assert.ok(p.props.size.values.length === 5);
});

test('slug subcommand outputs slug map JSON', () => {
  const out = tmp('slugs.json', '');
  const r = spawnSync('node', [CLI, 'slug', '--paths', 'app/components/avatar/index.tsx,app/components/avatar-group/index.tsx', '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(m['app/components/avatar/index.tsx'], 'avatar');
});

test('patch-next-config subcommand mutates the file in place', () => {
  const cfg = tmp('next.config.ts', `import type { NextConfig } from "next";\nconst nextConfig: NextConfig = {};\nexport default nextConfig;\n`);
  const r = spawnSync('node', [CLI, 'patch-next-config', '--config', cfg, '--route-url', '/-docs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.match(after, /pageExtensions:\s*process\.env\.NODE_ENV/);
});

test('patch-robots subcommand mutates the file in place; creates if missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-ids-robots-'));
  const robots = path.join(root, 'robots.txt');
  const r = spawnSync('node', [CLI, 'patch-robots', '--robots', robots, '--route-url', '/-docs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(robots, 'utf8');
  assert.match(after, /Disallow: \/-docs/);
});

test('detect-install subcommand prints existing install paths to stdout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-ids-detect-'));
  fs.mkdirSync(path.join(root, 'app', '(design-system)', '-docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', '(design-system)', '-docs', 'layout.tsx'),
    '// design-system-docs-route — auto-generated installer artifact; safe to edit.\nexport default function L({ children }) { return children; }\n',
  );
  const r = spawnSync('node', [CLI, 'detect-install', '--app-dir', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /-docs\/layout\.tsx/);
});

test('install subcommand writes files based on choices JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-ids-install-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  const choices = tmp('choices.json', JSON.stringify({
    projectRoot: root, groupName: '(design-system)', routeSegment: '-docs', prodExcluded: true,
  }));
  const r = spawnSync('node', [CLI, 'install', '--config', choices], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(root, 'app', '(design-system)', '-docs', 'page.design-system.tsx')));
});
```

- [ ] **Step 2: Verify the new tests fail**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`
Expected: 7 new tests FAIL; original 3 still pass.

- [ ] **Step 3: Implement cli.js full surface**

Replace `plugins/adhd/lib/install-design-system-docs-route/cli.js`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseTokens } = require('./token-parser');
const { parseProps } = require('./prop-parser');
const { slugMap } = require('./slug');
const { patchNextConfig } = require('./next-config-patcher');
const { patchRobots } = require('./robots-patcher');
const { installRoute, detectExistingInstall } = require('./route-installer');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) { args[a.slice(2)] = argv[++i]; }
    else { args._.push(a); }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  cli.js parse-tokens --css <path> --output <json>
  cli.js parse-props --source <component.tsx> --output <json>
  cli.js slug --paths <comma-separated> --output <json>
  cli.js patch-next-config --config <path> --route-url <url>
  cli.js patch-robots --robots <path> --route-url <url>
  cli.js detect-install --app-dir <path>
  cli.js install --config <choices.json>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  if (args._.length === 0) { printUsage(); process.exit(2); }
  const cmd = args._[0];

  if (cmd === 'parse-tokens') {
    if (!args.css || !args.output) { console.error('Usage: parse-tokens --css <path> --output <json>'); process.exit(2); }
    const css = fs.readFileSync(args.css, 'utf8');
    fs.writeFileSync(args.output, JSON.stringify(parseTokens(css), null, 2));
    process.exit(0);
  }

  if (cmd === 'parse-props') {
    if (!args.source || !args.output) { console.error('Usage: parse-props --source <tsx> --output <json>'); process.exit(2); }
    const src = fs.readFileSync(args.source, 'utf8');
    fs.writeFileSync(args.output, JSON.stringify(parseProps(src), null, 2));
    process.exit(0);
  }

  if (cmd === 'slug') {
    if (!args.paths || !args.output) { console.error('Usage: slug --paths <csv> --output <json>'); process.exit(2); }
    const paths = args.paths.split(',').map(s => s.trim()).filter(Boolean);
    fs.writeFileSync(args.output, JSON.stringify(slugMap(paths), null, 2));
    process.exit(0);
  }

  if (cmd === 'patch-next-config') {
    if (!args.config || !args['route-url']) { console.error('Usage: patch-next-config --config <path> --route-url <url>'); process.exit(2); }
    const src = fs.readFileSync(args.config, 'utf8');
    const r = patchNextConfig(src, { detectOnly: true });
    if (r && r.conflict) {
      console.error('next.config already sets pageExtensions: ' + r.existing);
      process.exit(3);
    }
    const out = patchNextConfig(src);
    fs.writeFileSync(args.config, out);
    process.exit(0);
  }

  if (cmd === 'patch-robots') {
    if (!args.robots || !args['route-url']) { console.error('Usage: patch-robots --robots <path> --route-url <url>'); process.exit(2); }
    let src = '';
    try { src = fs.readFileSync(args.robots, 'utf8'); } catch {}
    fs.writeFileSync(args.robots, patchRobots(src, args['route-url']));
    process.exit(0);
  }

  if (cmd === 'detect-install') {
    if (!args['app-dir']) { console.error('Usage: detect-install --app-dir <path>'); process.exit(2); }
    const found = detectExistingInstall(args['app-dir']);
    for (const f of found) process.stdout.write(f + '\n');
    process.exit(0);
  }

  if (cmd === 'install') {
    if (!args.config) { console.error('Usage: install --config <choices.json>'); process.exit(2); }
    const choices = JSON.parse(fs.readFileSync(args.config, 'utf8'));
    if (!choices.projectRoot) { console.error('install: choices.projectRoot is required'); process.exit(2); }
    const r = installRoute(choices.projectRoot, choices);
    process.stdout.write(JSON.stringify({ files: r.files }, null, 2) + '\n');
    process.exit(0);
  }

  console.error('Unknown subcommand: ' + cmd);
  process.exit(2);
}

main();
```

- [ ] **Step 4: Verify all cli tests pass**

Run: `node --test plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js`
Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/adhd/lib/install-design-system-docs-route/cli.js \
        plugins/adhd/lib/install-design-system-docs-route/__tests__/cli.test.js
git commit -m "cli: wire all subcommands (parse-tokens, parse-props, slug, patch-*, detect-install, install)"
```

---

## Task 10: SKILL.md — the 9-phase orchestrator

**Files:**
- Create: `plugins/adhd/skills/install-design-system-docs-route/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

`plugins/adhd/skills/install-design-system-docs-route/SKILL.md`:

````markdown
---
description: "Install a self-generating design-system documentation route into a Next.js consumer app. The route reads adhd.config.ts and globals.css at request time, renders a token catalog (colors / spacing / typography / radius / shadows) plus per-component pages with URL-driven prop toggles. Optionally excluded from production builds via Next.js pageExtensions trick. Re-runnable: marker-comment detection drives updates."
disable-model-invocation: true
argument-hint: ""
allowed-tools: Read Write Edit Bash AskUserQuestion
---

# ADHD Install Design System Docs Route

One-shot installer that drops a live design-system docs page into a Next.js App Router project. The page reads `adhd.config.ts` and `globals.css` at request time — no regen needed when components or tokens change. Re-running this skill picks up template improvements over time.

**Authoritative spec:** `docs/superpowers/specs/2026-05-11-adhd-install-design-system-docs-route.md`

## Invariants

1. **No ADHD references in generated files** outside of import paths pointing at `adhd.config.ts`. The marker comment is generic.
2. **adhd.config.ts is NOT modified** by this skill. Install choices live in the filesystem.
3. **All file writes are idempotent on re-run.** Marker-bearing files are replaced wholesale with the latest templates. Files where the user deleted the marker are left alone.

## Phase 1: Validate consumer environment

```bash
test -f adhd.config.ts || { echo "Missing adhd.config.ts. Run /adhd:config first."; exit 1; }
test -d app          || { echo "Missing app/ directory. This installer requires the Next.js App Router."; exit 1; }
test -f package.json || { echo "No package.json at the working directory."; exit 1; }
```

Read `package.json` and confirm `next` is in `dependencies` or `devDependencies`. Warn if missing or version < 16; continue anyway.

## Phase 2: Detect existing install

```bash
node plugins/adhd/lib/install-design-system-docs-route/cli.js detect-install --app-dir .
```

Output is newline-separated paths of files containing the marker comment.

- **No matches:** fresh install. Proceed to Phase 3 with defaults.
- **One or more matches:** use `AskUserQuestion`:
  - "Update in place" — re-write the listed marker-bearing files with the latest templates.
  - "Move to new location" — Phase 3 reasks the install questions; files at the old location are NOT deleted (the user manages them).
  - "Abort" — exit with no changes.

If user chose "Update in place," skip ahead to Phase 6 (patch + write) using the existing folder's group/segment as the choice; ask only "Exclude from production builds?" to confirm current state.

## Phase 3: Ask installation choices

Use `AskUserQuestion` three times:

1. **Route URL** — default `/-docs`. Validate: starts with `/`, only `a-z0-9-/` characters, no leading `_`.
2. **Route group** — default `(design-system)`. Validate: parens-wrapped, alphanumerics + hyphens inside, OR empty string for "no group."
3. **Exclude from production builds?** — default `Yes`.

Derive `groupName` and `routeSegment` from these answers. Example: routeUrl `/-docs` → routeSegment `-docs`. The group is independent of the URL.

## Phase 4: Detect Next.js config file

```bash
for f in next.config.ts next.config.mjs next.config.js; do
  test -f "$f" && echo "$f" && break
done
```

If none found: abort with "No next.config.* at the project root. Create one before running this installer."

## Phase 5: Detect filesystem collisions

```bash
TARGET="app/${GROUP}/${SEGMENT}"
test -e "$TARGET" && echo "EXISTS" || echo "FREE"
```

If `EXISTS` and Phase 2 didn't already mark this as an existing install: prompt "Path `<TARGET>` already exists but is not an installer artifact. Pick a different route or abort."

## Phase 6: Patch next.config.ts (only if prod-exclusion: yes)

```bash
node plugins/adhd/lib/install-design-system-docs-route/cli.js patch-next-config \
  --config "<next.config.path>" \
  --route-url "<routeUrl>"
```

Exit code 3 means an existing different `pageExtensions` was detected. The CLI prints the existing value. Use `AskUserQuestion`: "Your next.config.ts sets pageExtensions to `<existing>`. Merge with the design-system extension conditional? [Yes / Show me the manual patch / Abort]."

On "Yes": re-run the CLI without `detectOnly` (currently errors; for v1, print "Manual merge required. Patch the file to combine the existing pageExtensions with the conditional. Example:" and abort). On "Show me the manual patch": print the patch block and continue with file installs.

## Phase 7: Write the page files

```bash
node plugins/adhd/lib/install-design-system-docs-route/cli.js install \
  --config <choices.json>
```

Where `<choices.json>` is a temp file with shape:
```json
{
  "projectRoot": ".",
  "groupName": "(design-system)",
  "routeSegment": "-docs",
  "prodExcluded": true
}
```

The CLI prints the list of files it wrote.

## Phase 8: Patch robots.txt

```bash
node plugins/adhd/lib/install-design-system-docs-route/cli.js patch-robots \
  --robots public/robots.txt \
  --route-url "<routeUrl>"
```

If `public/` doesn't exist, create it first:
```bash
mkdir -p public
```

## Phase 9: Final report

Print:
```
✓ Design system docs route installed.

  URL:            http://localhost:3000<routeUrl>
  Filesystem:     app/<group>/<segment>/
  Prod exclusion: <ON | OFF>
  noindex meta:   ON
  robots.txt:     Disallow added

Run `npm run dev` and visit the URL to preview. The page reads adhd.config.ts
and globals.css at request time — no regen needed when you add components or
tokens.

Re-run /adhd:install-design-system-docs-route to pick up improved templates
over time. Files where you've removed the marker comment will be left alone.
```

## Common errors

| Error | Fix-up |
|---|---|
| `Missing adhd.config.ts` | Run `/adhd:config` first. |
| `Missing app/ directory` | This installer requires the Next.js App Router (not Pages Router). |
| `No next.config.* at the project root` | Create one with a default export of `{}`. |
| `Path <X> already exists but is not an installer artifact` | Pick a different route URL or move/delete the existing folder. |
| `next.config.ts sets pageExtensions to <existing>` | Manually merge with the design-system conditional, or skip prod-exclusion. |
````

- [ ] **Step 2: Validate SKILL frontmatter**

Run: `node scripts/validate-skill-frontmatter.js`
Expected: PASS — frontmatter valid; all SKILLs accounted for.

- [ ] **Step 3: Commit**

```bash
git add plugins/adhd/skills/install-design-system-docs-route/
git commit -m "Add /adhd:install-design-system-docs-route skill"
```

---

## Task 11: /adhd:config integration — optional final phase

**Files:**
- Modify: `plugins/adhd/skills/config/SKILL.md`

- [ ] **Step 1: Read the current SKILL.md to find the insertion point**

The config skill ends with Phase 5 (Report). The new phase goes after Phase 5, before any "Common errors" or "Reference" sections.

- [ ] **Step 2: Insert the new optional phase**

Add to `plugins/adhd/skills/config/SKILL.md` after the existing Phase 5:

```markdown
## Phase 6 (optional): Set up the design-system docs route

Use `AskUserQuestion`:

```
Question: "Set up the design-system docs route now? It's a live, self-generating
documentation page that reads your adhd.config.ts and globals.css. Mini-Storybook
for designers; not indexed by search engines."
Header: "Docs route"
Options:
  - "Yes, install it now"
  - "No, maybe later"
```

On "Yes": execute the phases of `/adhd:install-design-system-docs-route` inline.
See `plugins/adhd/skills/install-design-system-docs-route/SKILL.md` for the
detailed phase list (validate environment → detect existing install → ask install
choices → detect Next.js config → detect collisions → patch next.config.ts →
write files → patch robots.txt → final report).

On "No": print `Run /adhd:install-design-system-docs-route later to set it up.`
Exit normally.
```

- [ ] **Step 3: Validate frontmatter still passes**

Run: `node scripts/validate-skill-frontmatter.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/adhd/skills/config/SKILL.md
git commit -m "config: offer to install the design-system docs route as an optional final phase"
```

---

## Task 12: README + marketplace updates

**Files:**
- Modify: `README.md`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update the command table**

In `README.md`, change `After install, six slash commands are available:` → `After install, seven slash commands are available:`.

Add a row to the command table after `/adhd:pull-component`:

```
| `/adhd:install-design-system-docs-route` | — | install | One-shot installer for a live, self-generating design-system docs route in your Next.js consumer app. Reads adhd.config.ts + globals.css at request time. Excluded from production builds by default. |
```

- [ ] **Step 2: Add a "Design system docs route" subsection**

After the existing "Pull a component" subsection, add:

```markdown
### Design system docs route

Run once in your consumer repo:

```
/adhd:install-design-system-docs-route
```

This installs a live, self-generating documentation page that reads your
`adhd.config.ts` and `globals.css` at request time. The default URL is
`/-docs` (the hyphen prefix telegraphs "internal"), and files live under a
Next.js route group at `app/(design-system)/-docs/`. The page shows:

- Token catalog: every color / spacing / typography / radius / shadow in your
  Tailwind v4 `@theme` block, rendered as visual samples.
- Component pages: each component from `adhd.config.ts`'s `components.*` map
  gets its own route with URL-driven prop toggles.

By default the route is excluded from production builds via Next.js's
`pageExtensions` trick — files use the `.design-system.tsx` extension and
the production build literally doesn't see them. You can opt out at install
time if you'd rather ship the route (it still has `<meta name="robots"
content="noindex, nofollow" />` either way).

Re-run the installer over time to pick up improved templates. Files you've
customized — by removing the `// design-system-docs-route` marker comment —
are left alone.

You can also trigger the install at the end of `/adhd:config` if you're
setting up ADHD for the first time.
```

- [ ] **Step 3: Update marketplace.json description**

Read the file. Update the `adhd` plugin's description to mention the new install command. Preserve existing phrasing style.

- [ ] **Step 4: Commit**

```bash
git add README.md .claude-plugin/marketplace.json
git commit -m "README + marketplace: document /adhd:install-design-system-docs-route"
```

---

## Task 13: Final verification + PR

- [ ] **Step 1: Run all lib tests**

```bash
node --test plugins/adhd/lib/lint-engine/__tests__/ \
            plugins/adhd/lib/design-system/__tests__/ \
            plugins/adhd/lib/push-component/__tests__/ \
            plugins/adhd/lib/pull-component/__tests__/ \
            plugins/adhd/lib/install-design-system-docs-route/__tests__/
```

Expected: all pass. New tests added: ~47 (3 cli stub + 8 token + 8 prop + 6 slug + 5 next-config + 5 robots + 10 templates + 8 route-installer + 7 cli wiring = ~60 total in the new lib).

- [ ] **Step 2: Run the SKILL frontmatter validator**

```bash
node scripts/validate-skill-frontmatter.js
```

Expected: PASS, 7/7 skills valid (config, lint, pull-component, pull-design-system, push-component, push-design-system, install-design-system-docs-route).

- [ ] **Step 3: Build the example app to sanity-check**

```bash
cd example && npm run build && cd ..
```

Expected: compile clean.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin adhd/install-design-system-docs-route
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "Add /adhd:install-design-system-docs-route skill" --body "$(cat <<'EOF'
## Summary

Adds /adhd:install-design-system-docs-route — a one-shot installer that drops a live, self-generating design-system documentation route into a Next.js consumer app. The route reads adhd.config.ts and globals.css at request time, renders a token catalog (colors / spacing / typography / radius / shadows) plus per-component pages with URL-driven prop toggles.

## Key design choices

- **Pure one-shot install.** No adhd.config.ts schema additions — install choices (route URL, route group, prod-exclusion) live in the filesystem.
- **Route group `(design-system)` + hyphen-prefix URL `/-docs` by default.** Group organizes future internal routes filesystem-side; hyphen prefix telegraphs "internal."
- **Production exclusion via Next.js pageExtensions conditional.** Files use `.design-system.tsx` extension; next.config.ts patched to include the extension only when NODE_ENV !== 'production'. Files literally invisible to the production build.
- **Ejection-friendly.** Generated files contain zero references to "ADHD." Marker comment is generic.
- **Re-runnable.** Marker-bearing files get replaced with the latest templates on re-run; user can opt OUT of overwrites by deleting the marker.
- **Triggered as optional final phase of /adhd:config** for first-time setup. Available standalone for retroactive install.

## Test plan

- [x] ~60 new unit tests across token-parser, prop-parser, slug, next-config-patcher, robots-patcher, templates, route-installer, cli
- [x] Full lib suite green
- [x] 7/7 SKILL frontmatters valid
- [x] Example app builds clean
- [ ] Manual smoke test in example/: install → npm run dev → visit /-docs → click into a component → toggle props → npm run build → npm start → confirm /-docs returns 404

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: Verify CI is green**

```bash
sleep 30 && gh pr checks $(gh pr view --json number -q .number)
```

Expected: all checks pass.

---

## Self-review

**Spec coverage:**

| Spec section / criterion | Task |
|---|---|
| Skill command surface | Task 10 (SKILL), Task 12 (README) |
| File layout in consumer app | Task 7 (templates), Task 8 (route-installer) |
| Route group + hyphen URL defaults | Task 8 (installRoute), Task 10 (SKILL Phase 3) |
| File extensions (.design-system.tsx vs .tsx) | Task 8 (installRoute logic) |
| Marker comment | Task 7 (templates MARKER_COMMENT), Task 8 (detectExistingInstall) |
| Pipeline Phase 1 (Validate environment) | Task 10 |
| Pipeline Phase 2 (Detect existing install) | Task 8 (detectExistingInstall), Task 10 (SKILL Phase 2) |
| Pipeline Phase 3 (Ask choices) | Task 10 |
| Pipeline Phase 4 (Detect next.config) | Task 10 |
| Pipeline Phase 5 (Detect collisions) | Task 10 |
| Pipeline Phase 6 (Patch next.config) | Task 5 (next-config-patcher), Task 10 |
| Pipeline Phase 7 (Write files) | Task 8 (route-installer), Task 10 |
| Pipeline Phase 8 (Patch robots.txt) | Task 6 (robots-patcher), Task 10 |
| Pipeline Phase 9 (Report) | Task 10 |
| Update semantics (re-run replaces marker-bearing) | Task 8 + Task 10 |
| Token-parser behavior | Task 2 |
| Prop-parser behavior | Task 3 |
| Slug + collision | Task 4 |
| /adhd:config integration | Task 11 |
| README updates | Task 12 |
| Marketplace description | Task 12 |
| CI step | Task 1 |
| Acceptance criteria 1-21 | Covered across Tasks 1-13 |

No gaps.

**Type / signature consistency:**

- `parseTokens(css: string)` → `{ colors, spacing, typography, radius, shadows, unknown }` — Tasks 2, 7 (used in INDEX_PAGE_TSX template), 9
- `parseProps(source: string)` → `{ componentName, props, unions }` — Tasks 3, 7 (used in COMPONENT_PAGE_TSX), 9
- `slugFor(path: string)` → string; `slugMap(paths: string[])` → `{ [path]: slug }` — Tasks 4, 9
- `patchNextConfig(source: string, opts?: { detectOnly: boolean })` → string OR `{ conflict, existing }` — Tasks 5, 9
- `patchRobots(source: string | null, routeUrl: string)` → string — Tasks 6, 9
- `installRoute(projectRoot: string, opts: { groupName, routeSegment, prodExcluded })` → `{ files: string[] }` — Tasks 8, 9
- `detectExistingInstall(projectRoot: string)` → string[] — Tasks 8, 9
- Marker comment string `design-system-docs-route — auto-generated installer artifact; safe to edit.` — consistent across templates, route-installer, SKILL.md

**Placeholder scan:**

Searched the plan for TODO/TBD/FIXME — only legitimate hits (e.g. inside code comments showing intentional behavior). No real placeholders.
