export type NamingConvention = "kebab-case" | "PascalCase" | "camelCase" | false;

export function cssVarToPath(cssVar: string): string {
  if (!cssVar.startsWith("--")) throw new Error(`Not a CSS variable name: ${cssVar}`);
  let withoutPrefix = cssVar.slice(2).toLowerCase();

  // Handle double hyphens: split base part, keep companion parts intact
  // e.g., --text-lg--line-height → text/lg/line-height (companion preserved as-is)
  if (withoutPrefix.includes("--")) {
    const [base, ...companions] = withoutPrefix.split("--");
    const baseParts = base.split(/-+/).filter(Boolean);
    return [...baseParts, ...companions].join("/");
  }

  return withoutPrefix.split(/-+/).filter(Boolean).join("/");
}

export function pathToCssVar(path: string): string {
  return "--" + path.toLowerCase().split("/").filter(Boolean).join("-");
}

export function caseMatches(name: string, convention: NamingConvention): boolean {
  if (convention === false) return true;
  if (convention === "kebab-case") return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
  if (convention === "PascalCase") return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  if (convention === "camelCase") return /^[a-z][a-zA-Z0-9]*$/.test(name);
  return true;
}
