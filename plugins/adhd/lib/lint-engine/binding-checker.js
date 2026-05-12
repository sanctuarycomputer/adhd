'use strict';

// Per-layer binding rules.
//
// STRUCT011 (variable naming) and STRUCT012 (cross-domain bindings) both
// need to know which Figma variable each layer binds. The structure-checker
// can't do it on its own because the node-level boundVariables reference
// variables by Figma ID — the lint engine needs an ID→name lookup
// (`varIdMap`) to bridge to the same names the variable-namer reasons about.
//
// STRUCT011 emission was historically aggregated onto the scope root (or
// suppressed in whole-file mode). That made annotations cluster on a
// single layer even when 10 frames were using the bad variable —
// designers had to read the message, then hunt for the offending layers
// themselves. Per-layer emission flips this: each layer that uses a bad
// variable gets its own annotation, contextualized to where it's used.
//
// STRUCT012 covers the cross-domain case the older rules missed — a
// designer binding e.g. `Spacing/4` to `letterSpacing`. The variable name
// is fine on its own (so STRUCT011 stays quiet), but the binding is
// semantically wrong: in Tailwind's domain model, spacing and tracking are
// distinct token sets and shouldn't share variables. We infer the
// variable's intended domain from its name (same logic as the namer's
// suggestion) and compare to the expected domain for the property.

const { suggestTargetName, normalizeCollectionName, classifyDomain, TIER_COLLECTIONS } = require('./variable-namer');

// Figma `boundVariables` property name → Tailwind v4 domain.
//
// Properties that don't classify cleanly are intentionally absent — we
// can't fire STRUCT012 without an expected domain. Width / height could
// arguably map to `spacing` (Tailwind reuses the spacing scale for
// sizing) but in practice designers often use other scales there; we'd
// rather under-report than false-positive. Add entries when real cases
// surface.
const PROPERTY_TO_DOMAIN = {
  fontSize: 'text',
  fontWeight: 'font-weight',
  letterSpacing: 'tracking',
  lineHeight: 'leading',
  fontFamily: 'font',
  fontStyle: 'font',
  paddingTop: 'spacing',
  paddingRight: 'spacing',
  paddingBottom: 'spacing',
  paddingLeft: 'spacing',
  itemSpacing: 'spacing',
  cornerRadius: 'radius',
  topLeftRadius: 'radius',
  topRightRadius: 'radius',
  bottomLeftRadius: 'radius',
  bottomRightRadius: 'radius',
  // Synthesized for fills/strokes — Figma stores these bindings on each
  // paint object's own boundVariables rather than at the node level, so
  // we walk fills/strokes separately and pass these as the property name.
  'fills[].color': 'color',
  'strokes[].color': 'color',
};

// Variable-name → inferred Tailwind domain. Returns the domain string
// (e.g. 'color', 'spacing') or null if uncertain. Delegates to
// `suggestTargetName` so the resolution order stays in one place:
//   1. Collection IS a domain (or its synonym) → that's the domain.
//   2. Collection is a TIER (Primitives, Semantic, …) → first rest segment.
//   3. Unknown collection → walk rest looking for a domain segment.
//   4. Ambiguous or no-mapping → null (don't false-positive STRUCT012).
function inferDomain(name) {
  if (!name || typeof name !== 'string') return null;
  const result = suggestTargetName(name);
  if (result.kind !== 'ok' && result.kind !== 'rename') return null;
  const target = result.kind === 'ok' ? name : result.target;
  const [collection, ...rest] = target.split('/');
  const collNorm = normalizeCollectionName(collection);
  const c = classifyDomain(collNorm);
  if (c.kind === 'known') return collNorm;
  if (c.kind === 'synonym') return c.suggestion;
  if (TIER_COLLECTIONS.has(collNorm) && rest.length > 0) {
    const d = classifyDomain(rest[0]);
    if (d.kind === 'known') return rest[0].toLowerCase();
    if (d.kind === 'synonym') return d.suggestion;
  }
  return null;
}

function deepLink(fileKey, nodeId) {
  return 'https://figma.com/design/' + fileKey + '?node-id=' + nodeId.replace(':', '-');
}

