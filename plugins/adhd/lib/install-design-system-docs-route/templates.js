'use strict';

const MARKER_COMMENT = `// design-system-docs-route — auto-generated installer artifact; safe to edit.
// Remove this comment to disable future overwrites from re-running the installer.
`;

// The list of token domains is shared verbatim between the sidebar (layout) and
// the token page (so the page can look up the right renderer by slug). Both
// copies use the same source string here, embedded into the templates below.
// The `tailwindDocs` field is the URL to Tailwind v4's relevant theme section,
// used in empty-state messaging.
const TOKEN_DOMAINS_SRC = `const TOKEN_DOMAINS = [
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
];`;

// The CSS @theme parser shared between landing/tokens pages. Kept inline (not
// imported from the lib) because these are runtime server components in the
// consumer's app, with no access to ADHD's node_modules. Mirrors token-parser.js
// but flattened for inline use.
//   - Brace-counted scan supports `@theme { ... }` AND `@theme inline { ... }`
//   - Prefix order matters: longer prefixes (`font-weight-`) before shorter (`font-`).
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
  // Order matters: longer prefixes first.
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

const READ_CONFIG_SRC = `async function readConfig() {
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
    const cssEntryMatch = /cssEntry\\s*:\\s*"([^"]+)"/.exec(src);
    const cssEntry = cssEntryMatch ? cssEntryMatch[1] : "app/globals.css";
    return { components, cssEntry };
  } catch {
    return { components: [] as string[], cssEntry: "app/globals.css" };
  }
}

function slugFor(p: string) {
  return p.replace(/\\.tsx?$/, "").replace(/\\/index$/, "").split("/").pop()?.toLowerCase() ?? p;
}`;

// Shared globals.css reader. Returns the file contents or null if missing.
const READ_CSS_SRC = `async function readCss(cssEntry: string) {
  try { return await fs.readFile(path.resolve(process.cwd(), cssEntry), "utf8"); }
  catch { return null; }
}`;

// Diagnostic banner detection: scans the consumer's @theme block for token-name
// shibboleths that indicate a shadcn-style v3-to-v4 migration, and flags common
// tokens that are missing. The dynamic-import pattern used by the component page
// pulls in more files than the consumer's normal routes do, which surfaces stale
// `@apply` directives in transitively-bundled CSS — these missing tokens are the
// usual cause.
const DETECT_ISSUES_SRC = `type DetectedIssue = {
  token: string;
  why: string;
  themeLine: string;
  rootLine?: string;
};

function detectIssues(css: string | null): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  if (!css) return issues;
  // Extract bodies of every @theme block (supports \`@theme inline\` modifier).
  const bodies: string[] = [];
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf("@theme", i);
    if (idx === -1) break;
    let j = idx + "@theme".length;
    while (j < css.length && css[j] !== "{" && css[j] !== ";") j++;
    if (css[j] !== "{") { i = j + 1; continue; }
    let depth = 1, k = j + 1;
    while (k < css.length && depth > 0) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") depth--;
      if (depth > 0) k++;
    }
    bodies.push(css.slice(j + 1, k));
    i = k + 1;
  }
  const themeText = bodies.join("\\n");
  const has = (token: string) => new RegExp("(?:^|\\\\s)" + token.replace(/[-]/g, "\\\\-") + "\\\\s*:").test(themeText);

  // Shadcn shibboleth: foreground+background plus at least one *-foreground pair.
  const looksShadcn = has("--color-foreground") && has("--color-background") &&
    (has("--color-card-foreground") || has("--color-popover-foreground"));

  if (looksShadcn && !has("--color-ring-offset-background")) {
    issues.push({
      token: "--color-ring-offset-background",
      why: "Shadcn components use \`ring-offset-background\` for focus styles. Without this in @theme, any \`@apply ring-offset-background\` in transitively-bundled CSS (from a UI library or stale components in your project) will fail with \\"Cannot apply unknown utility class ring-offset-background\\" during route compilation, and the component page will 500 with an ENOENT on the build manifest.",
      themeLine: "--color-ring-offset-background: hsl(var(--ring-offset-background));",
      rootLine: "--ring-offset-background: 0 0% 100%;",
    });
  }

  return issues;
}`;

