'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + filename);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

test('cli with --help prints usage', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('cli runs end-to-end on synthetic inputs and writes a report', () => {
  const varDefs = tmp('vars.json', { 'Primitives/color/brand/600': '#5e3aee' });
  const ctx = tmp('ctx.json', {
    id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL',
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'X' } } }],
  });
  const cssPath = tmp('globals.css', `
    @theme { --color-brand-600: #5e3aee; }
    :root { }
    :root[data-theme="dark"] { }
  `);
  const configPath = tmp('adhd.config.ts', `
    export default { figma: { url: 'https://figma.com/design/abc/Test' }, naming: 'kebab-case' };
  `);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, 'exit 0 (no errors): stderr=' + result.stderr);
  const report = fs.readFileSync(reportPath, 'utf8');
  assert.match(report, /No violations found/);

  // stdout should be JSON summary
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.errors, 0);
  assert.equal(summary.warnings, 0);
});

test('cli exits 1 when variable conflicts exist', () => {
  const varDefs = tmp('vars.json', { 'Primitives/color/brand/600': '#5e3aee' });
  const ctx = tmp('ctx.json', { id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme { --color-brand-600: #000000; } :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1);
});

// --- Extra coverage beyond the plan ---

test('cli exits 2 with helpful error when a required flag is missing', () => {
  // Omit --variable-defs deliberately.
  const ctx = tmp('ctx.json', { id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    // --variable-defs intentionally omitted
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /variable-defs/);
});

test('cli accepts an array-of-nodes input via --design-context for whole-file mode', () => {
  const varDefs = tmp('vars.json', {});
  const ctx = tmp('ctx.json', {
    mode: 'whole-file',
    pages: [
      {
        id: '0:1', name: 'Page 1',
        nodes: [
          { id: '1:1', name: 'avatar', type: 'COMPONENT_SET', componentPropertyDefinitions: { size: { type: 'VARIANT', defaultValue: 'sm', variantOptions: ['sm', 'md'] } }, children: [] },
        ],
      },
    ],
  });
  const cssPath = tmp('globals.css', `@theme { } :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Whole file',
    '--target-url', 'https://figma.com/design/abc',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const report = fs.readFileSync(reportPath, 'utf8');
  assert.match(report, /Page: Page 1/);
});

test('cli with structure errors but no variable issues exits 1', () => {
  // Empty variable defs (no var issues), and a frame with children but no auto-layout (STRUCT001).
  const varDefs = tmp('vars.json', {});
  const ctx = tmp('ctx.json', {
    id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'NONE',
    children: [
      { id: '1:2', name: 'inner', type: 'FRAME', layoutMode: 'NONE' },
    ],
  });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Card',
    '--target-url', 'https://figma.com/design/abc?node-id=1-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, 'exit 1: stderr=' + result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.variable.length, 0);
  assert.ok(summary.errors >= 1);
});

test('STRUCT011: groups renames by target collection + calls the action "Move to"', () => {
  // Real-world scenario from the user's reactor file: a "Type + Effects"
  // collection bundling typography sizes, line-heights, and opacity. The
  // message groups by target collection so the designer sees the pattern
  // ("create Text + Leading, move things into them") instead of N
  // disconnected lines.
  const varDefs = tmp('vars.json', {
    'Type + Effects/Font-Size/Body':             '16px',
    'Type + Effects/Font-Size/Body LG':          '20px',
    'Type + Effects/Line-Height/Line Height 28': '28px',
    'Type + Effects/Line-Height/Letter Space 0': '0',     // ambiguous (leaf hints tracking)
    'Type + Effects/Effects/Opacity 100%':       '1',     // opacity has no v4 domain
    'Primitives/color/BrandPrimary':             '#000',  // tier-mode case fix
    'Color/gold':                                '#c5a572', // already correct
  });
  const ctx = tmp('ctx.json', { id: '5:42', name: 'Logo', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI, '--variable-defs', varDefs, '--design-context', ctx, '--globals-css', cssPath,
    '--config', configPath, '--target', 'Logo',
    '--target-url', 'https://figma.com/design/abc?node-id=5-42', '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  const struct011 = summary.structure.find(v => v.rule === 'STRUCT011');
  assert.ok(struct011);
  assert.equal(struct011.severity, 'warning');
  assert.equal(struct011.nodeId, '5:42');
  // Header tone shifted from "renaming" (misleading) to "restructure" — these
  // are moves, not renames, and the body explains how Figma's Move-To works.
  assert.match(struct011.message, /variable-naming issue\(s\)\. Suggested restructure/);
  // Target-collection groups present:
  assert.match(struct011.message, /Move to "Text" collection \(2 vars\):/);
  assert.match(struct011.message, /Text\/body/);
  assert.match(struct011.message, /Text\/body-lg/);
  assert.match(struct011.message, /Move to "Leading" collection \(1 var\):/);
  assert.match(struct011.message, /Leading\/line-height-28/);
  assert.match(struct011.message, /Move to "Primitives" collection \(1 var\):/);
  // Ambiguity section surfaces both options
  assert.match(struct011.message, /Ambiguous[\s\S]*Letter Space 0/);
  assert.match(struct011.message, /Primary: +→ Leading/);
  assert.match(struct011.message, /Alternate: +→ Tracking/);
  // No-mapping section has opacity-specific guidance, not the generic list
  assert.match(struct011.message, /No Tailwind v4 mapping[\s\S]*Opacity 100%[\s\S]*class modifiers/);
  // Footer explains the Figma mechanic and calls out the rename-vs-move distinction
  assert.match(struct011.message, /How to apply each move in Figma/);
  assert.match(struct011.message, /Right-click the source variable → "Move to/);
  assert.match(struct011.message, /Use Figma's "Move to\.\.\." \(not "Rename"\)/);
  // Already-correct variable doesn't appear
  assert.doesNotMatch(struct011.message, /Color\/gold/);
});

test('STRUCT011: variable case is always kebab-case, regardless of project naming config', () => {
  // PascalCase project config (for components) doesn't bleed into variable
  // naming. `Color/BrandGold` still gets renamed to `Color/brand-gold`.
  const varDefs = tmp('vars.json', {
    'Color/gold':      '#c5a572',
    'Color/BrandGold': '#c5a572',
  });
  const ctx = tmp('ctx.json', { id: '5:1', name: 'X', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'PascalCase' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI, '--variable-defs', varDefs, '--design-context', ctx, '--globals-css', cssPath,
    '--config', configPath, '--target', 'X',
    '--target-url', 'https://figma.com/design/abc?node-id=5-1', '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  const struct011 = summary.structure.find(v => v.rule === 'STRUCT011');
  assert.ok(struct011);
  assert.match(struct011.message, /Color\/BrandGold[\s\S]*→ Color\/brand-gold/);
  // Color/gold is compliant; doesn't appear
  assert.doesNotMatch(struct011.message, /Color\/gold[\s\S]*→/);
});

test('STRUCT011: collection-name-is-domain (Color/, Radius/, Spacing/) — no domain suggestion', () => {
  // The user's "Radius/sm flagged as unknown domain" report. Fixed: when the
  // collection name itself is a Tailwind domain, the variable name doesn't
  // need another domain prefix.
  const varDefs = tmp('vars.json', {
    'Radius/sm':   '4px',
    'Color/gold':  '#c5a572',
    'Spacing/md':  '0.75rem',
  });
  const ctx = tmp('ctx.json', { id: '5:1', name: 'X', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'X',
    '--target-url', 'https://figma.com/design/abc?node-id=5-1',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  // No STRUCT011 at all — all three vars are valid (collection IS the domain).
  assert.equal(summary.structure.filter(v => v.rule === 'STRUCT011').length, 0);
});

test('Tailwind-default variables are NEVER reported as missing in code', () => {
  // Tailwind v4 ships `--color-white`, `--color-black`, the spacing
  // multiplier, the --text-* scale, etc. by default. If a Figma file has
  // a variable that maps to one of those (e.g. `Color/white` = #ffffff),
  // the comparator must NOT surface it as `status: 'missing'` — the user
  // would then see a "add this to globals.css" prompt for a token Tailwind
  // already provides. Pure clutter.
  const varDefs = tmp('vars.json', {
    'Primitives/color/white':  '#ffffff',    // Tailwind default → must NOT be missing
    'Primitives/color/black':  '#000000',    // Tailwind default → must NOT be missing
    'Primitives/color/custom': '#5e3aee',    // genuinely missing
  });
  const ctx = tmp('ctx.json', { id: '5:1', name: 'X', type: 'FRAME', layoutMode: 'VERTICAL' });
  // globals.css has nothing — relying entirely on Tailwind defaults.
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI, '--variable-defs', varDefs, '--design-context', ctx, '--globals-css', cssPath,
    '--config', configPath, '--target', 'X',
    '--target-url', 'https://figma.com/design/abc?node-id=5-1', '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  const missing = summary.variable.filter(v => v.status === 'missing');
  // Only the custom brand color should be "missing" — white/black are covered by Tailwind.
  assert.equal(missing.length, 1, 'only the non-default variable should be flagged as missing');
  assert.equal(missing[0].token, 'color/custom');
  // The defaults are absent from the missing list.
  assert.equal(missing.filter(v => v.token === 'color/white').length, 0);
  assert.equal(missing.filter(v => v.token === 'color/black').length, 0);
});

test('STRUCT011 per-layer: with --var-id-map, fires once per layer using the bad var (drops aggregate)', () => {
  // The user-visible upgrade — annotations land on the layer that actually
  // uses each bad variable, not lumped onto the scope root. Designers walk
  // the annotated layers one-by-one instead of cross-referencing a single
  // multiline message against the layer tree.
  const varDefs = tmp('vars.json', { 'Tracking/BadName': '0.05em' });
  const ctx = tmp('ctx.json', {
    id: '5:1', name: 'Page', type: 'FRAME',
    children: [
      { id: '5:2', name: 'A', type: 'TEXT',
        boundVariables: { letterSpacing: { id: 'VAR:bad' } } },
      { id: '5:3', name: 'B', type: 'TEXT',
        boundVariables: { letterSpacing: { id: 'VAR:bad' } } },
    ],
  });
  const idMap = tmp('varidmap.json', { 'VAR:bad': 'Tracking/BadName' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI, '--variable-defs', varDefs, '--var-id-map', idMap, '--design-context', ctx,
    '--globals-css', cssPath, '--config', configPath, '--target', 'Page',
    '--target-url', 'https://figma.com/design/abc?node-id=5-1', '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  const struct011 = summary.structure.filter(v => v.rule === 'STRUCT011');
  // Two layers each get their own violation — no aggregate.
  assert.equal(struct011.length, 2);
  const ids = struct011.map(v => v.nodeId).sort();
  assert.deepEqual(ids, ['5:2', '5:3']);
  // Per-layer message format
  assert.match(struct011[0].message, /Layer uses "Tracking\/BadName"/);
  assert.match(struct011[0].message, /Move to "Tracking" collection/);
});

test('STRUCT012: cross-domain binding (Spacing var → letterSpacing) fires per-layer', () => {
  // Designer's `Spacing/4` variable (correctly named for its domain) is
  // bound to letter-spacing — semantically wrong, but STRUCT011 stays quiet
  // because the name itself is fine. STRUCT012 catches it.
  const varDefs = tmp('vars.json', { 'Spacing/4': '1rem' });
  const ctx = tmp('ctx.json', {
    id: '5:1', name: 'Title', type: 'TEXT',
    boundVariables: { letterSpacing: { id: 'VAR:spacing4' } },
  });
  const idMap = tmp('varidmap.json', { 'VAR:spacing4': 'Spacing/4' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI, '--variable-defs', varDefs, '--var-id-map', idMap, '--design-context', ctx,
    '--globals-css', cssPath, '--config', configPath, '--target', 'Title',
    '--target-url', 'https://figma.com/design/abc?node-id=5-1', '--output', reportPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, 'STRUCT012 is severity=error; cli exits 1');
  const summary = JSON.parse(result.stdout);
  const struct012 = summary.structure.filter(v => v.rule === 'STRUCT012');
  assert.equal(struct012.length, 1);
  assert.equal(struct012[0].nodeId, '5:1');
  assert.equal(struct012[0].severity, 'error');
  assert.match(struct012[0].message, /Spacing\/4/);
  assert.match(struct012[0].message, /spacing variable/);
  assert.match(struct012[0].message, /tracking variable/);
  // No STRUCT011 — the name itself is fine.
  assert.equal(summary.structure.filter(v => v.rule === 'STRUCT011').length, 0);
});

test('STRUCT012: same-domain binding is silent', () => {
  // Tracking variable bound to letterSpacing is fine — no violations.
  const varDefs = tmp('vars.json', { 'Tracking/normal': '0' });
  const ctx = tmp('ctx.json', {
    id: '5:1', name: 'Title', type: 'TEXT',
    boundVariables: { letterSpacing: { id: 'VAR:trackingNormal' } },
  });
  const idMap = tmp('varidmap.json', { 'VAR:trackingNormal': 'Tracking/normal' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI, '--variable-defs', varDefs, '--var-id-map', idMap, '--design-context', ctx,
    '--globals-css', cssPath, '--config', configPath, '--target', 'Title',
    '--target-url', 'https://figma.com/design/abc?node-id=5-1', '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.structure.filter(v => v.rule === 'STRUCT012').length, 0);
});

test('STRUCT013: surfaces Figma variables that duplicate Tailwind defaults (strict match)', () => {
  // Designer pushed the full Tailwind palette to Figma, then left their
  // legacy `Color/white` sitting alongside the canonical `--color-white`.
  // Same name, same value → flag for consolidation. A coincidental value
  // match on a differently-named variable (`Color/Background`) is NOT
  // flagged — semantic intent is respected.
  //
  // We use the white/black defaults here rather than a zinc shade because
  // Tailwind's color palette ships as oklch() in tailwind-defaults.css —
  // a hex fixture wouldn't string-match. The user's real Figma files
  // typically resolve all variables to a consistent format (Figma
  // converts oklch to hex for the resolved value); a fully realistic
  // fixture would mock that resolution.
  const varDefs = tmp('vars.json', {
    'Color/white':      '#fff',      // dupe — same name + value as Tailwind default
    'Color/Background': '#fff',      // semantic — value matches but name doesn't, no fire
    'Color/brand':      '#5e3aee',   // not a Tailwind default at all
    'Spacing/default':  '0.25rem',   // dupe of --spacing
  });
  const idMap = tmp('varidmap.json', {
    'VAR:white':   'Color/white',
    'VAR:spacing': 'Spacing/default',
  });
  const ctx = tmp('ctx.json', { id: '5:1', name: 'X', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI, '--variable-defs', varDefs, '--var-id-map', idMap, '--design-context', ctx,
    '--globals-css', cssPath, '--config', configPath, '--target', 'X',
    '--target-url', 'https://figma.com/design/abc?node-id=5-1', '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  const struct013 = summary.structure.filter(v => v.rule === 'STRUCT013');
  // Only `Color/white` fires — `Color/Background` has the same value but
  // a different name (semantic intent respected), `Color/brand` isn't a
  // Tailwind default at all, and `Spacing/default` normalizes to
  // "spacing-default" which doesn't align with `--spacing`'s canonical
  // form (strict name match).
  assert.equal(struct013.length, 1);
  const v = struct013[0];
  assert.equal(v.severity, 'warning');
  assert.equal(v.figmaVarName, 'Color/white');
  assert.equal(v.figmaVarId, 'VAR:white');
  assert.equal(v.tailwindCssVar, '--color-white');
  assert.match(v.message, /duplicates Tailwind default `--color-white`/);
  assert.match(v.message, /\/adhd:lint --fix/);
});

test('STRUCT011: omits nodeId in whole-file mode (no scope root to annotate)', () => {
  const varDefs = tmp('vars.json', { 'Primitives/color/BrandPrimary': '#000' });
  const ctx = tmp('ctx.json', { mode: 'whole-file', pages: [] });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  const configPath = tmp('adhd.config.ts', `export default { naming: 'kebab-case' };`);
  const reportPath = path.join(os.tmpdir(), 'adhd-report-' + Date.now() + '.md');

  const result = spawnSync('node', [
    CLI,
    '--variable-defs', varDefs,
    '--design-context', ctx,
    '--globals-css', cssPath,
    '--config', configPath,
    '--target', 'Whole file',
    '--target-url', 'https://figma.com/design/abc/Test',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  const struct011 = summary.structure.find(v => v.rule === 'STRUCT011');
  assert.ok(struct011);
  // No nodeId — the violation appears in the report but doesn't annotate
  // anywhere (the annotation flow filters out items without nodeIds).
  assert.equal(struct011.nodeId, undefined);
});
