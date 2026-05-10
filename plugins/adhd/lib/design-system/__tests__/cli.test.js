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
