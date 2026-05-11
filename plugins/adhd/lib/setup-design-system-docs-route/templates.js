'use strict';

const MARKER_COMMENT = `// design-system-docs-route — auto-generated installer artifact; safe to edit.
// Remove this comment to disable future overwrites from re-running the installer.
`;

// tokenDomains.tsx — the single source of truth for the token-domain catalog
// (sidebar entries + per-domain renderer keys). Generated once per install and
// imported by both layout.* and tokens/[domain]/page.*. The `tailwindDocs`
// field is the URL to Tailwind v4's relevant theme section, used in
// empty-state messaging on each domain page.
const TOKEN_DOMAINS_TSX = `${MARKER_COMMENT}export type TokenDomain = {
  slug: string;
  label: string;
  varPrefix: string;
  tailwindDocs: string;
};

export const TOKEN_DOMAINS: TokenDomain[] = [
  { slug: "colors", label: "Colors", varPrefix: "--color-", tailwindDocs: "https://tailwindcss.com/docs/colors" },
  { slug: "spacing", label: "Spacing", varPrefix: "--spacing", tailwindDocs: "https://tailwindcss.com/docs/theme#spacing" },
  { slug: "typography", label: "Typography", varPrefix: "--text-", tailwindDocs: "https://tailwindcss.com/docs/font-size" },
  { slug: "font", label: "Font Families", varPrefix: "--font-", tailwindDocs: "https://tailwindcss.com/docs/font-family" },
  { slug: "font-weight", label: "Font Weights", varPrefix: "--font-weight-", tailwindDocs: "https://tailwindcss.com/docs/font-weight" },
  { slug: "tracking", label: "Tracking", varPrefix: "--tracking-", tailwindDocs: "https://tailwindcss.com/docs/letter-spacing" },
  { slug: "leading", label: "Leading", varPrefix: "--leading-", tailwindDocs: "https://tailwindcss.com/docs/line-height" },
  { slug: "radius", label: "Radius", varPrefix: "--radius-", tailwindDocs: "https://tailwindcss.com/docs/border-radius" },
  { slug: "shadows", label: "Shadows", varPrefix: "--shadow-", tailwindDocs: "https://tailwindcss.com/docs/box-shadow" },
  { slug: "breakpoint", label: "Breakpoints", varPrefix: "--breakpoint-", tailwindDocs: "https://tailwindcss.com/docs/responsive-design" },
  { slug: "ease", label: "Easing", varPrefix: "--ease-", tailwindDocs: "https://tailwindcss.com/docs/transition-timing-function" },
  { slug: "animate", label: "Animation", varPrefix: "--animate-", tailwindDocs: "https://tailwindcss.com/docs/animation" },
];
`;

// Tokens-page CSS reader. Kept inline because the tokens page is a runtime
// server component in the consumer's app and can't import ADHD's lib helpers.
const READ_CSS_SRC = `async function readCss(cssEntry: string) {
  try { return await fs.readFile(path.resolve(process.cwd(), cssEntry), "utf8"); }
  catch { return null; }
}`;

