'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function tmp(filename, content) {
  const p = path.join(os.tmpdir(), 'adhd-' + Date.now() + '-' + filename);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

test('cli with --help prints usage', () => {
  const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('compare mode produces diff JSON to --output', () => {
  const css = tmp('globals.css', `
    @theme { --color-gold-100: #faf0c5; }
    :root { --background: #ffffff; }
    @media (prefers-color-scheme: dark) { :root { --background: #0a0a0a; } }
  `);
  const figma = tmp('figma.json', {
    collections: [
      { id: 'C1', name: 'color',
        modes: [{ id: 'M1', name: 'Light' }, { id: 'M2', name: 'Dark' }],
        variables: [
          {
            id: 'V1', name: 'gold/100', resolvedType: 'COLOR', scopes: [],
            valuesByMode: {
              Light: { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
              Dark:  { kind: 'color', r: 0.98, g: 0.94, b: 0.77, a: 1 },
            },
          },
        ],
      },
    ],
    effectStyles: [], textStyles: [],
  });
  const out = path.join(os.tmpdir(), 'adhd-diff-' + Date.now() + '.json');

  const result = spawnSync('node', [CLI, 'compare', '--code', css, '--figma', figma, '--output', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const diff = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(Array.isArray(diff.same));
  assert.ok(Array.isArray(diff.conflict));
  assert.ok(Array.isArray(diff.codeOnly));
  assert.ok(Array.isArray(diff.figmaOnly));
});

test('apply mode produces actions list', () => {
  const diff = tmp('diff.json', {
    same: [], conflict: [], figmaOnly: [],
    codeOnly: [{ domain: 'color', path: 'gold/100', values: { default: { type: 'literal', value: '#faf0c5' } } }],
  });
  const resolutions = tmp('resolutions.json', []);
  const out = path.join(os.tmpdir(), 'adhd-actions-' + Date.now() + '.json');

  const result = spawnSync('node', [CLI, 'apply', '--diff', diff, '--resolutions', resolutions, '--direction', 'push', '--output', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const actions = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'create-variable');
});

test('preview (push): lists adds + conflicts + figma-only count without writing', () => {
  // Verifies the dry-run formatter for /adhd:push-tokens --dry-run:
  // every code-only token shows as an ADD line per mode, every conflict
  // shows BOTH values (we don't pre-resolve in dry-run), figma-only
  // tokens are surfaced as a count only.
  const diff = tmp('diff.json', {
    same: [],
    conflict: [
      { path: 'color/brand-500', mode: 'default', domain: 'color', code: '#aaa', figma: '#bbb' },
      { path: 'spacing/4',       mode: 'default', domain: 'spacing', code: '1rem',  figma: '0.875rem' },
    ],
    codeOnly: [
      { domain: 'color', path: 'gold/100', values: { default: '#faf0c5' } },
      { domain: 'color', path: 'surface',  values: { light: '#fff', dark: '#0a0a0a' } },
    ],
    figmaOnly: [
      { domain: 'color', path: 'legacy/old', values: { default: '#123456' } },
    ],
  });

  const result = spawnSync('node', [CLI, 'preview', '--diff', diff, '--direction', 'push'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  assert.match(result.stdout, /DRY RUN — code → Figma/);
  // Each codeOnly token expanded per mode → 1 + 2 = 3 ADD rows
  assert.match(result.stdout, /Would add to Figma \(3 entries\)/);
  assert.match(result.stdout, /\+ gold\/100/);
  assert.match(result.stdout, /\+ surface[^\n]+light[^\n]+#fff/);
  assert.match(result.stdout, /\+ surface[^\n]+dark[^\n]+#0a0a0a/);
  // Conflict rows show both sides
  assert.match(result.stdout, /Would prompt for 2 conflicts/);
  assert.match(result.stdout, /! color\/brand-500[^\n]+code=#aaa[^\n]+figma=#bbb/);
  // Figma-only count
  assert.match(result.stdout, /Figma-only \(left untouched per additive policy\): 1 entry/);
  // Footer
  assert.match(result.stdout, /To apply: re-run without --dry-run/);
});

test('preview (pull): flips the direction labels', () => {
  // Symmetric for pull — figmaOnly becomes ADD, codeOnly becomes the
  // untouched count.
  const diff = tmp('diff.json', {
    same: [], conflict: [],
    codeOnly: [
      { domain: 'color', path: 'kept-in-code', values: { default: '#aaa' } },
    ],
    figmaOnly: [
      { domain: 'color', path: 'new-from-figma', values: { default: '#bbb' } },
    ],
  });

  const result = spawnSync('node', [CLI, 'preview', '--diff', diff, '--direction', 'pull'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  assert.match(result.stdout, /DRY RUN — figma → code/);
  assert.match(result.stdout, /Would add to code \(1 entry\)/);
  assert.match(result.stdout, /\+ new-from-figma/);
  assert.match(result.stdout, /code-only \(left untouched per additive policy\): 1 entry/);
});

test('compare --include-tailwind: keeps Tailwind-default-origin tokens in codeOnly', () => {
  // Verifies the seed-mode flag plumbing. With --include-tailwind, the
  // comparator should NOT filter origin-tagged tokens.
  const css = tmp('globals.css', `@theme { --color-brand: #5e3aee; }`);
  // Use an empty figma extract so everything that's in code becomes codeOnly.
  const figma = tmp('figma.json', { collections: [], effectStyles: [], textStyles: [] });
  const outA = path.join(os.tmpdir(), 'diff-default-' + Date.now() + '.json');
  const outB = path.join(os.tmpdir(), 'diff-seed-' + Date.now() + '.json');

  const defaultRun = spawnSync('node', [CLI, 'compare', '--code', css, '--figma', figma, '--output', outA], { encoding: 'utf8' });
  assert.equal(defaultRun.status, 0);
  const diffDefault = JSON.parse(fs.readFileSync(outA, 'utf8'));

  const seedRun = spawnSync('node', [CLI, 'compare', '--code', css, '--figma', figma, '--output', outB, '--include-tailwind'], { encoding: 'utf8' });
  assert.equal(seedRun.status, 0);
  const diffSeed = JSON.parse(fs.readFileSync(outB, 'utf8'));

  // Seed mode has dramatically more codeOnly entries — the full Tailwind palette.
  assert.ok(diffSeed.codeOnly.length > diffDefault.codeOnly.length * 5,
    `expected seed codeOnly (${diffSeed.codeOnly.length}) >> default codeOnly (${diffDefault.codeOnly.length})`);
  // Default mode never includes a token tagged fromTailwindDefault.
  for (const t of diffDefault.codeOnly) {
    assert.notEqual(t.fromTailwindDefault, true);
  }
  // Seed mode DOES include them.
  assert.ok(diffSeed.codeOnly.some(t => t.fromTailwindDefault === true));
});

test('preview: buckets additions by domain when there are many entries', () => {
  // Above the flat-list threshold (25), the preview groups by domain
  // with a sample-of-each rather than a hundreds-line dump.
  const codeOnly = [];
  for (let i = 0; i < 40; i++) {
    codeOnly.push({ domain: 'color', path: `zinc/${i}`, values: { default: `#000${i}` } });
  }
  for (let i = 0; i < 30; i++) {
    codeOnly.push({ domain: 'spacing', path: `${i}`, values: { default: `${i}px` } });
  }
  const diff = tmp('diff.json', { same: [], conflict: [], codeOnly, figmaOnly: [] });

  const result = spawnSync('node', [CLI, 'preview', '--diff', diff, '--direction', 'push'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would add to Figma \(70 entries across 2 domains\)/);
  assert.match(result.stdout, /\bCOLOR \(40\)/);
  assert.match(result.stdout, /\bSPACING \(30\)/);
  // Each bucket is truncated; the trailer shows the remaining count.
  assert.match(result.stdout, /\[\+34 more\]/);
  assert.match(result.stdout, /\[\+24 more\]/);
});

test('preview: errors on missing --diff or invalid --direction', () => {
  // Sanity: the subcommand must validate its inputs.
  let r = spawnSync('node', [CLI, 'preview', '--direction', 'push'], { encoding: 'utf8' });
  assert.equal(r.status, 2);

  const diff = tmp('diff.json', { same: [], conflict: [], codeOnly: [], figmaOnly: [] });
  r = spawnSync('node', [CLI, 'preview', '--diff', diff], { encoding: 'utf8' });
  assert.equal(r.status, 2);

  r = spawnSync('node', [CLI, 'preview', '--diff', diff, '--direction', 'bogus'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});
