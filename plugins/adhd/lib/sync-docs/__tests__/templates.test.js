'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MARKER_COMMENT,
  LAYOUT_TSX,
  INDEX_PAGE_TSX,
  TOKENS_PAGE_TSX,
  COMPONENT_PAGE_TSX,
  COMPONENT_ERROR_TSX,
  COMPONENT_MAP_TSX,
  TOKEN_DOMAINS_TSX,
  PROP_TOGGLE_TSX,
} = require('../templates');

test('MARKER_COMMENT is a stable, non-ADHD-referencing string', () => {
  assert.match(MARKER_COMMENT, /design-system-docs-route/);
  assert.match(MARKER_COMMENT, /auto-generated installer artifact; safe to edit/);
  assert.equal(/adhd/i.test(MARKER_COMMENT), false, 'must not reference ADHD');
});

test('LAYOUT_TSX starts with the marker comment', () => {
  assert.ok(LAYOUT_TSX.startsWith(MARKER_COMMENT));
});

test('LAYOUT_TSX sets robots: noindex / nofollow', () => {
  assert.match(LAYOUT_TSX, /robots:\s*\{[^}]*index:\s*false[^}]*follow:\s*false/);
});

test('LAYOUT_TSX imports the TOKEN_DOMAINS catalog from the shared tokenDomains module', () => {
  // Single source of truth lives in tokenDomains.tsx; the layout just imports it
  // and iterates. Inlining the labels here would duplicate the catalog (the
  // duplication the rewrite was meant to remove).
  assert.match(LAYOUT_TSX, /import \{ TOKEN_DOMAINS \} from "\.\/tokenDomains"/);
});

test('TOKEN_DOMAINS_TSX exports the full Tailwind v4 token-domain catalog', () => {
  // The catalog is THE source of truth — every token domain rendered by the
  // tokens page must be listed here with its varPrefix and Tailwind docs link.
  for (const label of [
    'Colors', 'Spacing', 'Typography', 'Font Families', 'Font Weights',
    'Tracking', 'Leading', 'Radius', 'Shadows', 'Breakpoints', 'Easing', 'Animation',
  ]) {
    assert.match(TOKEN_DOMAINS_TSX, new RegExp(`label: "${label}"`), `missing domain label: ${label}`);
  }
  // Shape: each entry has slug + label + varPrefix + tailwindDocs.
  assert.match(TOKEN_DOMAINS_TSX, /slug:\s*"colors".*varPrefix:\s*"--color-".*tailwindDocs:/s);
  assert.match(TOKEN_DOMAINS_TSX, /export const TOKEN_DOMAINS:/);
  assert.match(TOKEN_DOMAINS_TSX, /export type TokenDomain/);
});

