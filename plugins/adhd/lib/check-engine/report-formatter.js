'use strict';

function fmtTime(d) {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatReport({ variable = [], structure = [] }, meta) {
  // The header summarizes structural severities only; variable issues are
  // counted separately in their own "Variable issues (N)" section heading.
  // The CLI computes its own combined error total for exit-code purposes.
  const errors = structure.filter(v => v.severity === 'error').length;
  const warnings = structure.filter(v => v.severity === 'warning').length;
  const lines = [];

  lines.push('# ADHD check report');
  lines.push(`**Target:** ${meta.target}  ([open in Figma](${meta.targetUrl}))`);
  lines.push(`**Run at:** ${fmtTime(meta.runAt)}`);
  lines.push(`**Result:** ${errors} errors, ${warnings} warnings`);
  lines.push('');

  if (variable.length === 0 && structure.length === 0) {
    lines.push('No violations found.');
    return lines.join('\n');
  }

  if (variable.length > 0) {
    lines.push(`## Variable issues (${variable.length})`);
    lines.push('');
    const missing = variable.filter(v => v.status === 'missing');
    const conflicts = variable.filter(v => v.status === 'conflict');
    if (missing.length > 0) {
      lines.push(`### Missing locally (${missing.length})`);
      for (const m of missing) {
        const v = typeof m.figma === 'object' ? JSON.stringify(m.figma) : m.figma;
        lines.push(`- \`${m.token}\` → \`${v}\` ([open](${m.deepLink}))`);
      }
      lines.push('');
    }
    if (conflicts.length > 0) {
      lines.push(`### Conflicts (${conflicts.length})`);
      for (const c of conflicts) {
        const modeLabel = c.mode ? ` (${c.mode})` : '';
        const localStr = typeof c.local === 'object' ? JSON.stringify(c.local) : c.local;
        const figmaStr = typeof c.figma === 'object' ? JSON.stringify(c.figma) : c.figma;
        lines.push(`- \`${c.token}\`${modeLabel}`);
        lines.push(`  - local: \`${localStr}\``);
        lines.push(`  - figma: \`${figmaStr}\``);
        lines.push(`  - [open in Figma](${c.deepLink})`);
      }
      lines.push('');
    }
  }

  if (structure.length > 0) {
    lines.push(`## Structure issues (${structure.length})`);
    lines.push('');
    const errs = structure.filter(v => v.severity === 'error');
    const warns = structure.filter(v => v.severity === 'warning');
    if (errs.length > 0) {
      lines.push(`### Errors (${errs.length})`);
      for (const e of errs) {
        lines.push(`- **${e.rule}** — ${e.message}`);
        lines.push(`  ${e.nodePath} — [open](${e.deepLink})`);
      }
      lines.push('');
    }
    if (warns.length > 0) {
      lines.push(`### Warnings (${warns.length})`);
      for (const w of warns) {
        lines.push(`- **${w.rule}** — ${w.message}`);
        lines.push(`  ${w.nodePath} — [open](${w.deepLink})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = { formatReport };