// The CSS @theme parser used by the tokens page. Brace-counted scan correctly
// handles `@theme { ... }` and `@theme inline { ... }`. Prefix order in
// PREFIX_MAP matters — longer prefixes (`font-weight-`) must precede shorter
// ones (`font-`) so classification picks the most-specific match.
const PARSE_TOKENS_SRC = `function extractThemeBodies(css: string): string[] {
  const bodies: string[] = [];
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf("@theme", i);
    if (idx === -1) break;
    let j = idx + "@theme".length;
    while (j < css.length && css[j] !== "{" && css[j] !== ";") j++;
    if (css[j] !== "{") { i = j + 1; continue; }
    let depth = 1;
    let k = j + 1;
    while (k < css.length && depth > 0) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") depth--;
      if (depth > 0) k++;
    }
    bodies.push(css.slice(j + 1, k));
    i = k + 1;
  }
  return bodies;
}

type Row = { name: string; value: string };
type TypoRow = { name: string; size: string | null; lineHeight: string | null };

function parseTokens(css: string | null) {
  const out = {
    colors: [] as Row[],
    spacing: { multiplier: null as string | null },
    typography: [] as TypoRow[],
    fonts: [] as Row[],
    fontWeights: [] as Row[],
    radius: [] as Row[],
    shadows: [] as Row[],
    tracking: [] as Row[],
    leading: [] as Row[],
    breakpoints: [] as Row[],
    easings: [] as Row[],
    animations: [] as Row[],
  };
  if (!css) return out;
  const typoByName = new Map<string, TypoRow>();
  const LINE_HEIGHT_SUFFIX = "--line-height";
  const PREFIX_MAP: Array<[string, keyof typeof out]> = [
    ["color-", "colors"],
    ["font-weight-", "fontWeights"],
    ["font-", "fonts"],
    ["inset-shadow-", "shadows"],
    ["drop-shadow-", "shadows"],
    ["shadow-", "shadows"],
    ["radius-", "radius"],
    ["tracking-", "tracking"],
    ["leading-", "leading"],
    ["breakpoint-", "breakpoints"],
    ["ease-", "easings"],
    ["animate-", "animations"],
  ];
  for (const body of extractThemeBodies(css)) {
    const declRe = /--([a-zA-Z0-9_-]+)\\s*:\\s*([^;]+);/g;
    let d;
    while ((d = declRe.exec(body)) !== null) {
      const name = d[1];
      const value = d[2].trim();
      if (name === "spacing") { out.spacing.multiplier = value; continue; }
      if (name.startsWith("text-")) {
        const rest = name.slice("text-".length);
        const isLh = rest.endsWith(LINE_HEIGHT_SUFFIX);
        const leaf = isLh ? rest.slice(0, -LINE_HEIGHT_SUFFIX.length) : rest;
        let row = typoByName.get(leaf);
        if (!row) { row = { name: leaf, size: null, lineHeight: null }; typoByName.set(leaf, row); out.typography.push(row); }
        if (isLh) row.lineHeight = value; else row.size = value;
        continue;
      }
      for (const [prefix, domain] of PREFIX_MAP) {
        if (name.startsWith(prefix)) {
          (out[domain] as Row[]).push({ name: name.slice(prefix.length), value });
          break;
        }
      }
    }
  }
  return out;
}`;

// componentMap.tsx — the heart of the new static architecture. Generated per
// install from adhd.config.ts. Each tracked component gets an explicit
// `import * as $cmpN from "@/<path>"` so Webpack/Turbopack resolves a single,
// known module per component — no context module, no broad bundle, no
// Tailwind blast radius. To add/rename/remove a component: edit
// `adhd.config.ts`, then re-run `/adhd:setup-design-system-docs-route`.
//
// Placeholders substituted by route-installer.js:
//   __COMPONENT_IMPORTS__ — one `import * as $cmpN from "<importPath>";` per component
//   __COMPONENT_ENTRIES__ — array literal of `{ slug, rawPath, module: $cmpN }`
const COMPONENT_MAP_TSX = `${MARKER_COMMENT}import type React from "react";
__COMPONENT_IMPORTS__

type ModuleShape = Record<string, unknown>;

// Resolve the renderable function from a module: prefer the default export,
// fall back to the first exported function. Mirrors the previous runtime
// resolution behavior so existing user components keep working.
function resolveComponent(mod: ModuleShape): React.ComponentType<any> | null {
  if (typeof mod.default === "function") return mod.default as React.ComponentType<any>;
  for (const v of Object.values(mod)) {
    if (typeof v === "function") return v as React.ComponentType<any>;
  }
  return null;
}

export type ComponentEntry = {
  slug: string;
  rawPath: string;
  Component: React.ComponentType<any> | null;
};

const ENTRIES: Array<{ slug: string; rawPath: string; module: ModuleShape }> = __COMPONENT_ENTRIES__;

export const componentEntries: Array<{ slug: string; rawPath: string }> =
  ENTRIES.map(e => ({ slug: e.slug, rawPath: e.rawPath }));

export function getComponent(slug: string): ComponentEntry | null {
  const entry = ENTRIES.find(e => e.slug === slug);
  if (!entry) return null;
  return { slug: entry.slug, rawPath: entry.rawPath, Component: resolveComponent(entry.module) };
}
`;

