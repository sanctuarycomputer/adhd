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
                <span className="text-[10px] text-zinc-500">{t.size}{t.lineHeight ? \` / \${t.lineHeight}\` : ""}</span>
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
        {cfg.components.length === 0 ? <p className="text-sm text-zinc-500">No components tracked yet.</p> : (
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
