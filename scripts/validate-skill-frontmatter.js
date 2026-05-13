#!/usr/bin/env node
'use strict';

/**
 * Validate that every plugin SKILL.md has the required frontmatter shape.
 *
 * Required keys:
 *   - description: single-line string
 *   - disable-model-invocation: boolean (true | false)
 *   - allowed-tools: space-separated string
 *
 * Optional keys (allowed but not required):
 *   - argument-hint: string
 *
 * Run: node scripts/validate-skill-frontmatter.js
 * Exit codes: 0 = all valid; 1 = at least one issue found.
 */

const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.resolve(__dirname, '..', 'plugins', 'adhd', 'skills');

function findSkillFiles() {
  const out = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (fs.existsSync(skillPath)) out.push(skillPath);
  }
  return out;
}

function parseFrontmatter(text) {
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fmMatch) throw new Error('No frontmatter found');
  const lines = fmMatch[1].split('\n');
  const obj = {};
  for (const line of lines) {
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    // Strip quotes for quoted strings.
    if (/^"(.*)"$/.test(value)) value = value.slice(1, -1);
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    obj[key] = value;
  }
  return obj;
}

function validate(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  let fm;
  try { fm = parseFrontmatter(text); } catch (e) { issues.push(e.message); return issues; }
  if (typeof fm.description !== 'string' || fm.description.length === 0) {
    issues.push('description: must be a non-empty string');
  } else if (fm.description.includes('\n')) {
    issues.push('description: must be single-line');
  }
  if (typeof fm['disable-model-invocation'] !== 'boolean') {
    issues.push('disable-model-invocation: must be true or false');
  }
  if (typeof fm['allowed-tools'] !== 'string' || fm['allowed-tools'].length === 0) {
    issues.push('allowed-tools: must be a non-empty space-separated string');
  }
  return issues;
}

function main() {
  let total = 0;
  let failed = 0;
  for (const file of findSkillFiles()) {
    total++;
    const issues = validate(file);
    if (issues.length > 0) {
      failed++;
      console.error(`FAIL ${path.relative(process.cwd(), file)}`);
      for (const issue of issues) console.error(`  - ${issue}`);
    } else {
      console.log(`OK   ${path.relative(process.cwd(), file)}`);
    }
  }
  console.log(`\n${total - failed}/${total} skills valid.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
