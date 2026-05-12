'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MARKER_COMMENT,
  LAYOUT_TSX,
  INDEX_PAGE_TSX,
  TOKENS_PAGE_TSX,
  COMPONENT_PAGE_TSX,
  COMPONENT_MAP_TSX,
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

test('LAYOUT_TSX declares and named-exports the TOKEN_DOMAINS catalog', () => {
  // Single source of truth lives in the layout. Tokens page imports it from there.
  assert.match(LAYOUT_TSX, /export const TOKEN_DOMAINS: TokenDomain\[\]/);
  assert.match(LAYOUT_TSX, /export type TokenDomain/);
  for (const label of [
    'Colors', 'Spacing', 'Typography', 'Font Families', 'Font Weights',
    'Tracking', 'Leading', 'Radius', 'Shadows', 'Breakpoints', 'Easing', 'Animation',
  ]) {
    assert.match(LAYOUT_TSX, new RegExp(`label: "${label}"`), `missing domain label: ${label}`);
  }
  assert.match(LAYOUT_TSX, /slug:\s*"colors".*varPrefix:\s*"--color-".*tailwindDocs:/s);
});

test('TOKENS_PAGE_TSX imports the catalog from the layout via a __LAYOUT_MODULE__ placeholder', () => {
  // The path depends on prod-exclusion (`layout` vs `layout.design-system`) — the
  // installer substitutes it. Template body should carry the placeholder verbatim.
  assert.match(TOKENS_PAGE_TSX, /import \{ TOKEN_DOMAINS, type TokenDomain \} from "__LAYOUT_MODULE__"/);
});

test('LAYOUT_TSX imports the static components array from componentMap', () => {
  assert.match(LAYOUT_TSX, /import \{ components \} from "\.\/componentMap"/);
  // No fs/path imports — the layout is a pure render.
  assert.doesNotMatch(LAYOUT_TSX, /from "node:fs|from "node:path/);
});

test('LAYOUT_TSX is a sync (non-async) server component', () => {
  assert.doesNotMatch(LAYOUT_TSX, /export default async function/);
  assert.match(LAYOUT_TSX, /export default function DesignSystemDocsLayout/);
});

test('INDEX_PAGE_TSX is a landing page describing the static-import flow', () => {
  assert.match(INDEX_PAGE_TSX, /Design System/);
  assert.match(INDEX_PAGE_TSX, /statically imported/);
  assert.match(INDEX_PAGE_TSX, /re-run/);
});

test('INDEX_PAGE_TSX has no Troubleshooting section', () => {
  assert.doesNotMatch(INDEX_PAGE_TSX, /Troubleshooting/);
  assert.match(INDEX_PAGE_TSX, /\/adhd:sync-docs/);
});

test('TOKENS_PAGE_TSX reads globals.css from a baked CSS_ENTRY constant', () => {
  assert.match(TOKENS_PAGE_TSX, /const CSS_ENTRY = "__CSS_ENTRY__"/);
  assert.match(TOKENS_PAGE_TSX, /parseTokens/);
  assert.doesNotMatch(TOKENS_PAGE_TSX, /adhd\.config\.ts/);
});