// Layout: sidebar links into the token-domain catalog and the static component
// map. No fs reads, no async — pure server component.
const LAYOUT_TSX = `${MARKER_COMMENT}import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN_DOMAINS } from "./tokenDomains";
import { componentEntries } from "./componentMap";

export const metadata: Metadata = {
  title: "Design System Docs",
  robots: { index: false, follow: false },
};

export default function DesignSystemDocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <aside className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-4 sticky top-0 h-screen overflow-y-auto">
        <Link href={\`__ROUTE_PATH__\`} className="block mb-6">
          <h1 className="text-sm font-medium">Design System</h1>
          <p className="text-[10px] text-zinc-500">Internal — not indexed</p>
        </Link>

        <nav className="flex flex-col gap-4 text-sm">
          <section>
            <h2 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Tokens</h2>
            <ul className="flex flex-col gap-1">
              {TOKEN_DOMAINS.map(d => (
                <li key={d.slug}>
                  <Link href={\`__ROUTE_PATH__/tokens/\${d.slug}\`} className="block rounded px-2 py-1 hover:bg-zinc-200 dark:hover:bg-zinc-800">
                    {d.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Components</h2>
            {componentEntries.length === 0 ? (
              <p className="text-xs text-zinc-500 px-2">None tracked. Add to <code>adhd.config.ts</code> and re-run the setup command.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {componentEntries.map(c => (
                  <li key={c.slug}>
                    <Link href={\`__ROUTE_PATH__/components/\${c.slug}\`} className="block rounded px-2 py-1 hover:bg-zinc-200 dark:hover:bg-zinc-800">
                      {c.slug}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </nav>
      </aside>

      <main className="flex-1 p-8 overflow-x-auto">
        <div className="max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
`;

// Landing page — minimal welcome + a couple of quick notes. The sidebar carries
// the actual navigation; each domain/component route has its own targeted UI
// for its own failure modes (the component page surfaces "not in static map",
// error.tsx catches runtime crashes, token pages link to Tailwind docs for
// empty domains). Nothing to repeat here.
const INDEX_PAGE_TSX = `${MARKER_COMMENT}export default function DesignSystemIndex() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-medium">Design System</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-prose">
        Pick a token domain or a component from the sidebar. Tokens are read live from your
        <code className="mx-1 rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">globals.css</code>
        <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">@theme</code> blocks. Components are statically imported from
        <code className="ml-1 rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">adhd.config.ts</code> — after editing the components map, re-run
        <code className="ml-1 rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">/adhd:setup-design-system-docs-route</code> to regenerate the static imports.
      </p>
      <p className="text-xs text-zinc-500 max-w-prose">
        Only <code>@theme {"{ ... }"}</code> and <code>@theme inline {"{ ... }"}</code> declarations are picked up — plain <code>:root</code> variables aren&apos;t.
      </p>
    </div>
  );
}
`;

