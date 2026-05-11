'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKER_COMMENT, LAYOUT_TSX, INDEX_PAGE_TSX, COMPONENT_PAGE_TSX, PROP_TOGGLE_TSX } = require('../templates');

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
  // marker excluded
  const body = LAYOUT_TSX.replace(MARKER_COMMENT, '');
  assert.equal(/adhd/i.test(body), false);
});

test('INDEX_PAGE_TSX renders sections for each token domain', () => {
  for (const section of ['Colors', 'Spacing', 'Typography', 'Radius', 'Shadows', 'Components']) {
    assert.match(INDEX_PAGE_TSX, new RegExp(section));
  }
});

test('INDEX_PAGE_TSX reads adhd.config.ts and globals.css via fs', () => {
  assert.match(INDEX_PAGE_TSX, /adhd\.config\.ts/);
  assert.match(INDEX_PAGE_TSX, /globals\.css|cssEntry/);
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

test('none of the templates contain "ADHD" outside the marker', () => {
  // The literal filename `adhd.config.ts` is the consumer's own config artifact
  // (per the install spec) and is not a reference to the ADHD plugin/brand —
  // it's an unavoidable filename the generated pages must read at runtime.
  // Strip it before applying the "no ADHD references" rule.
  for (const [name, content] of Object.entries({ LAYOUT_TSX, INDEX_PAGE_TSX, COMPONENT_PAGE_TSX, PROP_TOGGLE_TSX })) {
    const body = content.replace(MARKER_COMMENT, '').replace(/adhd\.config\.ts/g, '');
    assert.equal(/adhd/i.test(body), false, `${name} must not reference ADHD outside marker`);
  }
});
