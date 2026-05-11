# /adhd:install-design-system-docs-route — Install a Self-Generating Design-System Docs Route

**Goal:** One-shot scaffolding command that installs a live, self-generating documentation route into a Next.js consumer app. The route reads `adhd.config.ts` and `globals.css` at request time, renders a token catalog (colors / spacing / typography / radius / shadows) plus a list of every tracked component, and offers per-component pages with URL-driven prop toggles. Behaves like a mini-Storybook tailored to the ADHD design-system model.

**Architectural premise:** The route is **dynamic at runtime**. No regen step when components or tokens change — the page reads filesystem state on each request. The skill is a pure one-shot installer that drops a small set of files into the consumer app and optionally patches `next.config.ts`. Nothing is stored in `adhd.config.ts` about the docs route — the install choices are encoded in the filesystem.

**Ejection-friendly:** generated files contain zero references to the word "ADHD." The only place ADHD appears in the consumer app is `adhd.config.ts` itself. If the user later ejects from ADHD, the docs route still works as long as `adhd.config.ts` (or whatever they rename it to) remains present and parseable.

**Precondition:** The consumer app is a Next.js 16+ App Router project with an `adhd.config.ts` at the repo root. The skill aborts otherwise.

---

## Final command surface

```
/adhd:install-design-system-docs-route   — install or update the docs route (NEW)
```

Also triggered as an optional final phase of `/adhd:config` (the wizard asks "Set up the design-system docs route?" and on `yes` walks through the same install flow inline).

**Out of scope for v1:**
- Multi-route documentation (e.g. one URL per token domain). v1 is a single route with index + per-component pages.
- Image-based component previews (rendering a server-side screenshot). v1 renders the component as live HTML.
- Live Figma comparison side-by-side. v1 is purely code-side documentation.
- Storage of user customizations on regen. v1 detects existing installs and prompts before overwriting; in-place updates preserve the layout file's customizations via Edit-not-Write.

---

## Architecture

**File layout in the consumer app** (defaults shown; both `(design-system)` and `-docs` are configurable at install time):

```
example/
├── adhd.config.ts                                  # untouched by this skill
├── next.config.ts                                  # patched only if prod-exclusion: yes
├── public/
│   └── robots.txt                                  # patched (Disallow line added; file created if missing)
└── app/
    └── (design-system)/                            # Next.js route group — invisible in URL
        └── -docs/
            ├── layout.design-system.tsx            # or layout.tsx — see "File extensions" below
            ├── page.design-system.tsx              # index — URL: /-docs
            └── [component]/
                └── page.design-system.tsx          # per-component — URL: /-docs/<slug>
```

**Route group `(design-system)`:** organizes the route filesystem-side without affecting URLs. Future internal design-system routes (token playground, fixture viewer, etc.) cohabit cleanly under the same group. The user can pick a different group name at install or omit the group entirely.

**Route URL `/-docs`:** the hyphen prefix telegraphs "internal" in the URL itself. The user can pick a different URL at install (e.g. `/design-system`, `/docs`, `/-internal/design-system`).

**File extensions when prod-excluded:** files use `.design-system.tsx`. The skill patches `next.config.ts` to include this extension in `pageExtensions` only when `NODE_ENV !== 'production'`:

```ts
const nextConfig: NextConfig = {
  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],
  // ...existing config
};
```

Production builds literally do not see these files. Zero bundle pollution.

**File extensions when NOT prod-excluded:** plain `.tsx`. `next.config.ts` is not patched. The route ships normally in production with `<meta name="robots" content="noindex, nofollow" />` and a `robots.txt` Disallow entry. Used by teams that want internal docs reachable in deployed environments behind their own auth.

**The marker comment:** every generated file starts with:
```ts
// design-system-docs-route — auto-generated installer artifact; safe to edit.
// Remove this comment to disable future overwrites from re-running the installer.
```
The skill scans for this comment to detect existing installs. The user can opt out of future overwrites by deleting the comment.

---

## Pipeline

```
Phase 1   Validate consumer environment        — adhd.config.ts present, Next.js 16+ App Router
Phase 2   Detect existing install              — scan app/ for marker comment
Phase 3   Ask installation choices             — route URL, route group, prod-exclusion
Phase 4   Detect Next.js config file           — .ts / .mjs / .js
Phase 5   Detect filesystem collisions         — target folder, route group name
Phase 6   Patch next.config.ts                 — only if prod-exclusion: yes
Phase 7   Write the page files                 — layout, index, [component]
Phase 8   Patch robots.txt                     — Disallow entry
Phase 9   Final report
```

### Phase 1 — Validate consumer environment