// Tokens domain page — reads globals.css at request time, renders whatever's
// declared. cssEntry is baked at install time (substituted from adhd.config.ts).
// The TOKEN_DOMAINS list is imported from the shared catalog, so adding a new
// domain only requires editing one file.
const TOKENS_PAGE_TSX = `${MARKER_COMMENT}import fs from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { TOKEN_DOMAINS, type TokenDomain } from "../../tokenDomains";

${READ_CSS_SRC}

${PARSE_TOKENS_SRC}

const CSS_ENTRY = "__CSS_ENTRY__";

function EmptyState({ domain }: { domain: TokenDomain }) {
  return (
    <div className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-sm text-zinc-600 dark:text-zinc-400">
      No custom <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">{domain.varPrefix}*</code> tokens declared in your <code>@theme</code>.
      Tailwind v4 ships sensible defaults — see the <a className="underline" href={domain.tailwindDocs} target="_blank" rel="noopener noreferrer">{domain.label} docs</a>.
    </div>
  );
}

export default async function TokensDomainPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain: slug } = await params;
  const domain = TOKEN_DOMAINS.find(d => d.slug === slug);
  if (!domain) notFound();

  const css = await readCss(CSS_ENTRY);
  const tokens = parseTokens(css);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-medium">{domain.label}</h2>
        <p className="text-xs text-zinc-500 mt-1">Variables prefixed with <code>{domain.varPrefix}</code></p>
      </header>

      {slug === "colors" && (
        tokens.colors.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
            {tokens.colors.map(c => (
              <div key={c.name} className="flex flex-col gap-1">
                <div className="h-16 w-full rounded border border-zinc-200 dark:border-zinc-800" style={{ backgroundColor: c.value }} />
                <span className="text-xs">{c.name}</span>
                <span className="text-[10px] text-zinc-500 truncate" title={c.value}>{c.value}</span>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "spacing" && (
        tokens.spacing.multiplier == null ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Multiplier: <code>{tokens.spacing.multiplier}</code></p>
            <p className="text-xs text-zinc-500">Tailwind v4 derives all spacing utilities from this single variable.</p>
          </div>
        )
      )}

      {slug === "typography" && (
        tokens.typography.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-4">
            {tokens.typography.map(t => (
              <div key={t.name} className="flex items-baseline gap-4 border-b border-zinc-100 dark:border-zinc-900 pb-2">
                <span className="text-xs text-zinc-500 w-20 shrink-0">text-{t.name}</span>
                <span style={{ fontSize: t.size ?? undefined, lineHeight: t.lineHeight ?? undefined }}>
                  The quick brown fox jumps over the lazy dog
                </span>
                <span className="ml-auto text-[10px] text-zinc-500">{t.size}{t.lineHeight ? \` / \${t.lineHeight}\` : ""}</span>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "font" && (
        tokens.fonts.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-3">
            {tokens.fonts.map(f => (
              <div key={f.name} className="flex flex-col gap-1 border-b border-zinc-100 dark:border-zinc-900 pb-3">
                <span className="text-xs text-zinc-500">font-{f.name}</span>
                <span style={{ fontFamily: f.value }} className="text-xl">The quick brown fox</span>
                <span className="text-[10px] text-zinc-500 truncate" title={f.value}>{f.value}</span>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "font-weight" && (
        tokens.fontWeights.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-2">
            {tokens.fontWeights.map(w => (
              <div key={w.name} className="flex items-baseline gap-4">
                <span className="text-xs text-zinc-500 w-32 shrink-0">font-{w.name}</span>
                <span style={{ fontWeight: w.value }} className="text-lg">The quick brown fox</span>
                <span className="ml-auto text-[10px] text-zinc-500">{w.value}</span>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "tracking" && (
        tokens.tracking.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-2">
            {tokens.tracking.map(t => (
              <div key={t.name} className="flex items-baseline gap-4">
                <span className="text-xs text-zinc-500 w-32 shrink-0">tracking-{t.name}</span>
                <span style={{ letterSpacing: t.value }} className="text-lg">The quick brown fox</span>
                <span className="ml-auto text-[10px] text-zinc-500">{t.value}</span>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "leading" && (
        tokens.leading.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-3">
            {tokens.leading.map(l => (
              <div key={l.name} className="flex flex-col gap-1 border-b border-zinc-100 dark:border-zinc-900 pb-3">
                <span className="text-xs text-zinc-500">leading-{l.name} <span className="text-zinc-400">— {l.value}</span></span>
                <p style={{ lineHeight: l.value }} className="text-sm max-w-md">
                  The quick brown fox jumps over the lazy dog. The five boxing wizards jump quickly. Pack my box with five dozen liquor jugs.
                </p>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "radius" && (
        tokens.radius.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-wrap gap-4">
            {tokens.radius.map(r => (
              <div key={r.name} className="flex flex-col gap-1">
                <div className="h-16 w-16 bg-zinc-200 dark:bg-zinc-800" style={{ borderRadius: r.value }} />
                <span className="text-xs">rounded-{r.name}</span>
                <span className="text-[10px] text-zinc-500">{r.value}</span>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "shadows" && (
        tokens.shadows.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-wrap gap-8">
            {tokens.shadows.map((s, i) => (
              <div key={\`\${s.name}-\${i}\`} className="flex flex-col gap-1">
                <div className="h-20 w-20 bg-white" style={{ boxShadow: s.value }} />
                <span className="text-xs">shadow-{s.name}</span>
                <span className="text-[10px] text-zinc-500 truncate w-20" title={s.value}>{s.value}</span>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "breakpoint" && (
        tokens.breakpoints.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-1">
            {tokens.breakpoints.map(b => (
              <div key={b.name} className="flex items-baseline gap-4 text-sm">
                <span className="text-xs text-zinc-500 w-32 shrink-0">{b.name}</span>
                <code>{b.value}</code>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "ease" && (
        tokens.easings.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-1">
            {tokens.easings.map(e => (
              <div key={e.name} className="flex items-baseline gap-4 text-sm">
                <span className="text-xs text-zinc-500 w-32 shrink-0">ease-{e.name}</span>
                <code className="text-xs">{e.value}</code>
              </div>
            ))}
          </div>
        )
      )}

      {slug === "animate" && (
        tokens.animations.length === 0 ? <EmptyState domain={domain} /> : (
          <div className="flex flex-col gap-1">
            {tokens.animations.map(a => (
              <div key={a.name} className="flex items-baseline gap-4 text-sm">
                <span className="text-xs text-zinc-500 w-32 shrink-0">animate-{a.name}</span>
                <code className="text-xs">{a.value}</code>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
`;

