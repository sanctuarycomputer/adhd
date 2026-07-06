import type { Violation } from "../rules/struct";
import type { Drift } from "./diff";
import type { OffSystemFinding } from "../rules/off-system";

export interface LintResult {
  violations: Violation[];
  drift: Drift | null;
  offSystem: OffSystemFinding[];
  meta: { target: string; targetUrl: string | null; mode: "live" | "offline"; lockPresent: boolean };
}

// Renames, off-system findings, and cannotSync entries are all warnings —
// none of them represent a definite defect the way a struct-lint error or a
// value/existence/structural drift does; they're heuristics or informational
// notes a human should look at, not a build-breaking condition.
export function errorCount(r: LintResult): number {
  const violationErrors = r.violations.filter((v) => v.severity === "error").length;
  const driftErrors = r.drift ? r.drift.valueDrift.length + r.drift.existence.length + r.drift.structural.length : 0;
  return violationErrors + driftErrors;
}

function warningCount(r: LintResult): number {
  const violationWarnings = r.violations.filter((v) => v.severity === "warning").length;
  const driftWarnings = r.drift ? r.drift.renames.length + r.drift.cannotSync.length : 0;
  return violationWarnings + driftWarnings + r.offSystem.length;
}

export function formatReport(r: LintResult): string {
  const lines: string[] = [];

  lines.push("# ADHD lint report");
  lines.push(`**Target:** ${r.meta.target}${r.meta.targetUrl ? ` ([open in Figma](${r.meta.targetUrl}))` : ""}`);
  lines.push(`**Mode:** ${r.meta.mode}`);
  lines.push(`**Result:** ${errorCount(r)} errors, ${warningCount(r)} warnings`);

  const hasAnything =
    r.violations.length > 0 ||
    (r.drift !== null &&
      (r.drift.valueDrift.length > 0 ||
        r.drift.existence.length > 0 ||
        r.drift.structural.length > 0 ||
        r.drift.renames.length > 0 ||
        r.drift.cannotSync.length > 0)) ||
    r.offSystem.length > 0;

  if (!hasAnything) {
    lines.push("");
    lines.push("No issues found.");
    maybeAppendNoLockNote(lines, r);
    return lines.join("\n");
  }

  appendStructureSection(lines, r.violations);
  appendDriftSection(lines, r.drift);
  appendRenamesSection(lines, r.drift);
  appendOffSystemSection(lines, r.offSystem);
  appendCannotSyncSection(lines, r.drift);
  maybeAppendNoLockNote(lines, r);

  return lines.join("\n");
}

function maybeAppendNoLockNote(lines: string[], r: LintResult): void {
  if (r.meta.lockPresent) return;
  lines.push("");
  lines.push(
    "> No adhd.lock.json — drift is two-way (cannot attribute changes to a side); renames are heuristic.",
  );
}

function appendStructureSection(lines: string[], violations: Violation[]): void {
  if (violations.length === 0) return;

  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    const group = byRule.get(v.rule);
    if (group) group.push(v);
    else byRule.set(v.rule, [v]);
  }

  lines.push("");
  lines.push("## Structure");
  for (const [rule, group] of byRule) {
    const severity = group[0]!.severity;
    lines.push("");
    lines.push(`### ${rule} — ${severity} (${group.length})`);
    for (const v of group) {
      lines.push(`- ${v.message}`);
      lines.push(`  ${v.nodePath} — [open](${v.deepLink})`);
    }
  }
}

function appendDriftSection(lines: string[], drift: Drift | null): void {
  if (!drift) return;
  if (drift.valueDrift.length === 0 && drift.existence.length === 0 && drift.structural.length === 0) return;

  lines.push("");
  lines.push("## Drift");

  if (drift.valueDrift.length > 0) {
    lines.push("");
    lines.push(`### Value drift (${drift.valueDrift.length})`);
    for (const d of drift.valueDrift) {
      lines.push(`- \`${d.path}\` [${d.collection}] (${d.mode}): code \`${d.code}\` vs figma \`${d.figma}\``);
    }
  }

  if (drift.existence.length > 0) {
    lines.push("");
    lines.push(`### Existence (${drift.existence.length})`);
    for (const e of drift.existence) {
      lines.push(`- \`${e.path}\` [${e.collection}] only in ${e.onlyIn} — ${e.value}`);
    }
  }

  if (drift.structural.length > 0) {
    lines.push("");
    lines.push(`### Structural (${drift.structural.length})`);
    for (const s of drift.structural) {
      lines.push(`- \`${s.path}\` (${s.mode}) ${s.kind}: code \`${s.code}\` vs figma \`${s.figma}\``);
    }
  }
}

function appendRenamesSection(lines: string[], drift: Drift | null): void {
  if (!drift || drift.renames.length === 0) return;

  lines.push("");
  lines.push("## Likely renames");
  for (const rn of drift.renames) {
    lines.push(`- \`${rn.from}\` → \`${rn.to}\` (${rn.confidence})`);
  }
}

function appendOffSystemSection(lines: string[], offSystem: OffSystemFinding[]): void {
  if (offSystem.length === 0) return;

  lines.push("");
  lines.push("## Off-system values in code");
  for (const f of offSystem) {
    let entry = `- ${f.file}:${f.line} \`${f.snippet}\``;
    if (f.nearestToken) {
      entry += f.nearestToken.exact ? ` → use \`${f.nearestToken.path}\`` : ` → close to \`${f.nearestToken.path}\``;
    }
    lines.push(entry);
  }
}

function appendCannotSyncSection(lines: string[], drift: Drift | null): void {
  if (!drift || drift.cannotSync.length === 0) return;

  lines.push("");
  lines.push("## Cannot sync");
  for (const c of drift.cannotSync) {
    lines.push(`- \`${c.path}\` (${c.side}): ${c.reason}`);
  }
}
