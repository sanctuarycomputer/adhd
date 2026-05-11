'use strict';

const AUTO_NAME_RE = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Star|Polygon)\s+\d+$/;

// Shape primitives that, as a frame's only child, fill the container via constraints
// and do not benefit from auto-layout (icons, logos, decorative backgrounds).
const SINGLE_CHILD_SHAPE_EXEMPT = new Set([
  'VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'STAR', 'POLYGON', 'LINE',
]);

// Paints are "visible" by default; only treat as hidden when explicitly false.
function isVisiblePaint(p) {
  return p && p.visible !== false;
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
  // Exempt: a frame whose ONLY child is a shape primitive (icon / logo / decorative
  // shape that fills the container via constraints). Multi-child frames and
  // single-child wrappers around TEXT / FRAME / COMPONENT / INSTANCE still fire —
  // those typically want auto-layout for padding and alignment.
  if ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
      Array.isArray(node.children) && node.children.length > 0 &&
      node.layoutMode === 'NONE') {
    const exempt = node.children.length === 1 && SINGLE_CHILD_SHAPE_EXEMPT.has(node.children[0].type);
    if (!exempt) {
      push('STRUCT001', 'error', 'Frame has children but auto-layout is not enabled.');
    }
  }

  // STRUCT002: spacing uses variables
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'];
    for (const field of spacingFields) {
      const v = node[field];
      const bound = node.boundVariables && node.boundVariables[field];
      if (typeof v === 'number' && v > 0 && !bound) {
        push('STRUCT002', 'error', `${field} is a raw value (${v}px); use a spacing variable.`);
      }
    }
  }

  // STRUCT003: visible solid colors use variables. Paints with `visible: false`
  // don't render and are excluded — Figma keeps invisible paint entries on a node
  // when the user has hidden them in the UI; enforcing variable bindings on
  // unseen paints is busywork.
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'SOLID' && isVisiblePaint(fill) && !fill.boundVariables?.color) {
        push('STRUCT003', 'error', 'Fill is a raw color; use a color variable.');
        break;
      }
    }
  }
  if (Array.isArray(node.strokes)) {
    for (const stroke of node.strokes) {
      if (stroke.type === 'SOLID' && isVisiblePaint(stroke) && !stroke.boundVariables?.color) {
        push('STRUCT003', 'error', 'Stroke is a raw color; use a color variable.');
        break;
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
  // don't render and are excluded for parity with STRUCT003.
  if (Array.isArray(node.effects)) {
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

  // STRUCT007: sibling components share a name prefix but aren't wrapped in a Component Set
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
        push('STRUCT007', 'warning',
          `${group.length} sibling components named "${prefix}/..." should be wrapped in a Component Set.`);
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
        'Component Set has no variant properties declared. Define variant axes (size, state, etc.).');
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
