# Avatar + AvatarGroup — Design Spec

**Date:** 2026-05-09
**Status:** Approved for implementation planning

## Purpose

A "blue-chip" example component for this repo: a stock-standard Avatar plus AvatarGroup that demonstrates how to mix Tailwind v4 utilities with a small number of hard-coded pixel values where the design tokens don't map cleanly. Serves as a reference pattern for future components in the codebase.

## File Layout

```
app/components/avatar/index.tsx        # Avatar (standalone)
app/components/avatar-group/index.tsx  # AvatarGroup
```

Each component lives in its own folder with the implementation in `index.tsx`. The two components are siblings — Avatar has no awareness of AvatarGroup. AvatarGroup depends on Avatar's public API only (size prop + the rendered root element).

## Public API

```tsx
type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
type AvatarShape = "circle" | "square";
type AvatarStatus = "online" | "away" | "offline";

interface AvatarProps {
  name: string;                  // required — used for alt text + initials
  src?: string;                  // optional image URL
  size?: AvatarSize;             // default "md"
  shape?: AvatarShape;           // default "circle"
  status?: AvatarStatus;
  className?: string;            // for callers that need overrides
}

interface AvatarGroupProps {
  children: React.ReactNode;     // expected to be <Avatar> elements
  size?: AvatarSize;             // default "md", overrides each child's size
  max?: number;                  // truncate after N, render +N tile
  className?: string;
}
```

## Behavior

### Avatar
- If `src` is set, render Next.js `<Image>` with `alt={name}`.
- If `src` is missing or fails to load, render initials derived from `name` (first letter of each of the first two words, uppercased; e.g. "Hugh Francis" → "HF", "Ada" → "A").
- Background color for the initials state is a deterministic shade picked from a small zinc palette by hashing `name` — same name always yields same color.
- Status dot, when set, is absolutely positioned bottom-right with `ring-2 ring-white dark:ring-zinc-950` so it punches off the avatar edge. The Avatar root itself has no ring (the AvatarGroup adds the separating ring when used in a group).

### AvatarGroup
- Renders children in a horizontal flex row with negative spacing so avatars overlap.
- Injects `size` onto each `<Avatar>` child via `React.cloneElement` so the whole group stays visually consistent.
- Applies a separating ring to each direct child via a Tailwind descendant selector (`[&>*]:ring-2 [&>*]:ring-white dark:[&>*]:ring-zinc-950`) so adjacent avatars read as distinct.
- If `max` is set and `children.length > max`, slices to `max` and appends a `+N` overflow tile that visually matches an Avatar (same box, shape, ring, background `bg-zinc-200 dark:bg-zinc-800`).

## Sizing & Tokens

The size scale uses Tailwind's standard scale where it lines up cleanly, and arbitrary pixel values where it doesn't. This is intentional — the component is meant to demonstrate that mix.

| size | box (Tailwind)  | text          | status dot (arbitrary) | overlap (arbitrary) |
|------|-----------------|---------------|-----------------------|---------------------|
| xs   | `h-6 w-6` (24)  | `text-[10px]` | `h-[6px] w-[6px]`     | `-space-x-1`        |
| sm   | `h-8 w-8` (32)  | `text-xs`     | `h-[8px] w-[8px]`     | `-space-x-1`        |
| md   | `h-10 w-10` (40)| `text-sm`     | `h-[10px] w-[10px]`   | `-space-x-2`        |
| lg   | `h-12 w-12` (48)| `text-base`   | `h-[12px] w-[12px]`   | `-space-x-2`        |
| xl   | `h-16 w-16` (64)| `text-lg`     | `h-[14px] w-[14px]`   | `-space-x-3`        |

**Shape:**
- `circle` → `rounded-full`
- `square` → `rounded-md` for xs/sm, `rounded-lg` for md/lg/xl (corner radius scales with box)

**Status colors:**
- `online` → `bg-emerald-500`
- `away` → `bg-amber-500`
- `offline` → `bg-zinc-400`

**Initials font sizing:** `text-[10px]` at xs is the only arbitrary text value; the rest map to Tailwind tokens.

## Implementation Notes

- Size/shape/status mappings live in small lookup objects keyed by the variant name. Keep them at module scope, not inside the component, so they're not re-allocated per render.
- Use `next/image` for the image case. Pass `width`/`height` matching the size in pixels. The component sets `h-* w-*` and `object-cover` via class so layout is driven by Tailwind, not the image's intrinsic size. **Note:** remote `src` URLs require entries in `next.config.ts` `images.remotePatterns`. The component should not handle this — caller's responsibility — but mention it in the implementation plan so the demo example uses a local asset or an already-configured host.
- Initials background palette: a fixed array of ~6 zinc/slate-adjacent shades (e.g. `bg-zinc-200`, `bg-stone-200`, `bg-neutral-300`, etc.). Hash `name` by summing char codes mod palette length.
- For `cloneElement` in AvatarGroup, type-narrow with `React.isValidElement` and a check that the child's `type === Avatar`. Skip cloning for anything else (defensive; not strictly required for v1).
- Dark mode: every surface-dependent class needs a `dark:` companion (status ring, overflow tile bg, initials bg).

## Dark Mode

Already supported by the project (`globals.css` and existing pages use `dark:`). Every color/surface class gets a `dark:` variant. The status-dot ring and overflow tile bg are the main affected surfaces.

## Out of Scope (YAGNI)

- Icon fallback (only image + initials)
- Custom status colors or labels
- Click handlers / interactive avatars
- Tooltips on hover
- Per-pixel scaling of the corner radius for `square`
- Animated overflow expansion
- Showcase / demo route (component-only ship per user direction)
- Tests (no test infra in the repo yet; revisit when one lands)

## Acceptance Criteria

1. `import { Avatar } from "@/app/components/avatar"` and `import { AvatarGroup } from "@/app/components/avatar-group"` both work.
2. Avatar renders an image when `src` is provided, initials otherwise, with deterministic background color per `name`.
3. All five sizes render at the documented pixel boxes; status dot scales with size and is correctly positioned with a 2px ring.
4. Both shapes render with the expected corner radius per size.
5. AvatarGroup overlaps its children, applies separating rings, and renders a `+N` tile when `children.length > max`.
6. AvatarGroup's `size` prop overrides each child's size so the group is visually consistent.
7. Dark mode looks correct for all variants.
8. `npm run lint` and `npm run build` both pass.
