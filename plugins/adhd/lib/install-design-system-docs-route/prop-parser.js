'use strict';

const TYPE_ALIAS_RE = /export\s+type\s+([A-Z][A-Za-z0-9]*)\s*=\s*([^;]+);/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+([A-Z][A-Za-z0-9]*Props)\s*\{([\s\S]*?)\}/;
const TYPE_PROPS_RE = /(?:export\s+)?type\s+([A-Z][A-Za-z0-9]*Props)\s*=\s*\{([\s\S]*?)\}/;
const EXPORT_FN_RE = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)\s*\(/;
const PROP_LINE_RE = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)(\?)?\s*:\s*([^;,]+)[;,]?\s*$/;

function parseLiteralUnion(typeText) {
  const trimmed = typeText.trim();
  if (!/^"[^"]*"(\s*\|\s*"[^"]*")*$/.test(trimmed)) return null;
  return trimmed.split('|').map(s => {
    const m = /"([^"]*)"/.exec(s.trim());
    return m ? m[1] : null;
  }).filter(Boolean);
}

function classify(typeText, knownUnions) {
  const t = typeText.trim();
  const inline = parseLiteralUnion(t);
  if (inline) return { type: 'union', values: inline };
  if (knownUnions[t]) return { type: 'union', unionName: t, values: knownUnions[t] };
  if (/^\([^)]*\)\s*=>/.test(t)) return { type: 'function' };
  if (/^(?:React\.)?Ref(?:Object|Callback|MutableRefObject)?</.test(t)) return { type: 'ref' };
  if (/^(?:React\.)?(?:ReactNode|ReactElement|ReactChild)$/.test(t)) return { type: 'reactnode' };
  if (/^JSX\.Element$/.test(t)) return { type: 'reactnode' };
  if (/^(?:React\.)?ReactElement<.*>$/.test(t)) return { type: 'reactnode' };
  if (t === 'string') return { type: 'string' };
  if (t === 'number') return { type: 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  if (/\[\]$/.test(t) || /^Array</.test(t) || /^ReadonlyArray</.test(t)) return { type: 'array' };
  if (/^\{.*\}$/.test(t)) return { type: 'object' };
  return { type: 'unknown' };
}

function parseProps(source) {
  // Pass 1: collect known unions
  const knownUnions = {};
  TYPE_ALIAS_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_ALIAS_RE.exec(source)) !== null) {
    const name = m[1];
    const body = m[2].trim();
    const lit = parseLiteralUnion(body);
    if (lit) knownUnions[name] = lit;
  }

  // Pass 2: locate component name
  const fnMatch = EXPORT_FN_RE.exec(source);
  const componentName = fnMatch ? fnMatch[1] : null;

  // Pass 3: locate props block
  let propsBody = null;
  const ifaceMatch = INTERFACE_RE.exec(source);
  const typeMatch = TYPE_PROPS_RE.exec(source);
  if (ifaceMatch) propsBody = ifaceMatch[2];
  else if (typeMatch) propsBody = typeMatch[2];

  const props = {};
  if (propsBody) {
    for (const rawLine of propsBody.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '');
      const pm = PROP_LINE_RE.exec(line);
      if (!pm) continue;
      const [, propName, optionalMark, typeText] = pm;
      const cls = classify(typeText, knownUnions);
      props[propName] = { ...cls, optional: !!optionalMark };
    }
  }

  return { componentName, props, unions: knownUnions };
}

module.exports = { parseProps };
