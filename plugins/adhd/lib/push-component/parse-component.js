'use strict';

const TYPE_ALIAS_RE = /export\s+type\s+([A-Z][A-Za-z0-9]*)\s*=\s*([^;]+);/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+([A-Z][A-Za-z0-9]*)?Props\s*\{([\s\S]*?)\}/;
const TYPE_PROPS_RE = /(?:export\s+)?type\s+([A-Z][A-Za-z0-9]*)?Props\s*=\s*\{([\s\S]*?)\}/;
const EXPORT_FN_RE = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)\s*\(/;
const PROP_LINE_RE = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)(\?)?\s*:\s*([^;,]+)[;,]?\s*$/;

function parseUnionString(typeText) {
  // Match `"a" | "b" | "c"` literal unions only
  const trimmed = typeText.trim();
  if (!/^\s*"[^"]*"(\s*\|\s*"[^"]*")*\s*$/.test(trimmed)) return null;
  return trimmed.split('|').map((s) => {
    const m = /"([^"]*)"/.exec(s.trim());
    return m ? m[1] : null;
  }).filter(Boolean);
}

function classifyPropType(typeText, knownUnions) {
  const t = typeText.trim();
  // Inline literal union → union
  const inlineUnion = parseUnionString(t);
  if (inlineUnion) return { type: 'union', values: inlineUnion };
  // Named union reference
  if (knownUnions[t]) return { type: 'union', unionName: t, values: knownUnions[t] };
  // Function: anything matching `(...) => *` (allowing nested parens for generics)
  if (/^\([^)]*\)\s*=>/.test(t)) return { type: 'function' };
  // Ref types
  if (/^(?:React\.)?Ref(?:Object|Callback|MutableRefObject)?</.test(t)) return { type: 'ref' };
  if (/^MutableRefObject</.test(t) || /^RefObject</.test(t)) return { type: 'ref' };
  // ReactNode / ReactElement / JSX.Element
  if (/^(?:React\.)?(?:ReactNode|ReactElement|ReactChild)$/.test(t)) return { type: 'reactnode' };
  if (/^JSX\.Element$/.test(t)) return { type: 'reactnode' };
  if (/^(?:React\.)?ReactElement<.*>$/.test(t)) return { type: 'reactnode' };
  // Primitives
  if (t === 'string') return { type: 'string' };
  if (t === 'number') return { type: 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  // Array
  if (/\[\]$/.test(t) || /^Array</.test(t) || /^ReadonlyArray</.test(t)) return { type: 'array' };
  // Object literal
  if (/^\{/.test(t)) return { type: 'object' };
  // Fallback
  return { type: 'unknown', raw: t };
}

function parseComponent(source) {
  // 1. Find all exported union-type aliases
  const unions = {};
  TYPE_ALIAS_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_ALIAS_RE.exec(source)) !== null) {
    const name = m[1];
    const rhs = m[2];
    const values = parseUnionString(rhs);
    if (values) unions[name] = values;
  }
  // 2. Find the component's exported function name
  const fnMatch = EXPORT_FN_RE.exec(source);
  if (!fnMatch) {
    throw new Error('No exported function component found in source');
  }
  const componentName = fnMatch[1];
  // 3. Find the props interface or type: <ComponentName>Props
  const interfaceMatch = INTERFACE_RE.exec(source);
  const typeMatch = TYPE_PROPS_RE.exec(source);
  const propsBody = (interfaceMatch && interfaceMatch[2]) || (typeMatch && typeMatch[2]);
  if (!propsBody) {
    throw new Error('Could not locate props interface or type for component ' + componentName);
  }
  // 4. Parse each line of the props body. Split on newlines first, then split each
  // line on `;` so we also handle single-line type aliases like
  // `type Props = { a: string; b: number }`.
  const props = {};
  for (const rawLine of propsBody.split('\n')) {
    for (const segment of rawLine.split(';')) {
      const propMatch = PROP_LINE_RE.exec(segment);
      if (!propMatch) continue;
      const [, name, optionalMarker, typeText] = propMatch;
      const optional = optionalMarker === '?';
      const classified = classifyPropType(typeText, unions);
      props[name] = { ...classified, optional };
    }
  }
  return { componentName, unions, props };
}

module.exports = { parseComponent, parseUnionString, classifyPropType };
