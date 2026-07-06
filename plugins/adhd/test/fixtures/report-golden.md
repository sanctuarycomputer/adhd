# ADHD lint report
**Target:** Design System / Card ([open in Figma](https://figma.com/design/abc?node-id=0-1))
**Mode:** live
**Result:** 5 errors, 6 warnings

## Structure

### STRUCT001 — error (2)
- Frame has children but auto-layout is not enabled.
  Page 1 > Card — [open](https://figma.com/design/abc?node-id=1-1)
- Frame has children but auto-layout is not enabled.
  Page 1 > Card > Icon Frame — [open](https://figma.com/design/abc?node-id=1-2)

### STRUCT008 — warning (1)
- Layer is auto-named ("Frame 42"); rename for clarity.
  Page 1 > Frame 42 — [open](https://figma.com/design/abc?node-id=1-3)

## Drift

### Value drift (1)
- `color/zinc/800` [primitives] (default): code `#27272a` vs figma `#3f3f46`

### Existence (1)
- `color/brand/teal` [primitives] only in figma — default: #0f766e

### Structural (1)
- `background` (light) alias-vs-literal: code `color/zinc/50` vs figma `#fafafa`

## Likely renames
- `color/brand/gold` → `color/brand/golden` (definite)
- `color/brand/sky` → `color/brand/skyblue` (probable)

## Off-system values in code
- app/Card.tsx:12 `bg-[#27272a]` → use `color/zinc/800`
- app/Card.tsx:20 `#27272b` → close to `color/zinc/800`

## Cannot sync
- `color/legacy/mystery` (figma): unresolvable alias chain

> No adhd.lock.json — drift is two-way (cannot attribute changes to a side); renames are heuristic.