// Component page — uses the statically generated componentMap. No fs reads of
// adhd.config.ts at request time; the rawPath comes from the map. The page
// still reads the component's source via fs to introspect prop interfaces
// (that's a one-file read per request, not a bundle).
const COMPONENT_PAGE_TSX = `${MARKER_COMMENT}import fs from "node:fs/promises";
import path from "node:path";
import { PropToggle } from "../../PropToggle";
import { getComponent } from "../../componentMap";

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
  const entry = getComponent(slug);

  if (!entry) {
    return (
      <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6">
        <h2 className="text-lg font-medium text-amber-900 dark:text-amber-200">Not in the static map</h2>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          The slug <code>{slug}</code> isn&apos;t present in the generated <code>componentMap.tsx</code>.
        </p>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          If you just edited <code>adhd.config.ts</code> to add this component, re-run <code>/adhd:setup-design-system-docs-route</code> in this project to regenerate the static imports.
        </p>
      </div>
    );
  }

  const { rawPath, Component } = entry;
  const { props } = await parseProps(rawPath);

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

  const importPath = "@/" + rawPath.replace(/\\.tsx?$/, "").replace(/\\/index$/, "");
  const importStmt = Component ? \`import \${Component.name ?? slug} from "\${importPath}";\` : null;
  const jsxSnippet = Component
    ? \`<\${Component.name ?? slug}\${Object.entries(current).map(([k,v]) => \` \${k}={\${JSON.stringify(v)}}\`).join("")} />\`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-medium">{slug}</h2>

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
        {Component ? <Component {...current} /> : (
          <p className="text-sm text-zinc-500">No renderable component exported from <code>{rawPath}</code>. The map imported it but couldn&apos;t resolve a function (default or named).</p>
        )}
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

// Error boundary for the component route. Catches runtime errors thrown during
// rendering — components that throw on mount, prop-parse failures, etc. With
// static imports there's no broad-bundle Tailwind blast radius anymore, so this
// is purely a runtime safety net.
const COMPONENT_ERROR_TSX = `${MARKER_COMMENT}"use client";

export default function ComponentPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-6">
        <h2 className="text-lg font-medium text-red-900 dark:text-red-200">Couldn&apos;t render this component</h2>
        <p className="mt-2 text-sm text-red-800 dark:text-red-300">
          Something went wrong while rendering this component. Common causes:
        </p>
        <ul className="mt-3 list-disc pl-6 text-sm text-red-800 dark:text-red-300">
          <li>The component throws on mount when no props are provided.</li>
          <li>The component expects context (theme provider, router, query client) that the docs route doesn&apos;t set up.</li>
          <li>The component&apos;s prop interface uses types the docs route can&apos;t introspect.</li>
        </ul>
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-red-700 dark:text-red-300">Show error details</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-red-100 dark:bg-red-950/50 p-2 text-red-900 dark:text-red-200">{error.message}{error.digest ? \`\\n\\nDigest: \${error.digest}\` : ""}</pre>
        </details>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded border border-red-300 dark:border-red-700 px-3 py-1 text-sm text-red-900 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/30"
        >
          Try again
        </button>
      </div>
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

module.exports = {
  MARKER_COMMENT,
  LAYOUT_TSX,
  INDEX_PAGE_TSX,
  TOKENS_PAGE_TSX,
  COMPONENT_PAGE_TSX,
  COMPONENT_ERROR_TSX,
  COMPONENT_MAP_TSX,
  TOKEN_DOMAINS_TSX,
  PROP_TOGGLE_TSX,
};
