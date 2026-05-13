'use strict';

const AUTO_NAME_RE = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Star|Polygon)\s+\d+$/;

// Shape primitives that don't benefit from auto-layout (the leaves of a
// shape-only subtree).
const SHAPE_PRIMITIVE_TYPES = new Set([
  'VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'STAR', 'POLYGON', 'LINE',
]);

// Container types that the shape-only check is willing to recurse into. A
// frame containing nested frames/groups/components that themselves contain
// only shape primitives is still going to rasterize to a single SVG, so
// flexbox doesn't apply to the outer container either. Mixed content (text,
// other layouts) anywhere in the subtree breaks the exemption.
const SHAPE_SUBTREE_CONTAINER_TYPES = new Set([
  'FRAME', 'GROUP', 'COMPONENT', 'INSTANCE',
]);

// True iff `node` is a shape primitive OR a container with at least one
// child whose entire subtree is shape-only. Empty containers DON'T count —
// an empty FRAME is a placeholder, not a shape; the outer frame still needs
// auto-layout to handle it. Anything else (TEXT, COMPONENT_SET as a child,
// etc.) breaks the predicate.
function isShapeOnlySubtree(node) {
  if (SHAPE_PRIMITIVE_TYPES.has(node.type)) return true;
  if (!SHAPE_SUBTREE_CONTAINER_TYPES.has(node.type)) return false;
  if (!Array.isArray(node.children) || node.children.length === 0) return false;
  return node.children.every(isShapeOnlySubtree);
}

// Paints are "visible" by default; only treat as hidden when explicitly false.
function isVisiblePaint(p) {
  return p && p.visible !== false;
}

// Convert a Figma SOLID paint's normalized color (r/g/b each in 0..1) to
// a #RRGGBB hex literal — used in diagnostic messages so the designer
// knows exactly which color is raw, not just "some fill somewhere."
function paintToHex(paint) {
  if (!paint || !paint.color) return '?';
  const to255 = (c) => Math.round(Math.max(0, Math.min(1, c)) * 255);
  const hex = [paint.color.r, paint.color.g, paint.color.b]
    .map(to255)
    .map(n => n.toString(16).padStart(2, '0'))
    .join('');
  return '#' + hex.toUpperCase();
}

// Sentinel the serializer uses for fields where Figma returned `figma.mixed`.
// JSON.stringify drops Symbols silently, so the serializer coerces them to
// this marker string before assignment — otherwise per-range mixed paints
// would disappear from the lint surface entirely.
const MIXED = '__MIXED__';

// True if the node is FULLY bound to a paint STYLE (Figma's legacy design-
// token mechanism, distinct from variable bindings). Paint styles are valid
// design tokens, so STRUCT003 shouldn't fire on style-bound layers. A MIXED
// style id means SOME ranges are styled and some aren't — fall through to
// the fills check so unbound ranges get caught.
function hasPaintStyleBinding(node, kind) {
  const id = node[kind];
  return typeof id === 'string' && id.length > 0 && id !== MIXED;
}

function deepLink(fileKey, nodeId) {
  return 'https://figma.com/design/' + fileKey + '?node-id=' + nodeId.replace(':', '-');
}

function caseMatches(name, convention) {
  if (convention === false) return true;
  if (convention === 'kebab-case')   return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || /^[a-z0-9-/.]+$/.test(name);
  if (convention === 'PascalCase')   return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  if (convention === 'camelCase')    return /^[a-z][a-zA-Z0-9]*$/.test(name);
  return true;
}