// Layout: sidebar lists token domains + components; main area renders children.
// The layout is async so it can read adhd.config.ts and globals.css for diagnostics.
const LAYOUT_TSX = `${MARKER_COMMENT}import type { Metadata } from "next";
import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Design System Docs",
  robots: { index: false, follow: false },
};

${TOKEN_DOMAINS_SRC}

${READ_CONFIG_SRC}

${READ_CSS_SRC}

${DETECT_ISSUES_SRC}

function DiagnosticBanner({ issues }: { issues: DetectedIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <aside className="mb-6 rounded-md border border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4">
      <h3 className="text-sm font-medium text-amber-900 dark:text-amber-200">
        Heads up — likely globals.css gaps
      </h3>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 max-w-prose">
        Component pages use a broad dynamic import which causes Tailwind v4 to scan more of your codebase than your other routes do. Your <code>@theme</code> block looks like a shadcn migration but is missing tokens that often appear in transitively-bundled CSS. If you see <code>ENOENT</code> on <code>app-build-manifest.json</code> when navigating to a component, add these:
      </p>
      <ul className="mt-3 flex flex-col gap-3 text-xs">
        {issues.map(i => (
          <li key={i.token} className="rounded bg-amber-100 dark:bg-amber-950/50 p-3">
            <code className="font-medium text-amber-900 dark:text-amber-200">{i.token}</code>
            <p className="mt-1 text-amber-800 dark:text-amber-300">{i.why}</p>
            <pre className="mt-2 overflow-x-auto rounded bg-amber-200/60 dark:bg-amber-900/40 p-2 text-[11px] text-amber-900 dark:text-amber-100">{\`/* in @theme */\\n\${i.themeLine}\${i.rootLine ? \`\\n\\n/* in :root */\\n\${i.rootLine}\` : ""}\`}</pre>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default async function DesignSystemDocsLayout({ children }: { children: React.ReactNode }) {
  const cfg = await readConfig();
  const css = await readCss(cfg.cssEntry);
  const issues = detectIssues(css);
  const components = cfg.components.map(p => ({ raw: p, slug: slugFor(p) }));

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
            {components.length === 0 ? (
              <p className="text-xs text-zinc-500 px-2">None tracked yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {components.map(c => (
                  <li key={c.raw}>
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
        <div className="max-w-5xl">
          <DiagnosticBanner issues={issues} />
          {children}
        </div>
      </main>
    </div>
  );
}
`;

// Landing page — welcome + troubleshooting. The sidebar already shows tokens/components,
// so the body focuses on what the layout's diagnostic banner can't pre-emptively flag.
const INDEX_PAGE_TSX = `${MARKER_COMMENT}export default function DesignSystemIndex() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="text-2xl font-medium">Design System</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-prose">
          Pick a token domain or a component from the sidebar. Tokens are read from your
          <code className="mx-1 rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">globals.css</code>
          <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">@theme</code> blocks.
          Components are loaded from
          <code className="ml-1 rounded bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 text-xs">adhd.config.ts</code>.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Troubleshooting</h3>
        <div className="flex flex-col gap-4 text-sm text-zinc-700 dark:text-zinc-300 max-w-prose">
          <details className="rounded border border-zinc-200 dark:border-zinc-800 p-4">
            <summary className="cursor-pointer font-medium">Component page 500s with <code>ENOENT: ... app-build-manifest.json</code></summary>
            <div className="mt-3 flex flex-col gap-3">
              <p>
                The component page uses a broad dynamic import keyed off <code>adhd.config.ts</code>, so adding components is just a config edit. The trade-off: Webpack/Turbopack can&apos;t statically resolve the path, so it creates a context module that pulls every file under <code>@/</code> into this route&apos;s bundle, and Tailwind v4 then scans all of them for classes.
              </p>
              <p>
                Your other routes only bundle what they statically import, so latent issues never surface there. On <em>this</em> route, Tailwind hits classes referenced in transitively-bundled CSS (often a UI lib like shadcn or <code>@reactor-team/ui</code>) that your <code>@theme</code> doesn&apos;t define yet. Tailwind throws, the CSS chunk never emits, and the manifest write fails — hence ENOENT.
              </p>
              <p className="font-medium">Fix:</p>
              <ol className="list-decimal pl-5 flex flex-col gap-1">
                <li>Run <code>npm run dev</code> in a terminal and watch the output when you navigate to <code>/components/&lt;X&gt;</code>.</li>
                <li>Look for <code>Cannot apply unknown utility class &lt;name&gt;</code> or <code>Cannot use @variant with unknown variant: &lt;name&gt;</code>.</li>
                <li>For utility class names, add <code>--color-&lt;name&gt;</code> (or appropriate prefix) to your <code>@theme</code> block.</li>
                <li>For variant names, add <code>--breakpoint-&lt;name&gt;</code> to your <code>@theme</code> block.</li>
              </ol>
              <p className="text-xs text-zinc-500">If the layout&apos;s diagnostic banner is showing above this content, it has detected a likely candidate already.</p>
            </div>
          </details>

          <details className="rounded border border-zinc-200 dark:border-zinc-800 p-4">
            <summary className="cursor-pointer font-medium">Sidebar shows the component but the page fails to load it</summary>
            <p className="mt-3">
              Check the path in <code>adhd.config.ts</code> resolves from your project root, and that the file exports a function (default export or a named function). If the dynamic import fails at runtime (not at compile), the error boundary at <code>components/[component]/error.tsx</code> will catch it and show the message.
            </p>
          </details>

          <details className="rounded border border-zinc-200 dark:border-zinc-800 p-4">
            <summary className="cursor-pointer font-medium">Token domain shows &ldquo;no custom tokens&rdquo; but you have some</summary>
            <p className="mt-3">
              The parser supports <code>@theme {"{ ... }"}</code> and <code>@theme inline {"{ ... }"}</code>. If your tokens are in a different syntax (e.g. <code>:root</code>), they won&apos;t be picked up — Tailwind v4 only treats <code>@theme</code> declarations as design tokens.
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}
`;

