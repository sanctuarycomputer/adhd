#!/usr/bin/env node
'use strict';

/**
 * ADHD check-engine CLI.
 * Inputs (all required, passed as flags):
 *   --variable-defs <path>     JSON file with MCP get_variable_defs response
 *   --design-context <path>    JSON file with MCP get_design_context response
 *   --globals-css <path>       Path to globals.css to compare against
 *   --config <path>            Path to adhd.config.ts (for naming convention etc.)
 *   --target <label>           Human-readable target description (e.g. "Page 1 / Card")
 *   --target-url <url>         Figma deep-link to the target node
 *   --output <path>            Where to write the markdown report
 * Output:
 *   - Markdown report at --output
 *   - JSON violations on stdout (for skills to consume)
 *   - Exit 0 if no errors, 1 if any errors
 */

function main() {
  console.error('check-engine: not implemented yet');
  process.exit(2);
}

main();
