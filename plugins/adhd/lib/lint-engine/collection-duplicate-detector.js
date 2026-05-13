'use strict';

// STRUCT014 — Figma file has multiple collections that alias to the
// same canonical domain. The classic case: designer's "Color" collection
// + an older push's "color" (lowercase) collection sitting side-by-side,
// each holding some variables. The alias-aware push fix prevents new
// duplicates from forming, but pre-existing ones need active consolidation.
//
// Detection works from the variable name list alone — every variable
// key from the SKILL's `varDefs` is `<collection>/<rest>`, so collecting
// distinct first segments gives us every collection in the file. We
// reuse the alias table from figma-write-script so collection-name
// matching stays consistent with push-tokens.

const { COLLECTION_ALIASES } = require('../design-system/figma-write-script');

// Canonical mapping: lowercase+trimmed Figma name → canonical domain.
// Built once per call (the alias table is small).
function buildCanonicalLookup() {
  const out = new Map();
  for (const [canonical, aliases] of Object.entries(COLLECTION_ALIASES)) {
    for (const a of aliases) out.set(a, canonical);
  }
  return out;
}

// Given an array of Figma variable names like ["Color/zinc-500",
// "color/red-500", "Radius/sm", "radius/lg"], return an array of
// duplicate groups: { canonical, collections: [{ name, varCount }] }.
// Only groups with 2+ collections appear. Order within a group: most
// variables first (so the --fix wizard surfaces the natural "keep this
// one" suggestion at the top).
function detectDuplicateCollections(varNames) {
  if (!Array.isArray(varNames)) return [];
  const lookup = buildCanonicalLookup();

  // Bucket varNames by collection name (first segment).
  const collections = new Map();
  for (const name of varNames) {
    const slash = name.indexOf('/');
    if (slash < 0) continue;
    const coll = name.slice(0, slash);
    collections.set(coll, (collections.get(coll) || 0) + 1);
  }

  // Group collections by their canonical domain.
  const byCanonical = new Map();
  for (const [collName, varCount] of collections) {
    const canonical = lookup.get(collName.toLowerCase().trim());
    if (!canonical) continue;
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, []);
    byCanonical.get(canonical).push({ name: collName, varCount });
  }

  const groups = [];
  for (const [canonical, members] of byCanonical) {
    if (members.length < 2) continue;
    members.sort((a, b) => b.varCount - a.varCount || a.name.localeCompare(b.name));
    groups.push({ canonical, collections: members });
  }
  // Sort groups for deterministic output.
  groups.sort((a, b) => a.canonical.localeCompare(b.canonical));
  return groups;
}

module.exports = { detectDuplicateCollections };
