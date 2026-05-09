// adhd.config.ts — read by the ADHD skill (/adhd:sync).
// No npm package or import required; the skill validates the shape on read.

const config = {
  // Required. "code" = this repo is canonical (push to Figma).
  //           "figma" = the Figma file is canonical (pull to code).
  leader: "code" as const,

  // Required. The Figma file. Always present.
  // Replace REPLACE_WITH_FIGMA_KEY with your file's key.
  figma: {
    url: "https://www.figma.com/design/REPLACE_WITH_FIGMA_KEY/ADHD-Reference",
  },

  // Optional. Omit to sync all supported domains.
  // domains: ["colors", "spacing", "typography", "radius", "shadow"],

  // Optional. Defaults to "app/globals.css" (Next.js App Router convention).
  // cssEntry: "src/app/globals.css",
};

export default config;