test('TOKENS_PAGE_TSX does not inline the TOKEN_DOMAINS list', () => {
  assert.doesNotMatch(TOKENS_PAGE_TSX, /const TOKEN_DOMAINS = \[/);
});

test('COMPONENT_PAGE_TSX is a client component', () => {
  // The page must be a client component so PropToggle can be inlined and
  // useSearchParams/useRouter can drive URL state without a separate file.
  const afterMarker = COMPONENT_PAGE_TSX.replace(MARKER_COMMENT, '');
  assert.match(afterMarker, /^["']use client["']/);
});

test('COMPONENT_PAGE_TSX uses getComponent from the static componentMap (no fs reads, no dynamic import)', () => {
  assert.match(COMPONENT_PAGE_TSX, /import \{ components, getComponent, type PropSchema \} from "\.\.\/\.\.\/componentMap"/);
  assert.doesNotMatch(COMPONENT_PAGE_TSX, /await\s+import\(`/);
  // No server-side fs reads — the page is fully client.
  assert.doesNotMatch(COMPONENT_PAGE_TSX, /from "node:fs|from "node:path/);
});

test('COMPONENT_PAGE_TSX inlines PropToggle (no separate PropToggle.tsx file)', () => {
  // The PropToggle UI lives in the page itself now. No import from "../PropToggle".
  assert.match(COMPONENT_PAGE_TSX, /function PropToggle\(/);
  assert.doesNotMatch(COMPONENT_PAGE_TSX, /from "\.\.\/PropToggle"|from "\.\.\/\.\.\/PropToggle"/);
});

test('COMPONENT_PAGE_TSX reads URL state via useSearchParams + useParams hooks', () => {
  assert.match(COMPONENT_PAGE_TSX, /useParams/);
  assert.match(COMPONENT_PAGE_TSX, /useSearchParams/);
  assert.match(COMPONENT_PAGE_TSX, /router\.replace/);
});

test('COMPONENT_PAGE_TSX shows a "Not in the static map" branch for unknown slugs', () => {
  assert.match(COMPONENT_PAGE_TSX, /Not in the static map/);
  assert.match(COMPONENT_PAGE_TSX, /re-run.*\/adhd:sync-docs/i);
});

test('COMPONENT_MAP_TSX has the substitution placeholders the installer fills in', () => {
  assert.match(COMPONENT_MAP_TSX, /__COMPONENT_IMPORTS__/);
  assert.match(COMPONENT_MAP_TSX, /__COMPONENT_ENTRIES__/);
  assert.match(COMPONENT_MAP_TSX, /export function getComponent/);
  assert.match(COMPONENT_MAP_TSX, /export const components/);
  assert.match(COMPONENT_MAP_TSX, /export type PropSchema/);
});

test('COMPONENT_MAP_TSX declares figmaUrl on the ComponentEntry shape', () => {
  // Powers the "open in Figma" link on each component page. Null when the
  // user hasn't set a Figma URL for that component in adhd.config.ts.
  assert.match(COMPONENT_MAP_TSX, /figmaUrl:\s*string \| null/);
});

test('COMPONENT_PAGE_TSX renders a Figma link with ↗ when figmaUrl is present', () => {
  // Link is opt-in: only shown when the entry's figmaUrl isn't null.
  // Opens in a new tab (target="_blank"), uses rel="noopener noreferrer"
  // for security.
  assert.match(COMPONENT_PAGE_TSX, /figmaUrl &&[\s\S]*<a/);
  assert.match(COMPONENT_PAGE_TSX, /href=\{figmaUrl\}/);
  assert.match(COMPONENT_PAGE_TSX, /target="_blank"/);
  assert.match(COMPONENT_PAGE_TSX, /rel="noopener noreferrer"/);
  // The northeast-arrow glyph is the link content
  assert.match(COMPONENT_PAGE_TSX, /↗/);
});

test('COMPONENT_PAGE_TSX falls back to PascalCase slug when Component.name looks garbled', () => {
  // The runtime check rejects names that are single letters (minifier output
  // like "d") or start with non-uppercase chars (anonymous fn wrappers).
  // Falls back to the slug PascalCase'd so the snippet reads "<Logotype />"
  // not "<d />" or "<logotype />".
  assert.match(COMPONENT_PAGE_TSX, /looksLikeRealName/);
  assert.match(COMPONENT_PAGE_TSX, /\/\^\[A-Z\]\[A-Za-z0-9\]\+\$\//);
  assert.match(COMPONENT_PAGE_TSX, /pascalSlug/);
});

test('COMPONENT_MAP_TSX resolves a renderable function via default-then-named fallback', () => {
  assert.match(COMPONENT_MAP_TSX, /function resolveComponent/);
  assert.match(COMPONENT_MAP_TSX, /mod\.default/);
});

test('no template contains an explicit `any` type — consumer builds with no-explicit-any pass', () => {
  // Generated docs files are read by the consumer's TypeScript compiler.
  // If their ESLint config enables @typescript-eslint/no-explicit-any (the
  // typical strict setup), even one `any` in our templates breaks their build.
  // The templates use Record<string, unknown> + targeted casts instead.
  for (const [name, content] of Object.entries({ LAYOUT_TSX, INDEX_PAGE_TSX, TOKENS_PAGE_TSX, COMPONENT_PAGE_TSX, COMPONENT_MAP_TSX })) {
    // Word-boundary check: catches `: any`, `as any`, `Foo<any>`, etc. but not
    // identifiers that happen to contain "any" (e.g. "Company", "many").
    assert.doesNotMatch(content, /\bany\b/, `${name} contains an explicit \`any\` — consumers with no-explicit-any will fail to build`);
  }
});

test('none of the templates contain "ADHD" outside the marker', () => {
  // Two filename-style exceptions are allowed:
  //   1. `adhd.config.ts` — the consumer's own config artifact.
  //   2. `/adhd:sync-docs` — the slash command name, referenced in re-run copy.
  const all = { LAYOUT_TSX, INDEX_PAGE_TSX, TOKENS_PAGE_TSX, COMPONENT_PAGE_TSX, COMPONENT_MAP_TSX };
  for (const [name, content] of Object.entries(all)) {
    const body = content
      .replace(MARKER_COMMENT, '')
      .replace(/adhd\.config\.ts/g, '')
      .replace(/\/adhd:sync-docs/g, '');
    assert.equal(/adhd/i.test(body), false, `${name} must not reference ADHD outside marker / allowed exceptions`);
  }
});
