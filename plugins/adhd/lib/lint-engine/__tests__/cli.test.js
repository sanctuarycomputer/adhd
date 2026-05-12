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

test('STRUCT011: flags Figma variables whose names violate case OR Tailwind domain expectations', () => {
  // Mix of three issue types in one frame — STRUCT011 aggregates them into a
  // single annotation with separate "Case" and "Tailwind v4 domain" sections.
  const varDefs = tmp('vars.json', {
    'Primitives/color/BrandPrimary': '#000',       // case violation (kebab-case project)
    'Primitives/colur/brand-500':    '#111',       // domain typo (Levenshtein)
    'Primitives/space/sm':           '0.5rem',     // domain synonym
    'Primitives/widget/foo':         '?',          // unknown domain
    'Primitives/color/text/default': '#222',       // compliant — shouldn't appear
  });
  const ctx = tmp('ctx.json', {
    id: '5:42', name: 'Logo', type: 'FRAME', layoutMode: 'VERTICAL',
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
    '--target', 'Logo',
    '--target-url', 'https://figma.com/design/abc?node-id=5-42',
    '--output', reportPath,
  ], { encoding: 'utf8' });

  const summary = JSON.parse(result.stdout);
  const struct011 = summary.structure.find(v => v.rule === 'STRUCT011');
  assert.ok(struct011, 'expected a STRUCT011 violation');
  assert.equal(struct011.severity, 'warning');
  assert.equal(struct011.nodeId, '5:42');
  // Header counts ALL issues (1 case + 3 domain = 4).
  assert.match(struct011.message, /4 variable-naming issue\(s\)/);
  // Case section. The header explains kebab-case is a Tailwind v4 requirement
  // (not the project's naming convention) — important since users may have
  // PascalCase configured for components.
  assert.match(struct011.message, /Case \(kebab-case — Tailwind v4 requires lowercase CSS vars\)/);
  assert.match(struct011.message, /Primitives\/color\/BrandPrimary +→ +Primitives\/color\/brand-primary/);
  // Domain section with all three "did you mean?" flavours
  assert.match(struct011.message, /Tailwind v4 domain:/);
  assert.match(struct011.message, /Primitives\/colur\/brand-500.*did you mean "color".*typo/);
  assert.match(struct011.message, /Primitives\/space\/sm.*did you mean "spacing".*Tailwind v4 prefix/);
  assert.match(struct011.message, /Primitives\/widget\/foo.*unknown domain "widget".*expected one of: color, spacing/);
  // Compliant variable is NOT listed.
  assert.doesNotMatch(struct011.message, /text\/default/);
});

test('STRUCT011: variable case is always kebab-case, regardless of project naming config', () => {
  // The user's case: project config is `naming: "PascalCase"` (for COMPONENT
  // identifiers like Logo vs logo). The rule must NOT apply PascalCase to
  // variable names — CSS custom properties are kebab-lowercase by Tailwind
  // v4 spec. So `Color/gold` should not be flagged as needing "Color/Gold".
  const varDefs = tmp('vars.json', {
    'Color/gold':      '#c5a572',    // kebab-ok (collection-is-domain, lowercase value)
    'Color/BrandGold': '#c5a572',    // case violation → should suggest brand-gold, NOT BrandGold
  });
  const ctx = tmp('ctx.json', { id: '5:1', name: 'X', type: 'FRAME', layoutMode: 'VERTICAL' });
  const cssPath = tmp('globals.css', `@theme {} :root {} :root[data-theme="dark"] {}`);
  // PascalCase project — must be ignored for variable case checking.
  const configPath = tmp('adhd.config.ts', `export default { naming: 'PascalCase' };`);
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
  const struct011 = summary.structure.find(v => v.rule === 'STRUCT011');
  assert.ok(struct011, 'expected STRUCT011 to flag BrandGold');
  // Variable-case section advertises kebab-case (with the rationale), not PascalCase
  assert.match(struct011.message, /Case \(kebab-case — Tailwind v4 requires lowercase CSS vars\)/);
  // BrandGold suggestion is kebab, not PascalCase
  assert.match(struct011.message, /Color\/BrandGold +→ +Color\/brand-gold/);
  // Color/gold is NOT flagged (already kebab-compliant, even though "gold"
  // would fail PascalCase if the config were honored).
  assert.doesNotMatch(struct011.message, /Color\/gold +→/);
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
