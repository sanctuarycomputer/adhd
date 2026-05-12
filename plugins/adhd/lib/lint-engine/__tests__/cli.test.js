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

test('STRUCT011: emits one concrete rename target per variable (mixed case + domain issues)', () => {
  // Real-world scenario from the user's reactor file: a bundled "Type +
  // Effects" collection that conflates typography sizes, line-heights, and
  // effects. Each variable gets a single target, not two contradictory
  // hints. The designer can act on each line independently.
  const varDefs = tmp('vars.json', {
    'Type + Effects/Font-Size/Body':           '16px',
    'Type + Effects/Line-Height/Line Height 28': '28px',
    'Type + Effects/Effects/Opacity 100%':     '1',     // no Tailwind v4 mapping
    'Primitives/color/BrandPrimary':           '#000',  // tier-mode case fix
    'Color/gold':                              '#c5a572', // already correct
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
  // Header counts ALL issues (4 — Color/gold is compliant and doesn't appear).
  assert.match(struct011.message, /4 variable\(s\) need renaming for Tailwind v4 alignment/);
  // Unknown-collection + domain-segment-hint → MOVE into domain-named collection
  assert.match(struct011.message, /Type \+ Effects\/Font-Size\/Body[\s\S]*→ Text\/body/);
  assert.match(struct011.message, /Type \+ Effects\/Line-Height\/Line Height 28[\s\S]*→ Leading\/line-height-28/);
  // Tier collection + case-only issue → preserve tier, kebab the leaf
  assert.match(struct011.message, /Primitives\/color\/BrandPrimary[\s\S]*→ Primitives\/color\/brand-primary/);
  // Domain-less variable → no-mapping explanation
  assert.match(struct011.message, /Type \+ Effects\/Effects\/Opacity 100%[\s\S]*⚠ No Tailwind v4 domain/);
  // Already-correct variable doesn't appear
  assert.doesNotMatch(struct011.message, /Color\/gold/);
  // No leftover from the old format
  assert.doesNotMatch(struct011.message, /Case \(kebab-case/);
  assert.doesNotMatch(struct011.message, /did you mean/);
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
