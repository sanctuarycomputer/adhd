import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const check = process.argv.includes("--check");

async function bundle(entry, outfile, opts = {}) {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
    ...opts,
  });
  return r.outputFiles[0].text;
}

mkdirSync("dist", { recursive: true });

const cli = "#!/usr/bin/env node\n" + (await bundle("src/cli.ts", "dist/adhd.js"));
// Figma-side scripts: bundled for a plain JS runtime (no node builtins allowed).
// Entries are added here as they are created (Task 7 adds extract).
const scripts = {};
if (existsSync("src/figma/extract-entry.ts")) {
  scripts.extract = await bundle("src/figma/extract-entry.ts", null, { platform: "neutral" });
}

const outputs = {
  "dist/adhd.js": cli,
  "dist/figma-scripts.json": JSON.stringify(scripts, null, 2),
  // The dev package is ESM ("type": "module"); the bundle is CJS. This marker
  // makes node treat dist/*.js as CommonJS.
  "dist/package.json": JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
};
let stale = false;
for (const [path, content] of Object.entries(outputs)) {
  if (check) {
    let current = null;
    try { current = readFileSync(path, "utf8"); } catch {}
    if (current !== content) { console.error(`STALE: ${path} — run 'node build.mjs' and commit`); stale = true; }
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
}
if (check && stale) process.exit(1);
