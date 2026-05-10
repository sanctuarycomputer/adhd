'use strict';

const AUTO_NAME_RE = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Star|Polygon)\s+\d+$/;

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

function visit(node, ctx, parentPath) {
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

  // STRUCT001: auto-layout required
  if ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
      Array.isArray(node.children) && node.children.length > 0 &&
      node.layoutMode === 'NONE') {
    push('STRUCT001', 'error', 'Frame has children but auto-layout is not enabled.');
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

  // STRUCT003: colors use variables
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'SOLID' && !fill.boundVariables?.color) {
        push('STRUCT003', 'error', 'Fill is a raw color; use a color variable.');
        break;
      }
    }
  }
  if (Array.isArray(node.strokes)) {
    for (const stroke of node.strokes) {
      if (stroke.type === 'SOLID' && !stroke.boundVariables?.color) {
        push('STRUCT003', 'error', 'Stroke is a raw color; use a color variable.');
        break;
      }
    }
  }

  // STRUCT004: typography uses variables/styles
  if (node.type === 'TEXT' && node.style) {
    const hasStyleId = node.textStyleId || node.styles?.text;
    const hasBound = node.boundVariables && (
      node.boundVariables.fontSize || node.boundVariables.lineHeight || node.boundVariables.fontWeight
    );
    if (!hasStyleId && !hasBound) {
      push('STRUCT004', 'error', 'Text uses raw typography; bind a text style or typography variable.');
    }
  }

  // STRUCT005: effects use variables/styles
  if (Array.isArray(node.effects) && node.effects.length > 0) {
    const allBound = node.effects.every(e => e.boundVariables || node.effectStyleId);
    if (!allBound) {
      push('STRUCT005', 'error', 'Effects include raw values; bind effect styles or shadow variables.');
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

  // STRUCT009: naming convention (component, variant prop names, variant prop values)
  if (node.type === 'COMPONENT_SET' && node.componentPropertyDefinitions) {
    for (const propName of Object.keys(node.componentPropertyDefinitions)) {
      if (!caseMatches(propName, ctx.namingConvention)) {
        push('STRUCT009', 'warning',
          `Variant property "${propName}" doesn't match ${ctx.namingConvention} convention.`);
      }
      const def = node.componentPropertyDefinitions[propName];
      if (def.variantOptions) {
        for (const val of def.variantOptions) {
          if (!caseMatches(val, ctx.namingConvention)) {
            push('STRUCT009', 'warning',
              `Variant value "${val}" of property "${propName}" doesn't match ${ctx.namingConvention} convention.`);
          }
        }
      }
    }
  }
  // Component name itself (just the base, before "/")
  if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !parentPath?.includes(' > '))) {
    const base = node.name.split('/')[0];
    if (!caseMatches(base, ctx.namingConvention)) {
      push('STRUCT009', 'warning',
        `Component name "${base}" doesn't match ${ctx.namingConvention} convention.`);
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
      visit(child, ctx, nodePath);
    }
  }
}

function checkStructure(rootNode, opts) {
  const ctx = {
    fileKey: opts.fileKey,
    namingConvention: opts.namingConvention ?? 'kebab-case',
    violations: [],
  };
  visit(rootNode, ctx, '');
  return ctx.violations;
}

module.exports = { checkStructure };
