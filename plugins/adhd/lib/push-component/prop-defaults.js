'use strict';

// Whole-word match for common name/title-shaped props, plus camelCase suffixes
// like `userName` — but explicitly excluding `className` (a CSS hook, not a name).
const NAME_LIKE_EXACT = /^(?:name|title|fullName|firstName|lastName)$/i;
const NAME_LIKE_SUFFIX = /(?:Name|Title)$/;
const EXCLUDED = new Set(['className']);

function isNameLike(propName) {
  if (EXCLUDED.has(propName)) return false;
  if (NAME_LIKE_EXACT.test(propName)) return true;
  if (NAME_LIKE_SUFFIX.test(propName)) return true;
  return false;
}

function defaultForProp(propName, propMeta) {
  if (propMeta.optional) return null; // let component use its own default
  switch (propMeta.type) {
    case 'string':   return isNameLike(propName) ? '"John Doe"' : '"Sample text"';
    case 'number':   return '0';
    case 'boolean':  return 'false';
    case 'function': return '() => {}';
    case 'ref':      return 'null';
    case 'reactnode': return '"..."';
    case 'array':    return '[]';
    case 'object':   return '{}';
    case 'union':    return JSON.stringify(propMeta.values[0]); // pick first value
    case 'unknown':  return '{}';
    default:         return '{}';
  }
}

module.exports = { defaultForProp, isNameLike };
