import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AdhdError } from "./core/config";
import { runLint } from "./pipelines/lint";
import { formatReport, errorCount } from "./pipelines/report";

const [, , command, ...rest] = process.argv;

export function fail(message: string, fixup?: string): never {
  console.error(`✗ ${message}`);
  if (fixup) console.error(`  → ${fixup}`);
  process.exit(1);
}

// Operational/usage failures inside a registered subcommand (bad config, bad
// args, unreadable chunks, mismatched --scope, …) exit 2 — distinct from
// fail()'s exit 1, which is reserved for "no such top-level command at all".
function failOp(message: string, fixup?: string): never {
  console.error(`✗ ${message}`);
  if (fixup) console.error(`  → ${fixup}`);
  process.exit(2);
}

const commands: Record<string, (args: string[]) => Promise<void>> = {};

commands["figma-script"] = async (args) => {
  const [sub, ...subArgs] = args;
  const usage = "usage: figma-script extract [--cursor <cursor>]";
  if (sub !== "extract") {
    failOp(`figma-script: unknown subcommand "${sub ?? "(none)"}"`, usage);
  }

  let cursor: string | undefined;
  try {
    const { values } = parseArgs({
      args: subArgs,
      options: { cursor: { type: "string" } },
      strict: true,
    });
    cursor = values.cursor as string | undefined;
  } catch (e: any) {
    failOp(`figma-script extract: ${e.message}`, usage);
  }

  // Read dist/figma-scripts.json relative to THIS file's own location
  // (dist/ once bundled), not the caller's cwd — the CLI must work the same
  // whether invoked from a consumer repo or anywhere else.
  const scriptsPath = join(__dirname, "figma-scripts.json");
  let scripts: Record<string, string>;
  try {
    scripts = JSON.parse(readFileSync(scriptsPath, "utf-8"));
  } catch {
    failOp(`figma-script: could not read ${scriptsPath}`, "run `node build.mjs` in plugins/adhd to (re)generate dist/");
  }
  const template = scripts.extract;
  if (!template) {
    failOp(`figma-script: no "extract" script bundled in ${scriptsPath}`, "run `node build.mjs` in plugins/adhd to (re)generate dist/");
  }

  // The bundled script contains the literal source `JSON.parse("__ADHD_ARGS__")`.
  // Replace the quoted placeholder with a JSON-stringified JSON string of the
  // real args so JSON.parse recovers `{ cursor }` at runtime — i.e. the
  // replacement text is JSON.stringify(JSON.stringify({ cursor })). A
  // function replacer (not a string pattern) sidesteps String.replace's
  // special `$`-sequence handling in case a cursor value ever contained one.
  const argsJson = JSON.stringify({ cursor: cursor ?? null });
  const replacement = JSON.stringify(argsJson);
  const script = template.replace('"__ADHD_ARGS__"', () => replacement);
  console.log(script);
};

commands.lint = async (args) => {
  const usage = "usage: lint --dir <dir> (--figma-chunks <dir> | --offline) [--scope <url>] --out <file> [--check]";

  let values: { [key: string]: string | boolean | undefined };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        dir: { type: "string" },
        "figma-chunks": { type: "string" },
        offline: { type: "boolean" },
        scope: { type: "string" },
        out: { type: "string" },
        check: { type: "boolean" },
      },
      strict: true,
    }) as { values: { [key: string]: string | boolean | undefined } });
  } catch (e: any) {
    failOp(`lint: ${e.message}`, usage);
  }

  const dir = values.dir as string | undefined;
  const out = values.out as string | undefined;
  const chunksDir = values["figma-chunks"] as string | undefined;
  const offline = values.offline === true;
  const scope = values.scope as string | undefined;
  const check = values.check === true;

  if (!dir || !out) failOp("lint: --dir and --out are required", usage);
  if (Boolean(chunksDir) === offline) {
    // Both set, or neither set — exactly one is required.
    failOp("lint: exactly one of --figma-chunks or --offline is required", usage);
  }

  let result;
  try {
    result = await runLint({ dir, chunksDir, offline, scopeUrl: scope });
  } catch (e) {
    if (e instanceof AdhdError) failOp(e.message, e.fixup);
    throw e;
  }

  const report = formatReport(result);
  writeFileSync(out, report, "utf-8");

  // Reuse formatReport's own "**Result:** N errors, M warnings" line for
  // stdout rather than recomputing warning counts here — keeps the printed
  // summary byte-identical to what's in the report.
  const resultLine = report.split("\n").find((l) => l.startsWith("**Result:**"));
  console.log(resultLine ? resultLine.replace(/^\*\*Result:\*\*\s*/, "") : `${errorCount(result)} errors`);

  if (check && errorCount(result) > 0) process.exit(1);
};

async function main() {
  const handler = command ? commands[command] : undefined;
  if (!handler) fail(`Unknown command: ${command ?? "(none)"}`, "Available: figma-script, lint");
  await handler(rest);
}
main();