test('LAYOUT_TSX imports componentEntries from componentMap (no runtime config read)', () => {
  // Static architecture: the layout doesn't read adhd.config.ts at request time.
  // Instead, the installer generates componentMap.tsx with the components baked in,
  // and the layout imports componentEntries from it.
  assert.match(LAYOUT_TSX, /from "\.\/componentMap"/);
  assert.match(LAYOUT_TSX, /componentEntries/);
  // No fs/path imports — the layout is a pure render now
  assert.doesNotMatch(LAYOUT_TSX, /from "node:fs|from "node:path|readConfig\(/);
});

test('LAYOUT_TSX is a sync (non-async) server component now', () => {
  // No fs reads anywhere in the layout; it's a pure render.
  assert.doesNotMatch(LAYOUT_TSX, /export default async function/);
  assert.match(LAYOUT_TSX, /export default function DesignSystemDocsLayout/);
});

test('LAYOUT_TSX has no diagnostic banner (removed with the dynamic-import architecture)', () => {
  // The DiagnosticBanner existed to flag missing tokens that surfaced under the
  // broad dynamic import. Static imports eliminate that failure mode entirely.
  assert.doesNotMatch(LAYOUT_TSX, /DiagnosticBanner|detectIssues|ring-offset-background/);
});

test('INDEX_PAGE_TSX is a landing page describing the static-import flow', () => {
  assert.match(INDEX_PAGE_TSX, /Design System/);
  assert.match(INDEX_PAGE_TSX, /statically imported/);
  assert.match(INDEX_PAGE_TSX, /re-run/);
});

test('INDEX_PAGE_TSX has no Troubleshooting section (each route handles its own failure modes)', () => {
  // The component page surfaces "not in static map" itself; error.tsx catches
  // runtime crashes; token pages link to Tailwind docs for empty domains.
  // The landing page just orients the user — no duplicated troubleshooting copy.
  assert.doesNotMatch(INDEX_PAGE_TSX, /Troubleshooting/);
  assert.doesNotMatch(INDEX_PAGE_TSX, /app-build-manifest|broad dynamic/i);
  // It still mentions the re-run command so the user knows how to refresh the map.
  assert.match(INDEX_PAGE_TSX, /\/adhd:sync-docs/);
});

test('TOKENS_PAGE_TSX reads globals.css from a baked CSS_ENTRY constant', () => {
  assert.match(TOKENS_PAGE_TSX, /const CSS_ENTRY = "__CSS_ENTRY__"/);
  assert.match(TOKENS_PAGE_TSX, /parseTokens/);
  // Tokens page no longer reads adhd.config.ts at request time
  assert.doesNotMatch(TOKENS_PAGE_TSX, /readConfig|adhd\.config\.ts/);
});

test('TOKENS_PAGE_TSX imports TOKEN_DOMAINS from the shared catalog (no inlined list)', () => {
  assert.match(TOKENS_PAGE_TSX, /import \{ TOKEN_DOMAINS, type TokenDomain \} from "\.\.\/\.\.\/tokenDomains"/);
  // The inline `const TOKEN_DOMAINS = [...]` block from earlier versions is gone.
  assert.doesNotMatch(TOKENS_PAGE_TSX, /const TOKEN_DOMAINS = \[/);
});

test('COMPONENT_PAGE_TSX uses getComponent from the static componentMap (no dynamic import)', () => {
  assert.match(COMPONENT_PAGE_TSX, /import \{ getComponent \} from "\.\.\/\.\.\/componentMap"/);
  // No template-literal dynamic import
  assert.doesNotMatch(COMPONENT_PAGE_TSX, /await\s+import\(`/);
});

test('COMPONENT_PAGE_TSX reads searchParams for prop toggles', () => {
  assert.match(COMPONENT_PAGE_TSX, /searchParams/);
});

test('COMPONENT_PAGE_TSX shows a "Not in the static map" branch for unknown slugs', () => {
  // Replaces notFound() with an actionable message about re-running setup.
  assert.match(COMPONENT_PAGE_TSX, /Not in the static map/);
  assert.match(COMPONENT_PAGE_TSX, /re-run.*\/adhd:sync-docs/i);
});

test('COMPONENT_MAP_TSX has the substitution placeholders the installer needs', () => {
  // The template is a per-install-generated file. These placeholders are
  // filled in by route-installer.js's renderComponentMap.
  assert.match(COMPONENT_MAP_TSX, /__COMPONENT_IMPORTS__/);
  assert.match(COMPONENT_MAP_TSX, /__COMPONENT_ENTRIES__/);
  assert.match(COMPONENT_MAP_TSX, /export function getComponent/);
  assert.match(COMPONENT_MAP_TSX, /export const componentEntries/);
});

test('COMPONENT_MAP_TSX resolves a renderable function via default-then-named fallback', () => {
  // Mirrors the runtime behavior of the previous dynamic-import resolution:
  // prefer default export, fall back to first named function. This keeps
  // existing user components working without changes.
  assert.match(COMPONENT_MAP_TSX, /function resolveComponent/);
  assert.match(COMPONENT_MAP_TSX, /mod\.default/);
});

test('PROP_TOGGLE_TSX is a client component', () => {
  const afterMarker = PROP_TOGGLE_TSX.replace(MARKER_COMMENT, '');
  assert.match(afterMarker, /^["']use client["']/);
});

test('PROP_TOGGLE_TSX uses router.replace for snappy URL updates', () => {
  assert.match(PROP_TOGGLE_TSX, /router\.replace/);
});

test('COMPONENT_ERROR_TSX is a client component error boundary', () => {
  const afterMarker = COMPONENT_ERROR_TSX.replace(MARKER_COMMENT, '');
  assert.match(afterMarker, /^["']use client["']/);
  assert.match(COMPONENT_ERROR_TSX, /error.*reset/);
  assert.match(COMPONENT_ERROR_TSX, /reset\(\)/);
});

test('COMPONENT_ERROR_TSX no longer has the build-manifest-specific copy', () => {
  // With static imports, the build-manifest ENOENT failure mode is gone, so
  // the error boundary no longer needs to special-case it.
  assert.doesNotMatch(COMPONENT_ERROR_TSX, /app-build-manifest|isBuildManifestError/);
});

test('none of the templates contain "ADHD" outside the marker', () => {
  // Two filename-style exceptions are allowed (they're how the user actually
  // interacts with the tool, and ejecting from ADHD doesn't break the file —
  // it just means those references become vestigial guidance the user can edit):
  //   1. `adhd.config.ts` — the consumer's own config artifact.
  //   2. `/adhd:sync-docs` — the slash command name,
  //      referenced in troubleshooting copy so the user knows what to re-run.
  const all = { LAYOUT_TSX, INDEX_PAGE_TSX, TOKENS_PAGE_TSX, COMPONENT_PAGE_TSX, COMPONENT_ERROR_TSX, COMPONENT_MAP_TSX, PROP_TOGGLE_TSX };
  for (const [name, content] of Object.entries(all)) {
    const body = content
      .replace(MARKER_COMMENT, '')
      .replace(/adhd\.config\.ts/g, '')
      .replace(/\/adhd:sync-docs/g, '');
    assert.equal(/adhd/i.test(body), false, `${name} must not reference ADHD outside marker / allowed exceptions`);
  }
});
