import postcss, { type Rule, type AtRule, type Declaration, type Node } from "postcss";
import { cssVarToPath } from "./naming";
import { normalizeColor } from "./color";
import { domainOf, type Snapshot, type Token, type Mode } from "./tokens";

type Section = "theme" | "root-light" | "root-dark" | null;

/**
 * Classifies a `--custom-property` declaration by walking its ancestor chain
 * (decl.parent, decl.parent.parent, …) up to the postcss Root:
 *
 *  - any ancestor `@theme` (with or without `inline`) ⇒ "theme"
 *    (primitives/default — takes priority over anything else).
 *  - any ancestor Rule whose selector mentions `:root` ⇒ inside "root scope".
 *  - any ancestor Rule whose selector mentions `.dark` or
 *    `[data-theme="dark"]` ⇒ also inside root scope, and forces dark mode
 *    (this covers both `:root.dark { … }` and bare `.dark { … }` overrides).
 *  - any ancestor `@media (prefers-color-scheme: dark)` ⇒ forces dark mode.
 *  - root scope with no dark signal ⇒ "root-light"; with a dark signal ⇒
 *    "root-dark".
 *  - nothing matched (e.g. a `body { … }` rule) ⇒ null (ignored — it isn't a
 *    token declaration site).
 */
function classify(decl: Declaration): Section {
  let node: Node | undefined = decl.parent;
  let inRootScope = false;
  let dark = false;

  while (node && node.type !== "root") {
    if (node.type === "atrule") {
      const at = node as AtRule;
      if (at.name === "theme") return "theme";
      if (at.name === "media" && /prefers-color-scheme:\s*dark/.test(at.params)) dark = true;
    } else if (node.type === "rule") {
      const rule = node as Rule;
      if (/:root\b/.test(rule.selector)) inRootScope = true;
      if (/\.dark(?![\w-])/.test(rule.selector) || /\[data-theme=["']?dark["']?\]/.test(rule.selector)) {
        inRootScope = true;
        dark = true;
      }
    }
    node = node.parent;
  }

  if (!inRootScope) return null;
  return dark ? "root-dark" : "root-light";
}

export function parseCssSnapshot(css: string): Snapshot {
  const root = postcss.parse(css);
  const tokens = new Map<string, Token>();

  const put = (name: string, rawValue: string, collection: Token["collection"], mode: Mode) => {
    const path = cssVarToPath(name);
    const key = `${collection}:${path ?? name}`;
    const value = rawValue.trim();

    const t: Token = tokens.get(key) ?? {
      path: path ?? name,
      collection,
      domain: path ? domainOf(path) : "other",
      values: {},
    };

    if (path === null) {
      // Outside the validated naming grammar (uppercase segment, empty
      // segment, non-hyphenated companion part, …). Never drop the
      // declaration silently — record it as an unsyncable stand-in token
      // keyed by its raw name so the report can surface it.
      t.values[mode] = value;
      t.unsyncable = `css variable name '${name}' is outside the token naming grammar`;
      tokens.set(key, t);
      return;
    }

    const aliasMatch = value.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/);
    if (aliasMatch) {
      // Aliases are never flattened: record the direct reference target,
      // even if that target is itself an alias. Real semantic tokens can
      // alias a DIFFERENT primitive per mode (e.g. --brand-surface ->
      // gold-100 in light, gold-900 in dark), so the target is stored per
      // mode rather than as a single last-write-wins string.
      const target = cssVarToPath(aliasMatch[1]!);
      if (target) {
        t.aliasOf = { ...t.aliasOf, [mode]: target };
      } else {
        t.unsyncable = "alias target '" + aliasMatch[1] + "' is outside the token naming grammar";
      }
      t.values[mode] = value;
    } else if (t.domain === "color") {
      const hex = normalizeColor(value);
      if (hex) {
        t.values[mode] = hex;
      } else {
        // Covers oklch(from …) relative syntax, gradients, and any other
        // color-domain value culori can't resolve to a concrete color.
        t.values[mode] = value;
        t.unsyncable = `unparseable color value: ${value}`;
      }
    } else {
      // Domain classification is path-based (domainOf), so bare semantic
      // names like --background/--foreground land in "other" even though
      // their values are colors. Normalize them too when they resolve, so
      // the code-side snapshot is canonical regardless of domain.
      const hex = normalizeColor(value);
      t.values[mode] = hex ?? value;
    }
    tokens.set(key, t);
  };

  root.walkDecls((decl: Declaration) => {
    if (!decl.prop.startsWith("--")) return;
    const section = classify(decl);
    if (section === "theme") put(decl.prop, decl.value, "primitives", "default");
    else if (section === "root-light") put(decl.prop, decl.value, "semantic", "light");
    else if (section === "root-dark") put(decl.prop, decl.value, "semantic", "dark");
  });

  return { side: "code", tokens: [...tokens.values()], styles: [] };
}
