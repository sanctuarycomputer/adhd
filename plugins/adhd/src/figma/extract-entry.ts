import { runExtract, type FigmaLike } from "./extract";

// Bundling entry point only — never imported by tests (tests import runExtract from
// ./extract directly). The CLI (Task 12) text-replaces "__ADHD_ARGS__" with a JSON
// literal before shipping this bundle into a Figma script host, so this file is never
// syntactically valid on its own (JSON.parse("__ADHD_ARGS__") throws) — that's fine,
// it's not meant to run outside that substitution.
declare const figma: FigmaLike;

(async () => {
  const args = JSON.parse("__ADHD_ARGS__");
  return runExtract(figma, args);
})();
