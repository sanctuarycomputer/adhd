'use strict';

const crypto = require('node:crypto');

// Fields whose value affects what's visible on the canvas.
const RELEVANT = [
  'type', 'width', 'height',
  'layoutMode', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'itemSpacing', 'cornerRadius', 'topLeftRadius', 'topRightRadius',
  'bottomLeftRadius', 'bottomRightRadius',
  'fills', 'strokes', 'effects',
  'characters', 'fontSize', 'fontName', 'lineHeight',
];

function normalize(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(normalize);
  const out = {};
  // Apply the whitelist at the node level only; keep nested property values
  // verbatim so structures like fills[0].color survive into the signature.
  for (const key of RELEVANT) {
    if (key in node) out[key] = node[key];
  }
  // Children preserve order (replacing one child for another DOES change visuals)
  if (Array.isArray(node.children)) out.children = node.children.map(normalize);
  return out;
}

function visualSignature(node) {
  const json = JSON.stringify(normalize(node));
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

module.exports = { visualSignature, normalize };