Required:
- `adhd.config.ts` at the project root. If missing: abort with "Run /adhd:config first."
- `package.json` declares `next` as a dependency. Parse the version; if < 16, warn but continue (App Router has been stable since 13.4; the install is likely to work).
- `app/` directory present (App Router convention). If only `pages/` is present, abort with "This installer requires the Next.js App Router. App Router is in `app/`; you appear to be using Pages Router."

### Phase 2 — Detect existing install

Scan `app/**/page.*tsx` and `app/**/layout.*tsx` for the marker comment. If found, capture the folder path of the install. Behaviors:

| Found | Skill behavior |
|---|---|
| No marker comment anywhere | Fresh install — proceed to Phase 3 with defaults. |
| One marker found | Prompt: "An existing install at `<path>`. [Update in place / Move to new location / Abort]." |
| Multiple markers found | Unusual. Print all locations, prompt: "Pick which to update or move; the others stay as-is." |

### Phase 3 — Ask installation choices

Use `AskUserQuestion` for each (with defaults filled in from the existing install if updating):

1. **Route URL** — default `/-docs`. Validate: starts with `/`, only `a-z0-9-/` characters. Reject `_` prefixes (Next.js private folders won't route).
2. **Route group** — default `(design-system)`. Validate: parens-wrapped, alphanumerics + hyphens inside. Empty/`""` is also valid (no group).
3. **Exclude from production builds?** — default `yes`. Determines file extension + `next.config.ts` patch.

Save the choices in working memory. The choices are NOT written to `adhd.config.ts` — they're encoded in the filesystem.

### Phase 4 — Detect Next.js config file

Look for `next.config.ts`, `next.config.mjs`, `next.config.js` in priority order. If multiple, prefer `.ts`. Capture the file path. If none, abort: "No `next.config.*` found at the project root."

### Phase 5 — Detect filesystem collisions

Construct the install path: `app/<group>/<route-segment>/`. Check:
- Target folder exists but has no marker comment → existing user content. Prompt: "Path `<full-path>` already exists. Pick a different route or abort."
- Group folder exists but for unrelated purpose (e.g. user has their own `(design-system)` group) → prompt: "Group `(design-system)` already in use. Pick a different group or abort."

### Phase 6 — Patch `next.config.ts` (conditional)

Only runs if prod-exclusion: yes.

Read the existing `next.config.ts`. Use `Edit` to add or update the `pageExtensions` field within the `NextConfig` object. The patch shape:

```ts
const nextConfig: NextConfig = {
  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['ts', 'tsx']
    : ['ts', 'tsx', 'design-system.ts', 'design-system.tsx'],
  // ...existing config preserved verbatim
};
```

**Idempotent:** if `pageExtensions` already has this exact conditional shape, no-op. If it has a different `pageExtensions` value entirely, prompt: "Your `next.config.ts` already sets `pageExtensions`. Show me the current value and the patch I'd apply; do you want to merge?" Print both, ask for confirmation, merge.

**Edit failure:** if the config file's shape isn't a clean `export default { ... }` object the regex can patch, print the exact lines to add manually, continue with file installs.

### Phase 7 — Write the page files

Three files written via `Write`. All start with the marker comment.

**`layout[.design-system].tsx`:**
```tsx
// design-system-docs-route — auto-generated installer artifact; safe to edit.
// Remove this comment to disable future overwrites from re-running the installer.
import type { Metadata } from "next";

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
```

**`page[.design-system].tsx` (index):**

Server component. Reads:
1. `adhd.config.ts` source — extracts `cssEntry` (default `app/globals.css`) and `components.*` map keys.
2. The resolved `globals.css` source — parses `@theme` block via the inlined `token-parser` helper.

Renders sections:
- **Colors:** swatch grid (color div + name + resolved value).
- **Spacing:** horizontal bars sized to each spacing increment.
- **Typography:** each `--text-*` rendered as `"The quick brown fox"` at its size with its line-height applied.
- **Radius:** small squares with each `--radius-*` applied.
- **Shadows:** small boxes with each shadow effect applied.
- **Components:** list of components from the config, each linking to `/-docs/<slug>`.

Empty-state behavior:
- No `@theme` block in `globals.css` → token sections show "No tokens detected. Configure `@theme` in your CSS entry."
- No `components` map in `adhd.config.ts` → components section shows "No components tracked. Push one with `/adhd:push-component <path>`."

**`[component]/page[.design-system].tsx` (per-component dynamic route):**

Server component. Receives `params.component` and `searchParams`. Steps:

1. Resolve the component path: scan `adhd.config.ts`'s `components.*` keys, slug each, match against `params.component`.
2. Read the component source file via `fs.readFile`. Parse the props interface inline (regex parser, ~40 LOC; handles named-union references and inline literal unions).
3. Compute current prop values from `searchParams` — each prop's value is `searchParams.get(propName) ?? <component's declared default>`. Booleans parse `'true'/'false'`. Unknown prop values for unions fall back to the default.
4. Dynamic-import the component via parametric template-string:
   ```ts
   const mod = await import(`@/${componentPath.replace(/^app\//, 'app/').replace(/\.tsx?$/, '')}`);
   const Component = mod.default ?? mod[componentName];
   ```
5. Render:
   - **Top:** prop toggle UI (a small client component for snappy URL updates; falls back to a plain `<form>` for no-JS).
   - **Middle:** `<Component {...currentProps} />` inside an error boundary.
   - **Bottom:** import statement + JSX invocation snippet, both as `<pre>` blocks reflecting current state.

**Client island for snappy toggles** (a tiny separate file, also `.design-system.tsx`):
```tsx
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function PropToggle({ name, options, value }: { name: string; options: string[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <select
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(params);
        next.set(name, e.target.value);
        router.replace(`${path}?${next}`);
      }}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
```

### Phase 8 — Patch `robots.txt`

Look for `public/robots.txt`. If absent, create with:
```
User-agent: *
Disallow: /-docs
```

If present, check for an existing `Disallow: /-docs` entry; add if missing. Idempotent.

### Phase 9 — Final report

Print:
```
✓ Design system docs route installed.

  URL:           http://localhost:3000/-docs
  Filesystem:    app/(design-system)/-docs/
  Prod exclusion: ON (next.config.ts patched)
  noindex meta:  ON
  robots.txt:    Disallow added

Run `npm run dev` and visit the URL to preview. The page reads adhd.config.ts
and globals.css at request time — no regen needed when you add components or
tokens.
```

---

## Data flow (runtime, in the consumer app)

```
┌────────────────────────────────────────────────────────────────┐
│ HTTP GET /-docs                                                 │
└────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────────┐
│ app/(design-system)/-docs/page[.design-system].tsx              │
│ (server component)                                              │
└────────────────────────────────────────────────────────────────┘
        │                                       │
        │ fs.readFile                           │ fs.readFile
        ▼                                       ▼
┌──────────────────────┐                ┌──────────────────────┐
│ adhd.config.ts       │                │ globals.css          │
│  - figma.url         │                │  @theme              │
│  - cssEntry          │                │   --color-*          │
│  - components.*      │                │   --spacing          │
│                      │                │   --text-*           │
│                      │                │   --radius-*         │
│                      │                │   --shadow-*         │
└──────────────────────┘                └──────────────────────┘
        │                                       │
        ▼                                       ▼
┌────────────────────────────────────────────────────────────────┐
│ HTML response                                                   │
│  - color swatches, spacing bars, type demos, radius/shadow      │
│  - components list (linked to /-docs/<slug>)                    │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ HTTP GET /-docs/avatar?size=lg&shape=circle                     │
└────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────────┐
│ app/(design-system)/-docs/[component]/page[.design-system].tsx  │
│ (server component)                                              │
└────────────────────────────────────────────────────────────────┘
        │                       │                       │
        │ fs.readFile           │ fs.readFile           │ dynamic import
        ▼                       ▼                       ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ adhd.config.ts   │  │ components/      │  │ Component module │
│ resolve slug →   │  │  avatar/         │  │ via parametric   │
│ component path   │  │  index.tsx       │  │ template-string  │
│                  │  │ (parse props)    │  │ import           │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────────┐
│ HTML response                                                   │
│  - PropToggle (client island) per prop, hydrated for snappy     │
│    URL updates                                                   │
│  - <Component {...currentProps} /> inside error boundary        │
│  - <pre>import { Avatar } from "@/app/components/avatar";</pre> │
│  - <pre><Avatar size="lg" shape="circle" /></pre>               │
└────────────────────────────────────────────────────────────────┘
```

---

## Module layout

New library at `plugins/adhd/lib/install-design-system-docs-route/`:

| File | Responsibility |
|---|---|
| `token-parser.js` | Extract colors / spacing / typography / radius / shadows from a `globals.css` string. Slimmer variant of `lib/design-system/code-parser.js`; returns shape suited for the docs page's rendering. |
| `prop-parser.js` | Regex-based parser for a component's `<Name>Props` interface. Returns `{ [propName]: { type, values?, optional } }`. Reuses logic from `lib/push-component/parse-component.js` but exported as a standalone helper. |
| `slug.js` | Path → URL slug + collision detection. |
| `next-config-patcher.js` | Idempotent patch of `next.config.{ts,mjs,js}` to set conditional `pageExtensions`. Preserves existing config. Detects current state; no-op on re-apply. |
| `robots-patcher.js` | Idempotent patch of `public/robots.txt`. Creates if missing. |
| `route-installer.js` | Orchestrates: writes the 3 page files (or 4 with the client island), with the correct extension based on prod-exclusion choice. |
| `cli.js` | Subcommand surface for the SKILL: `detect-install`, `parse-tokens`, `parse-props`, `slug`, `patch-next-config`, `patch-robots`, `install`. |

New skill at `plugins/adhd/skills/install-design-system-docs-route/SKILL.md`.

Modified files:
- `plugins/adhd/skills/config/SKILL.md` — add optional final phase that invokes the install flow.
- `.claude-plugin/marketplace.json` — bump description.
- `README.md` — add the new command row.
- `.github/workflows/ci.yml` — add the new test step.

---

## Marker comment

Generated files start with:

```ts
// design-system-docs-route — auto-generated installer artifact; safe to edit.
// Remove this comment to disable future overwrites from re-running the installer.
```

The string `design-system-docs-route` is unique enough to detect via grep. The user can opt out of future overwrites by removing the comment — the skill will then refuse to touch the file unless the user explicitly confirms re-install.

**No reference to "ADHD" or "/adhd:..."** in the comment. The marker is generic; ejection-friendly.

---

## Edge cases & errors

| Case | Behavior |
|---|---|
| `adhd.config.ts` missing | Abort: "Run /adhd:config first to set up ADHD." |
| `package.json` missing or doesn't declare `next` | Abort: "This installer expects a Next.js project at the working directory." |
| `app/` directory missing (Pages Router project) | Abort: "This installer requires the Next.js App Router." |
| `next.config.ts/.mjs/.js` missing | Abort: "No next.config.* at the project root. Create one before running this installer." |
| Existing install at target path (marker present) | Prompt: update / move / abort |
| Existing user folder at target path (no marker) | Prompt: pick a different route or abort |
| Existing route group with the chosen name (no marker) | Prompt: pick a different group or abort |
| `next.config.ts` already sets `pageExtensions` to a different value | Prompt: show the existing value, show the proposed merge, ask to confirm |
| `next.config.ts` shape unrecognizable | Print the exact lines to add, continue with file installs |
| `public/` directory missing | Create `public/robots.txt`; the directory comes along |
| `robots.txt` already has the Disallow line | No-op |
| User chose route URL `/foo` but folder `app/foo/` already exists with user content | Phase 5 catches this; prompts before proceeding |
| Component referenced in `adhd.config.ts` no longer exists | Index page shows it with a "missing" badge; per-component route returns a clean 404 with the missing path |
| Component's Props interface can't be parsed | Per-component page renders the component with declared defaults; banner "Prop introspection failed — toggles unavailable." |
| Component throws at render | Error boundary catches; shows the error message inline; "reset to defaults" link |
| Dynamic-import path fails to resolve (component file moved/deleted) | Surface the error inline on that component's page; other routes keep working |
| Search-param value invalid for a union prop | Fall back to default; small inline warning |
| User runs `next build` with prod-exclusion ON | Files invisible to the build; route returns 404 in production |
| User runs `next build` with prod-exclusion OFF | Route ships; noindex meta + robots.txt entry still apply |
| User has CRLF line endings | `Edit` preserves them; new files written with the platform's default ending |

---

## Symmetric-pipeline assertions

| Assertion | Mechanism |
|---|---|
| `prop-parser.js` shares its behavior contract with `lib/push-component/parse-component.js` | The two regex parsers handle the same prop-type categories (union, primitive, optional flag, ReactNode/function/ref skips). Unit-tested in parallel; a smoke test asserts both produce equivalent output for the Avatar source. |
| `token-parser.js` produces tokens consistent with `lib/design-system/code-parser.js` | Same `@theme` extraction logic, narrowed to the subset the docs page needs. Unit-tested against the same `globals.css` fixtures. |

---

## Testing strategy

**Unit tests** (`plugins/adhd/lib/install-design-system-docs-route/__tests__/`):

| Module | Coverage |
|---|---|
| `token-parser.js` | Extracts all 5 domains from a Tailwind v4 `globals.css`; handles missing `@theme` block; handles unknown vars (returns "unknown" category). |
| `prop-parser.js` | Parses the Avatar interface; handles inline unions, named-union references, primitives, ReactNode/function/ref (skipped). |
| `slug.js` | Path → slug; collision detection. |
| `next-config-patcher.js` | Patches `.ts` / `.mjs` / `.js`; idempotent on re-apply; preserves existing config; detects already-customized `pageExtensions` and merges with prompt. |
| `robots-patcher.js` | Creates / appends; idempotent. |
| `route-installer.js` | Writes correct files for each prod-exclusion choice; refuses overwrite without confirmation; detects existing install via marker. |
| `cli.js` | Each subcommand exits 0 on success, 2 on usage error. |

**Integration test** (one):
- Run end-to-end against a copy of `example/` in a temp dir. Assert all files exist with the marker; `next.config.ts` has the conditional `pageExtensions`; re-running detects the install.

**Manual smoke test** (acceptance criterion #20):
1. In `example/`: run `/adhd:install-design-system-docs-route`. Pick defaults.
2. `npm run dev`; visit `/-docs`. Verify token catalog + components list.
3. Click into a component; verify toggles, URL updates, rendered output.
4. `npm run build`; verify the `/-docs` chunks don't appear in `.next/server/app/`.
5. `npm start`; visit `/-docs`; verify 404.

---

## Integration with `/adhd:config`

`plugins/adhd/skills/config/SKILL.md` gets a new optional final phase (Phase 6 or after the existing "Report"):

```markdown
## Phase 6 (optional): Set up the design-system docs route

Use AskUserQuestion:

  "Set up the design-system docs route? It's a live, self-generating
  documentation page that reads your adhd.config.ts and globals.css.
  Mini-Storybook for designers; not indexed by search engines."

  Options:
    - "Yes, install it now" → walk through the install phases inline
      (see plugins/adhd/skills/install-design-system-docs-route/SKILL.md
      for the full phase list)
    - "No, maybe later" → print "Run /adhd:install-design-system-docs-route
      to set it up later." Exit.
```

The install phases are documented in the standalone skill; `/adhd:config` references that skill and instructs Claude to follow its phases inline.

---

## Acceptance criteria

1. `/adhd:install-design-system-docs-route` runs against a Next.js 16+ App Router project with an existing `adhd.config.ts`. Writes layout + index page + dynamic `[component]/page` (+ a small client-island file for prop toggles).
2. Default route URL is `/-docs`; route group default is `(design-system)`; both configurable at install time; neither stored in `adhd.config.ts`.
3. Default behavior: prod-excluded. `next.config.ts` gets the conditional `pageExtensions` patch; generated files use `.design-system.tsx` extension. User can opt out at install time.
4. Skill detects existing installs via the marker comment (`design-system-docs-route — auto-generated installer artifact; safe to edit.`) and prompts before overwriting.
5. Skill detects `next.config.ts` / `.mjs` / `.js` and patches whichever exists; if the file's shape can't be safely patched via `Edit`, prints the exact patch and continues with file installs.
6. Index page renders sections for colors, spacing, typography, radius, shadows (parsed from `globals.css`'s `@theme`); empty-state strings when a section is missing.
7. Index page lists components from `adhd.config.ts`'s `components.*` map; each links to `/-docs/<slug>`.
8. Per-component page dynamically imports the component via parametric template-string import; renders inside an error boundary.
9. Prop toggles: `<select>` for unions; `<input type="checkbox">` for booleans; text/number inputs for primitives; ReactNode / function / ref / array / object props skipped with an inline note.
10. Prop toggles update URL search params via a small client island; the server component re-renders with new params. No-JS fallback via `<form>` works.
11. Per-component page shows the import statement + current JSX invocation as `<pre>` blocks reflecting the current prop state.
12. Layout has `<meta name="robots" content="noindex, nofollow" />`; `robots.txt` Disallow entry added/created.
13. Generated files contain zero references to "ADHD." Only `adhd.config.ts` does.
14. Marker comment is generic: `// design-system-docs-route — auto-generated installer artifact; safe to edit.`
15. `/adhd:config` gets a new optional final phase: "Set up the design-system docs route?" On yes, walks through the install flow inline. On no, prints the run-it-yourself instruction.
16. Re-running the skill is idempotent — no duplicate writes, no duplicate `next.config.ts` patches, no duplicate `robots.txt` entries, prompts on existing install.
17. With prod-exclusion enabled: `next build` produces no chunks for the route; `npm start` returns 404 at the route URL.
18. With prod-exclusion disabled: route ships with noindex meta still applied.
19. README's command table includes the new `/adhd:install-design-system-docs-route` row.
20. Manual smoke test against `example/` passes end-to-end: install → dev server → click through → build → 404 in production.
