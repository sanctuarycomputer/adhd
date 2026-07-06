import { parse, converter, toGamut, formatHex, formatHex8 } from "culori";

export type Rgba = { r: number; g: number; b: number; a: number };

const toRgb = converter("rgb");
const gamutMap = toGamut("rgb", "oklch"); // CSS4 gamut mapping in oklch space

export function parseColor(input: string): Rgba | null {
  if (typeof input !== "string") return null;
  const parsed = parse(input.trim());
  if (!parsed) return null;
  const rgb = parsed.mode === "rgb" ? parsed : gamutMap(parsed);
  const c = toRgb(rgb);
  if (!c || [c.r, c.g, c.b].some((v) => typeof v !== "number" || Number.isNaN(v))) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { r: clamp(c.r), g: clamp(c.g), b: clamp(c.b), a: c.alpha ?? 1 };
}

export function rgbaToHex(c: Rgba): string {
  const color = { mode: "rgb" as const, r: c.r, g: c.g, b: c.b, alpha: c.a };
  return c.a >= 1 ? formatHex(color) : formatHex8(color);
}

export function normalizeColor(input: string): string | null {
  const c = parseColor(input);
  return c ? rgbaToHex(c) : null;
}

export function colorsEqual(a: string | Rgba, b: string | Rgba, epsilon = 0.004): boolean {
  const ca = typeof a === "string" ? parseColor(a) : a;
  const cb = typeof b === "string" ? parseColor(b) : b;
  if (!ca || !cb) return false;
  return (
    Math.abs(ca.r - cb.r) <= epsilon && Math.abs(ca.g - cb.g) <= epsilon &&
    Math.abs(ca.b - cb.b) <= epsilon && Math.abs(ca.a - cb.a) <= epsilon
  );
}
