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

Resolve the path: `adhd.config.ts` at the repo root. Use `Read` to load it. There are three branches:

**Branch A — File exists and is well-formed.** Treat it as the source of defaults the user can accept by hitting Enter on later prompts. Continue to the preflight scan below.

**Branch B — File exists but is malformed** (parse fails, or required keys missing). Print: `Found adhd.config.ts but could not parse it. The wizard will re-create it from scratch; existing values will not be used as defaults.` Continue without defaults.

**Branch C — File does not exist.** Continue without defaults.

### PAT-leak preflight (always runs in Branches A and B)

Before parsing the config for defaults, scan the raw source text of `adhd.config.ts` for anything that looks like a literal Figma PAT. Run two regex checks against the file's text:

1. `figd_[A-Za-z0-9_-]+` — Figma's standard PAT prefix; strongest signal.
2. Any string longer than 24 characters assigned to a key literally named `pat`, `token`, or `secret`. (Heuristic: match `(pat|token|secret)\s*:\s*"[^"]{24,}`.)

If either matches, **abort the wizard immediately** with this exact message:

```
Looks like a Figma PAT is committed to adhd.config.ts. This is a credential leak.

Remove it from the config and store it as FIGMA_PAT in either:
  • .env.local in the repo root (gitignored), or
  • your shell environment (e.g., export FIGMA_PAT=... in ~/.zshrc).

Then re-run /adhd:config.
```

Do not proceed to Phase 1.

### Parse defaults (Branch A only)

For Branch A, extract these fields with targeted regex (the file is a plain TypeScript literal, no imports):
- `leader:` → string, expected `"code"` or `"figma"`
- `figma.url:` → string
- `figma.pat:` (optional) → string env var name
- `domains:` (optional) → array of strings
- `cssEntry:` (optional) → string path

Pass these forward as defaults for Phases 1, 2, 3, 4, and 5.

## Phase 1: Leader

## Phase 2: Domains

## Phase 3: Figma URL + reachability

## Phase 4: PAT setup (only when leader = code)

## Phase 5: cssEntry auto-detect

## Phase 6: Write adhd.config.ts

## Phase 7: Report

## Reference: Common errors and fix-up guidance

## Reference: adhd.config.ts schema
