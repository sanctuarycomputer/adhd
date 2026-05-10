---
description: "Run the ADHD config wizard. Walks through producing or repairing adhd.config.ts: leader (code or figma), Figma URL (with reachability test), domains (multi-select), and optional Figma PAT setup when leader is code (detects FIGMA_PAT in shell or .env*; validates against Figma REST API; writes to .env.local if needed)."
disable-model-invocation: true
allowed-tools: Read Edit Write Bash AskUserQuestion mcp__figma__get_metadata WebFetch
---

# ADHD Config

You are running the ADHD config wizard. ADHD ("agent-driven harmonious development") keeps design tokens synchronized between this Tailwind v4 codebase and a Figma file. This skill produces a valid `adhd.config.ts` and (when `leader: "code"`) wires up a Figma personal access token (PAT) via `.env.local`.

**Authoritative spec:** `docs/superpowers/specs/2026-05-09-adhd-config-design.md` — read it if you need detail beyond what this skill provides.

The wizard is **linear**. Each phase prompts at most once, validates, and either proceeds or stops with a clear error. After the wizard completes, the user runs `/adhd:sync --dry-run` separately. The wizard never invokes sync.

## Phase 0: Detect existing config + PAT-leak preflight

## Phase 1: Leader

## Phase 2: Domains

## Phase 3: Figma URL + reachability

## Phase 4: PAT setup (only when leader = code)

## Phase 5: cssEntry auto-detect

## Phase 6: Write adhd.config.ts

## Phase 7: Report

## Reference: Common errors and fix-up guidance

## Reference: adhd.config.ts schema
