// adhd.config.ts — read by the ADHD skills.
// No npm package or import required; the skills validate the shape on read.

const config = {
  // Required. The Figma file.
  figma: {
    url: "https://www.figma.com/design/PBCAkpPnvGXWrz6H7qfH3V/adhd",
  },

  // Optional. Defaults to "kebab-case". Controls /adhd:lint's STRUCT009 rule.
  naming: "kebab-case" as const,

  // Optional. Omit to sync all supported domains.
  // domains: ["colors", "spacing", "typography", "radius", "shadow"],

  // Optional. Defaults to "app/globals.css" (Next.js App Router convention).
  // cssEntry: "src/app/globals.css",
};

export default config;
