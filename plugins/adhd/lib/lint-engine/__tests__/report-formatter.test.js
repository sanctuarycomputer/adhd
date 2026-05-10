'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReport } = require('../report-formatter');

const VIOLATIONS = {
  variable: [
    { token: 'color/brand/600', status: 'missing', figma: '#5e3aee', local: null,
      deepLink: 'https://figma.com/design/abc?node-id=1-1' },
    { token: 'color/surface/elevated', status: 'conflict', figma: '#ffffff', local: '#f5f5f5',
      mode: 'light',
      deepLink: 'https://figma.com/design/abc?node-id=1-2' },
  ],
  structure: [
    { rule: 'STRUCT001', severity: 'error', nodeId: '1:3', nodePath: 'Card > Container',
      message: 'Frame has children but auto-layout is not enabled.',
      deepLink: 'https://figma.com/design/abc?node-id=1-3' },
    { rule: 'STRUCT008', severity: 'warning', nodeId: '1:4', nodePath: 'Card > Frame 47',
      message: 'Layer is auto-named.',
      deepLink: 'https://figma.com/design/abc?node-id=1-4' },
  ],
};

const META = {
  target: 'Page 1 / Card',
  targetUrl: 'https://figma.com/design/abc?node-id=1-1',
  runAt: new Date('2026-05-10T14:23:00Z'),
};

test('report includes target, run time, and total counts', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /\*\*Target:\*\* Page 1 \/ Card/);
  assert.match(md, /\*\*Run at:\*\* 2026-05-10/);
  assert.match(md, /\*\*Result:\*\* 1 errors, 1 warnings/);
});

test('report groups variable issues into Missing and Conflicts subsections', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /## Variable issues \(2\)/);
  assert.match(md, /### Missing locally \(1\)/);
  assert.match(md, /### Conflicts \(1\)/);
});

test('report shows conflict mode label and both values', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /color\/surface\/elevated.*\(light\)/i);
  assert.match(md, /local: `#f5f5f5`/);
  assert.match(md, /figma: `#ffffff`/);
});

test('report groups structure issues into Errors and Warnings subsections', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /## Structure issues \(2\)/);
  assert.match(md, /### Errors \(1\)/);
  assert.match(md, /### Warnings \(1\)/);
});

test('report includes deep links for every violation', () => {
  const md = formatReport(VIOLATIONS, META);
  assert.match(md, /\[open\]\(https:\/\/figma\.com\/design\/abc\?node-id=1-1\)/);
  assert.match(md, /\[open\]\(https:\/\/figma\.com\/design\/abc\?node-id=1-3\)/);
});

test('report handles zero violations gracefully', () => {
  const md = formatReport({ variable: [], structure: [] }, META);
  assert.match(md, /No violations found/);
});

// --- Extra coverage beyond the plan ---

test('report with structure errors only and no variable issues omits variable section', () => {
  const onlyStructure = {
    variable: [],
    structure: [
      { rule: 'STRUCT001', severity: 'error', nodeId: '1:3', nodePath: 'Card > Container',
        message: 'Frame has children but auto-layout is not enabled.',
        deepLink: 'https://figma.com/design/abc?node-id=1-3' },
      { rule: 'STRUCT002', severity: 'error', nodeId: '1:4', nodePath: 'Card > Inner',
        message: 'Spacing uses raw value, not a variable.',
        deepLink: 'https://figma.com/design/abc?node-id=1-4' },
    ],
  };
  const md = formatReport(onlyStructure, META);
  assert.match(md, /\*\*Result:\*\* 2 errors, 0 warnings/);
  assert.doesNotMatch(md, /## Variable issues/);
  assert.match(md, /## Structure issues \(2\)/);
});

test('conflict without mode field renders no mode label (primitive token)', () => {
  const primitiveConflict = {
    variable: [
      { token: 'color/brand/600', status: 'conflict', figma: '#5e3aee', local: '#000000',
        deepLink: 'https://figma.com/design/abc?node-id=1-2' },
    ],
    structure: [],
  };
  const md = formatReport(primitiveConflict, META);
  // Token line should be just `color/brand/600` with no parenthesized mode label.
  assert.match(md, /`color\/brand\/600`\n/);
  assert.doesNotMatch(md, /\(light\)/);
  assert.doesNotMatch(md, /\(dark\)/);
});

test('whole-file pageGrouping produces "Page: X" headers and node-level grouping', () => {
  const md = formatReport(
    { variable: [], structure: [
      { rule: 'STRUCT001', severity: 'error', nodeId: '1:1', nodePath: 'avatar > inner', message: 'Auto-layout missing', deepLink: 'http://x', _page: 'Page 1' },
    ] },
    {
      target: 'Whole file', targetUrl: 'http://x', runAt: new Date('2026-05-10T14:00:00Z'),
      pageGrouping: [{ name: 'Page 1', nodes: [{ name: 'avatar', type: 'COMPONENT_SET', violationCount: 1 }] }],
    },
  );
  assert.match(md, /## Page: Page 1/);
  assert.match(md, /### avatar \(COMPONENT_SET\)/);
  assert.match(md, /STRUCT001/);
});

test('shadow values (objects) are JSON-stringified in the output', () => {
  const shadowFigma = { x: 0, y: 4, blur: 8, spread: 0, color: '#000000', opacity: 0.1 };
  const shadowLocal = { x: 0, y: 4, blur: 8, spread: 0, color: '#000000', opacity: 0.2 };
  const shadowViolations = {
    variable: [
      { token: 'shadow/sm', status: 'missing', figma: shadowFigma, local: null,
        deepLink: 'https://figma.com/design/abc?node-id=1-1' },
      { token: 'shadow/md', status: 'conflict', figma: shadowFigma, local: shadowLocal,
        deepLink: 'https://figma.com/design/abc?node-id=1-2' },
    ],
    structure: [],
  };
  const md = formatReport(shadowViolations, META);
  // Missing — JSON form of figma value should appear
  assert.match(md, new RegExp(JSON.stringify(shadowFigma).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Conflict — JSON form of local value should appear
  assert.match(md, new RegExp('local: `' + JSON.stringify(shadowLocal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`'));
});
