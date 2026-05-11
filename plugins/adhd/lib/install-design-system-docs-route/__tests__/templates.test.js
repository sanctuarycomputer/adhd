'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKER_COMMENT, LAYOUT_TSX, INDEX_PAGE_TSX, TOKENS_PAGE_TSX, COMPONENT_PAGE_TSX, COMPONENT_ERROR_TSX, PROP_TOGGLE_TSX } = require('../templates');

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

test('LAYOUT_TSX has no ADHD references outside marker', () => {
  // marker excluded — the filename `adhd.config.ts` is the spec-allowed exception
  // (the layout reads it to populate the Components sidebar list).
  const body = LAYOUT_TSX.replace(MARKER_COMMENT, '').replace(/adhd\.config\.ts/g, '');
  assert.equal(/adhd/i.test(body), false);
});

test('LAYOUT_TSX renders sidebar nav linking every token domain', () => {
  // The sidebar replaces the old single-page sections — every token domain
  // gets its own entry in the layout's nav.
  for (const label of [
    'Colors', 'Spacing', 'Typography', 'Font Families', 'Font Weights',
    'Tracking', 'Leading', 'Radius', 'Shadows', 'Breakpoints', 'Easing', 'Animation',
  ]) {
    assert.match(LAYOUT_TSX, new RegExp(label), `missing sidebar label: ${label}`);
  }
});

test('LAYOUT_TSX reads adhd.config.ts to populate the Components sidebar list', () => {
  // The sidebar lists tracked components below the token domains — the layout
  // must read adhd.config.ts at request time to know what to show.
  assert.match(LAYOUT_TSX, /adhd\.config\.ts/);
  assert.match(LAYOUT_TSX, /Components/);
});

test('INDEX_PAGE_TSX is a minimal landing page (sections moved to TOKENS_PAGE_TSX)', () => {
  // The landing page now just welcomes the user; per-domain renderers live in
  // the tokens page that the sidebar links to.
  assert.match(INDEX_PAGE_TSX, /Design System/);
  assert.match(INDEX_PAGE_TSX, /Pick a token domain|Pick a/);
});

test('TOKENS_PAGE_TSX reads globals.css to render tokens at request time', () => {
  assert.match(TOKENS_PAGE_TSX, /globals\.css|cssEntry/);
  assert.match(TOKENS_PAGE_TSX, /parseTokens/);
});

test('COMPONENT_PAGE_TSX uses parametric template-string dynamic import', () => {
  assert.match(COMPONENT_PAGE_TSX, /await\s+import\(`/);
});

test('COMPONENT_PAGE_TSX reads searchParams for prop toggles', () => {
  assert.match(COMPONENT_PAGE_TSX, /searchParams/);
});

test('PROP_TOGGLE_TSX is a client component', () => {
  // The marker comment is allowed to precede the directive — Next.js strips
  // leading comments and treats `"use client"` as the first real statement.
  // Required so the marker-detection contract (Task 8) still applies.
  const afterMarker = PROP_TOGGLE_TSX.replace(MARKER_COMMENT, '');
  assert.match(afterMarker, /^["']use client["']/);
});

test('PROP_TOGGLE_TSX uses router.replace for snappy URL updates', () => {
  assert.match(PROP_TOGGLE_TSX, /router\.replace/);
});

test('LAYOUT_TSX renders a DiagnosticBanner that surfaces detected globals.css issues', () => {
  // The layout's whole reason for reading globals.css is to surface diagnostic issues
  // pre-emptively. The banner component must be in the template and wired into render.
  assert.match(LAYOUT_TSX, /DiagnosticBanner/);
  assert.match(LAYOUT_TSX, /<DiagnosticBanner issues=\{issues\} \/>/);
});

test('LAYOUT_TSX detection flags missing --color-ring-offset-background on shadcn-like themes', () => {
  // The detection heuristic should mention the ring-offset-background token explicitly
  // (the most common shadcn v3-to-v4 migration gap that surfaces on broad dynamic imports).
  assert.match(LAYOUT_TSX, /--color-ring-offset-background/);
  assert.match(LAYOUT_TSX, /looksShadcn/);
});

test('LAYOUT_TSX gracefully handles a missing globals.css (detectIssues returns [])', () => {
  // detectIssues must return [] when css is null — the layout still needs to render
  // for projects without globals.css.
  assert.match(LAYOUT_TSX, /if \(!css\) return issues;/);
});

test('INDEX_PAGE_TSX has a Troubleshooting section explaining the ENOENT failure mode', () => {
  assert.match(INDEX_PAGE_TSX, /Troubleshooting/);
  assert.match(INDEX_PAGE_TSX, /app-build-manifest/);
  assert.match(INDEX_PAGE_TSX, /broad dynamic import/i);
});

test('COMPONENT_ERROR_TSX is a client component error boundary', () => {
  const afterMarker = COMPONENT_ERROR_TSX.replace(MARKER_COMMENT, '');
  assert.match(afterMarker, /^["']use client["']/);
  // The error boundary props signature Next.js passes in
  assert.match(COMPONENT_ERROR_TSX, /error.*reset/);
  // Re-render mechanism
  assert.match(COMPONENT_ERROR_TSX, /reset\(\)/);
});

test('COMPONENT_ERROR_TSX distinguishes the build-manifest ENOENT from other runtime errors', () => {
  // The boundary inspects the error message and shows a focused note for the
  // bundler-level ENOENT (which it technically can't recover, but the user
  // should be told what's happening if it bubbles up).
  assert.match(COMPONENT_ERROR_TSX, /app-build-manifest/);
  assert.match(COMPONENT_ERROR_TSX, /isBuildManifestError/);
});

test('none of the templates contain "ADHD" outside the marker', () => {
  // The literal filename `adhd.config.ts` is the consumer's own config artifact
  // (per the install spec) and is not a reference to the ADHD plugin/brand —
  // it's an unavoidable filename the generated pages must read at runtime.
  // Strip it before applying the "no ADHD references" rule.
  for (const [name, content] of Object.entries({ LAYOUT_TSX, INDEX_PAGE_TSX, TOKENS_PAGE_TSX, COMPONENT_PAGE_TSX, COMPONENT_ERROR_TSX, PROP_TOGGLE_TSX })) {
    const body = content.replace(MARKER_COMMENT, '').replace(/adhd\.config\.ts/g, '');
    assert.equal(/adhd/i.test(body), false, `${name} must not reference ADHD outside marker`);
  }
});
