export type Domain = "color" | "spacing" | "radius" | "shadow" | "typography" | "other";
export type Mode = "default" | "light" | "dark";

export interface Token {
  path: string;                       // "color/zinc/800" — collection NOT included
  collection: "primitives" | "semantic";
  domain: Domain;
  values: Partial<Record<Mode, string>>; // canonical strings; colors normalized to hex by producers
  aliasOf?: Partial<Record<Mode, string>>; // alias target path per mode (targets can differ by mode)
  unsyncable?: string;                // reason string ⇒ goes to the report's cannot-sync section
}

export interface StyleShell {
  kind: "text" | "effect";
  name: string;
  boundPrimitives: string[];
  unsyncable?: string;
}

export interface Snapshot {
  side: "code" | "figma";
  tokens: Token[];
  styles: StyleShell[];
}

export function domainOf(path: string): Domain {
  const head = path.split("/")[0];
  if (head === "color" || head === "spacing" || head === "radius" || head === "shadow") return head;
  if (head === "text" || head === "typography" || head === "font" || head === "leading" || head === "tracking") return "typography";
  return "other";
}