function visit(node, ctx, parentPath, parent) {
  const nodePath = parentPath ? parentPath + ' > ' + node.name : node.name;
  ctx.violations = ctx.violations || [];
  const push = (rule, severity, message) => {
    ctx.violations.push({
      rule,
      severity,
      nodeId: node.id,
      nodePath,
      message,
      deepLink: deepLink(ctx.fileKey, node.id),
    });
  };

  // STRUCT001: auto-layout required.
  // Exempt: a frame whose entire subtree is shape-only. Covers icon / logo /
  // illustration cases including nested compositions — a frame containing
  // "light" and "dark" sub-frames, each holding only vector paths, still
  // rasterizes to one SVG and doesn't want flexbox at the outer level.
  // Mixed-content subtrees (text, instances of layout components, anything
  // that isn't a shape or shape-only container) still fire.
  if ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
      Array.isArray(node.children) && node.children.length > 0 &&
      node.layoutMode === 'NONE') {
    const allShapes = node.children.every(isShapeOnlySubtree);
    if (!allShapes) {
      push('STRUCT001', 'error', 'Frame has children but auto-layout is not enabled.');
    }
  }

  // STRUCT002: spacing uses variables.
  // Skip COMPONENT_SET wrappers — they're organizational scaffolding that doesn't
  // render in instances. Padding on a CS wrapper is editor-only.
  if (node.type !== 'COMPONENT_SET' && node.layoutMode && node.layoutMode !== 'NONE') {
    const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'];
    for (const field of spacingFields) {
      const v = node[field];
      const bound = node.boundVariables && node.boundVariables[field];
      if (typeof v === 'number' && v > 0 && !bound) {
        push('STRUCT002', 'error', `${field} is a raw value (${v}px); use a spacing variable.`);
      }
    }
  }

  // STRUCT003: visible solid colors use variables OR paint styles. Paints with
  // `visible: false` don't render and are excluded. COMPONENT_SET wrappers are
  // also skipped — they're organizational scaffolding and Figma's editor chrome
  // (the dashed-purple outline at #9747FF) lives in the wrapper's `strokes`.
  // Layers bound to a paint STYLE (legacy mechanism — `fillStyleId` /
  // `strokeStyleId`) are valid design tokens too; we don't ask the designer to
  // migrate them.
  if (node.type !== 'COMPONENT_SET' && !hasPaintStyleBinding(node, 'fillStyleId')) {
    if (node.fills === MIXED) {
      // Multi-range mixed paints — fall through from the serializer's sentinel.
      // Often a TEXT layer with per-character coloring; could be hiding raw values.
      push('STRUCT003', 'error',
        'Fills are mixed across ranges — bind each range to a color variable, or apply a paint style to the layer.');
    } else if (Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill.type === 'SOLID' && isVisiblePaint(fill) && !fill.boundVariables?.color) {
          push('STRUCT003', 'error',
            `Fill is a raw color (${paintToHex(fill)}); bind it to a color variable or apply a paint style.`);
          break;
        }
      }
    }
  }
  if (node.type !== 'COMPONENT_SET' && !hasPaintStyleBinding(node, 'strokeStyleId')) {
    if (node.strokes === MIXED) {
      push('STRUCT003', 'error',
        'Strokes are mixed across ranges — bind each range to a color variable, or apply a paint style to the layer.');
    } else if (Array.isArray(node.strokes)) {
      for (const stroke of node.strokes) {
        if (stroke.type === 'SOLID' && isVisiblePaint(stroke) && !stroke.boundVariables?.color) {
          push('STRUCT003', 'error',
            `Stroke is a raw color (${paintToHex(stroke)}); bind it to a color variable or apply a paint style.`);
          break;
        }
      }
    }
  }

  // STRUCT004: typography uses variables/styles.
  // The synthesized `style` field is one signal (synthetic fixtures use it);
  // a real Figma serialization carries `fontSize` directly on the node.
  if (node.type === 'TEXT' && (node.style || typeof node.fontSize === 'number')) {
    const hasStyleId = node.textStyleId || node.styles?.text;
    const hasBound = node.boundVariables && (
      node.boundVariables.fontSize || node.boundVariables.lineHeight || node.boundVariables.fontWeight
    );
    if (!hasStyleId && !hasBound) {
      push('STRUCT004', 'error', 'Text uses raw typography; bind a text style or typography variable.');
    }
  }

  // STRUCT005: visible effects use variables/styles.
  // An empty `boundVariables: {}` is NOT a real binding — Figma emits it on
  // unbound effects. Only a non-empty object counts. Effects with `visible: false`
  // don't render and are excluded for parity with STRUCT003. COMPONENT_SET
  // wrappers are skipped for the same reason as STRUCT002/003.
  if (node.type !== 'COMPONENT_SET' && Array.isArray(node.effects)) {
    const visibleEffects = node.effects.filter(isVisiblePaint);
    if (visibleEffects.length > 0) {
      const allBound = visibleEffects.every(e => {
        const hasBoundVars = e.boundVariables && Object.keys(e.boundVariables).length > 0;
        return hasBoundVars || node.effectStyleId;
      });
      if (!allBound) {
        push('STRUCT005', 'error', 'Effects include raw values; bind effect styles or shadow variables.');
      }
    }
  }

  // STRUCT006: no detached instances
  if (node.type === 'FRAME' && node.wasInstance === true) {
    push('STRUCT006', 'warning', 'Layer was previously an instance; was detached from its master.');
  }

  // STRUCT008: meaningful layer names
  if (AUTO_NAME_RE.test(node.name)) {
    push('STRUCT008', 'warning', `Layer is auto-named ("${node.name}"); rename for clarity.`);
  }

  // STRUCT009: naming convention applies to identifiers that flow into code as
  // names — the component name and the variant property names. It does NOT apply
  // to variant property VALUES, which are string-literal type members in
  // generated code (e.g. `type LogoColour = "light" | "dark"`) and serve as
  // user-facing labels in Figma's variant picker; casing has no codegen impact.
  if (node.type === 'COMPONENT_SET' && node.componentPropertyDefinitions) {
    for (const propName of Object.keys(node.componentPropertyDefinitions)) {
      if (!caseMatches(propName, ctx.namingConvention)) {
        push('STRUCT009', 'warning',
          `Variant property "${propName}" doesn't match ${ctx.namingConvention} convention.`);
      }
    }
  }
  // Component name itself (just the base, before "/"). Skip variant
  // COMPONENTs (children of a COMPONENT_SET) — their names are auto-derived
  // by Figma from variant properties (e.g. "size=lg, status=away") and are
  // not user-controlled, so kebab-case can't apply.
  const isVariantChild = node.type === 'COMPONENT' && parent && parent.type === 'COMPONENT_SET';
  if ((node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !parentPath?.includes(' > '))) && !isVariantChild) {
    const base = node.name.split('/')[0];
    if (!caseMatches(base, ctx.namingConvention)) {
      push('STRUCT009', 'warning',
        `Component name "${base}" doesn't match ${ctx.namingConvention} convention.`);
    }
  }

  // STRUCT007: sibling components share a name prefix but aren't wrapped in a
  // Component Set. The wording calls out the suspected variant intent and the
  // codegen consequence — a designer who organized siblings as "Logo/light"
  // and "Logo/dark" was almost certainly trying to model a variant axis, and
  // we want them to know that without the Component Set wrapper each sibling
  // becomes a separately-imported component instead of one component with
  // prop axes. Strong copy here is the difference between code gen quietly
  // doing the wrong thing and the designer fixing the source.
  if (Array.isArray(node.children) && node.type !== 'COMPONENT_SET') {
    const components = node.children.filter(c => c.type === 'COMPONENT');
    const byPrefix = {};
    for (const c of components) {
      const prefix = c.name.split('/')[0];
      byPrefix[prefix] = byPrefix[prefix] || [];
      byPrefix[prefix].push(c);
    }
    for (const [prefix, group] of Object.entries(byPrefix)) {
      if (group.length >= 2) {
        // Pull the suffix from each sibling for the message (e.g. "light", "dark").
        // Cap the displayed list at 4 and add a count suffix if there are more.
        const suffixes = group.map(c => {
          const rest = c.name.slice(prefix.length + 1); // strip "prefix/"
          return rest || c.name;
        });
        const shown = suffixes.slice(0, 4).map(s => `"${s}"`).join(', ');
        const more = suffixes.length > 4 ? `, +${suffixes.length - 4} more` : '';
        push('STRUCT007', 'warning',
          `${group.length} sibling components share the "${prefix}/" prefix (${shown}${more}). ` +
          `These look like variants of "${prefix}". Wrap them in a Component Set ` +
          `(select all → right-click → "Combine as Variants") and add a variant property — ` +
          `otherwise code generation imports them as ${group.length} separate components instead of one ` +
          `"${prefix}" component with a prop axis.`);
        break;
      }
    }
  }

  // STRUCT010: variant properties declared
  if (node.type === 'COMPONENT_SET' && Array.isArray(node.children) && node.children.length > 0) {
    const hasDefs = node.componentPropertyDefinitions &&
      Object.keys(node.componentPropertyDefinitions).length > 0;
    const allChildrenEmpty = node.children.every(
      c => c.type === 'COMPONENT' && (!c.variantProperties || Object.keys(c.variantProperties).length === 0),
    );
    if (!hasDefs && allChildrenEmpty) {
      push('STRUCT010', 'error',
        `Component Set has ${node.children.length} variant(s) but no variant property declared. ` +
        `Add one in the Figma Properties panel (e.g. theme = light | dark, size = sm | md | lg) — ` +
        `without it, code generation can't tell the variants apart and will import them as ${node.children.length} separate components.`);
    }
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visit(child, ctx, nodePath, node);
    }
  }
}

function checkStructure(rootNode, opts) {
  const ctx = {
    fileKey: opts.fileKey,
    namingConvention: opts.namingConvention ?? 'kebab-case',
    violations: [],
  };
  visit(rootNode, ctx, '', null);
  return ctx.violations;
}

module.exports = { checkStructure };
