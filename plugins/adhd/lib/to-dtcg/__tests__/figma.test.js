'use strict';

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.resolve(__dirname, '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '__fixtures__');

test('figma source (synthetic REST API shape): parseFigmaResponse round-trips colors and spacing', () => {
  // The fixture sample-figma-rest-shape.json represents Figma's REST API
  // /v1/files/:key/variables/local response (Enterprise-only). It's synthetic
  // because the Figma MCP doesn't expose raw variable data. This test gives
  // parseFigmaResponse coverage for the day if/when we add a REST API path.
  const out = JSON.parse(execFileSync('node', [
    cliPath,
    '--source', 'figma',
    '--input', path.join(fixturesDir, 'sample-figma-rest-shape.json'),
  ], { encoding: 'utf8' }));

  const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'sample.dtcg.json'), 'utf8'));

  // Figma's variable API doesn't represent shadow tokens. Compare only the
  // domains both sources support.
  assert.deepEqual(out.color, expected.color);
  assert.deepEqual(out.spacing, expected.spacing);
  assert.equal(out.shadow, undefined, 'figma output should not include shadow domain');
});