function formatPerLayerSuggestion(varName, suggestion, prop) {
  if (suggestion.kind === 'rename') {
    const targetCollection = suggestion.target.split('/')[0];
    return `Layer uses "${varName}" (bound to ${prop}). ` +
      `Move to "${targetCollection}" collection → final name "${suggestion.target}". ` +
      `In Figma: right-click the variable → "Move to..." → pick "${targetCollection}". ` +
      `Figma auto-rewires references.`;
  }
  if (suggestion.kind === 'ambiguous') {
    return `Layer uses "${varName}" (bound to ${prop}). Ambiguous target — ` +
      `${suggestion.primaryReason}, but ${suggestion.alternateReason}. ` +
      `Pick based on actual usage: primary → ${suggestion.target}, alternate → ${suggestion.alternate}.`;
  }
  if (suggestion.kind === 'no-mapping') {
    return `Layer uses "${varName}" (bound to ${prop}). ${suggestion.reason}`;
  }
  return `Layer uses "${varName}" (bound to ${prop}).`;
}

function walk(node, parentPath, visitor) {
  const nodePath = parentPath ? parentPath + ' > ' + node.name : node.name;
  visitor(node, nodePath);
  if (Array.isArray(node.children)) {
    for (const c of node.children) walk(c, nodePath, visitor);
  }
}

// Walks `rootNode` and emits per-layer STRUCT011 / STRUCT012 violations.
//
// `opts.varIdMap`: { '<VariableID>': '<collection>/<name>' }. Without it
// (no per-binding name lookup) neither rule can fire — caller falls back
// to the legacy aggregated STRUCT011 emission instead.
//
// `opts.badSuggestionsByName`: { '<name>': suggestion } from
// `buildVariableSuggestions`. STRUCT011 fires per-layer for each binding
// whose variable name appears here.
//
// Violations are deduped per (rule, varName) within a node — a layer that
// binds the same bad variable to both `fills.color` and `strokes.color`
// gets ONE annotation, not two. Different variables on the same layer
// still produce separate violations.
function checkBindings(rootNode, opts) {
  const out = [];
  const varIdMap = opts.varIdMap || {};
  const badSuggestions = opts.badSuggestionsByName || {};
  const fileKey = opts.fileKey;

  walk(rootNode, '', (node, nodePath) => {
    const seen = new Set();
    const push = (rule, severity, varName, message) => {
      const key = rule + '::' + varName;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        rule, severity,
        nodeId: node.id, nodePath, message,
        deepLink: deepLink(fileKey, node.id),
      });
    };

    const handleBinding = (prop, alias) => {
      if (!alias || !alias.id) return;
      const varName = varIdMap[alias.id];
      if (!varName) return;

      const suggestion = badSuggestions[varName];
      if (suggestion) {
        push('STRUCT011', 'warning', varName,
          formatPerLayerSuggestion(varName, suggestion, prop));
      }

      const expectedDomain = PROPERTY_TO_DOMAIN[prop];
      if (expectedDomain) {
        const varDomain = inferDomain(varName);
        if (varDomain && varDomain !== expectedDomain) {
          push('STRUCT012', 'error', varName,
            `Layer binds "${varName}" (a ${varDomain} variable) to ${prop}, ` +
            `which expects a ${expectedDomain} variable. ` +
            `Bind a ${expectedDomain}-domain variable instead — or, if you want both ` +
            `domains to share a value, create a ${expectedDomain} variable that ` +
            `aliases the same primitive.`);
        }
      }
    };

    if (node.boundVariables && typeof node.boundVariables === 'object') {
      for (const [prop, alias] of Object.entries(node.boundVariables)) {
        // fills / strokes / effects arrive as arrays of per-paint bindings
        // (handled below) — the top-level entry is empty or a stale alias
        // shape Figma leaves around.
        if (prop === 'fills' || prop === 'strokes' || prop === 'effects') continue;
        handleBinding(prop, alias);
      }
    }
    if (Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        const alias = fill && fill.boundVariables && fill.boundVariables.color;
        if (alias) handleBinding('fills[].color', alias);
      }
    }
    if (Array.isArray(node.strokes)) {
      for (const stroke of node.strokes) {
        const alias = stroke && stroke.boundVariables && stroke.boundVariables.color;
        if (alias) handleBinding('strokes[].color', alias);
      }
    }
  });

  return out;
}

module.exports = { checkBindings, inferDomain, PROPERTY_TO_DOMAIN };
