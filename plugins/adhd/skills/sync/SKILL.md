---
description: "Sync design tokens between this Tailwind v4 codebase and the configured Figma file. Reads adhd.config.ts at the repo root. Supports --dry-run (read-only diff) and --domains <comma,separated> (limit to specific domains: colors, spacing, typography, radius, shadow)."
disable-model-invocation: true
argument-hint: "[--dry-run] [--domains <comma,separated>]"
allowed-tools: Read Edit Write Bash mcp__figma__get_metadata mcp__figma__get_variable_defs mcp__figma__get_design_context
---

# ADHD Sync

You are running the ADHD design-token sync workflow. ADHD ("agent-driven harmonious development") keeps design tokens synchronized between this Tailwind v4 codebase (`globals.css`) and a Figma file via a leader-follower model defined in `adhd.config.ts`.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-token-sync-design.md` — read it if you need detail beyond what this skill provides.

## Argument parsing

Parse `$ARGUMENTS`:
- `--dry-run` flag (boolean) — if present, run phases 1–4 only (validate → read → diff → display) and stop without applying changes.
- `--domains <list>` flag — optional comma-separated subset of supported domains. If absent, use all domains from the config (or all five supported domains if the config doesn't restrict).

## Phase 1: Validate

(filled in Task 4)

## Phase 2: Read code-side tokens

(filled in Task 4)

## Phase 3: Read Figma tokens

(filled in Task 4)

## Phase 4: Compute and display diff

(filled in Task 4)

## Phase 5: Confirm (skip if --dry-run)

(filled in Task 4)

## Phase 6: Apply (skip if --dry-run)

(filled in Task 4)

## Phase 7: Verify (skip if --dry-run)

(filled in Task 4)

## Phase 8: Report

(filled in Task 4)

## Reference: Mandated Figma structure

(filled in Task 4)

## Reference: CSS variable name mappings

(filled in Task 4)

## Reference: Common errors and fix-up guidance

(filled in Task 4)