// Tokens domain page — one route, one renderer per domain. Reads the consumer's
// globals.css at request time and renders whatever's declared. Empty states
// reference Tailwind v4's defaults rather than implying the system is broken.
const TOKENS_PAGE_TSX = `${MARKER_COMMENT}import fs from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";

${TOKEN_DOMAINS_SRC}

${READ_CONFIG_SRC}

${READ_CSS_SRC}

${PARSE_TOKENS_SRC}

function EmptyState({ domain }: { domain: typeof TOKEN_DOMAINS[number] }) {
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

  const cfg = await readConfig();
  const css = await readCss(cfg.cssEntry);
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

// Component page — moved to /components/[component]. Two levels deep, so the
// PropToggle import is now `../../PropToggle`.
const COMPONENT_PAGE_TSX = `${MARKER_COMMENT}import fs from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { PropToggle } from "../../PropToggle";

${READ_CONFIG_SRC}

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
  const cfg = await readConfig();
  const componentPath = cfg.components.find(p => slugFor(p) === slug);
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

// Error boundary for the component route. Catches RUNTIME errors thrown during
// rendering — broken dynamic imports, components that throw on mount, prop-parse
// failures. Does NOT catch bundler-level Tailwind/PostCSS failures (those happen
// before React runs); the layout's diagnostic banner handles that case.
const COMPONENT_ERROR_TSX = `${MARKER_COMMENT}"use client";

export default function ComponentPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isBuildManifestError = /app-build-manifest\\.json/.test(error.message ?? "");
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-6">
        <h2 className="text-lg font-medium text-red-900 dark:text-red-200">Couldn't render this component</h2>
        <p className="mt-2 text-sm text-red-800 dark:text-red-300">
          {isBuildManifestError
            ? "Next.js failed to load this route's build manifest. This usually means Tailwind v4 couldn't compile CSS for the route — see the diagnostic banner above (or the Troubleshooting section on the docs landing page) for the likely cause."
            : "Something went wrong while loading or rendering this component. Common causes:"}
        </p>
        {!isBuildManifestError && (
          <ul className="mt-3 list-disc pl-6 text-sm text-red-800 dark:text-red-300">
            <li>The path in <code>adhd.config.ts</code> doesn't resolve from the project root.</li>
            <li>The component throws on mount when no props are provided.</li>
            <li>The component's prop interface uses types the docs route can't introspect.</li>
          </ul>
        )}
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
  PROP_TOGGLE_TSX,
};
