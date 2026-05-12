'use strict';

// Read + write per-component pull state (pulledAt + fingerprint) in
// adhd.config.ts. The user wants this in the config rather than a
// sidecar because pull state is "true state we should be following" —
// a fingerprint mismatch on next pull means the source has drifted.
//
// State shape inside `components: { '<path>': { ... } }`:
//
//   components: {
//     'app/components/Button': {
//       figma: { url: '...' },
//       pulledAt: '2026-05-12T14:30:00.000Z',
//       fingerprint: 'a1b2c3d4',
//     },
//   }
//
// Brace-counted parsing (not greedy regex) so nested `figma: { url }`
// doesn't confuse the boundary detection.

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

// Locate the `{ ... }` value block for the given component-path key
// within the components map. Returns `{ openAt, closeAt, body }` —
// `openAt` and `closeAt` are absolute indices of the opening and
// closing braces. Returns null when the path key isn't found.
function findComponentBlock(src, componentPath) {
  if (!src) return null;
  const keyPattern = new RegExp(
    '["\']' + escapeForRegex(componentPath) + '["\']\\s*:\\s*\\{',
  );
  const m = keyPattern.exec(src);
  if (!m) return null;
  const openAt = m.index + m[0].length - 1;
  let depth = 1;
  let i = openAt + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  return { openAt, closeAt: i, body: src.slice(openAt + 1, i) };
}

// Read pulledAt + fingerprint from a component block. Returns null when
// the component or either field is missing — caller treats that as
// "no cached fingerprint, must pull fresh".
function readComponentState(src, componentPath) {
  const block = findComponentBlock(src, componentPath);
  if (!block) return null;
  // Match only top-level fields within the block (depth 0). Use a
  // brace-counted scan so a nested `figma: { url: "..." }` doesn't
  // shadow a real top-level `fingerprint` field.
  const findField = (name) => {
    const re = new RegExp(name + '\\s*:\\s*["\']([^"\']+)["\']', 'g');
    let d = 0;
    let i = 0;
    while (i < block.body.length) {
      const ch = block.body[i];
      if (ch === '{') { d++; i++; continue; }
      if (ch === '}') { d--; i++; continue; }
      if (d === 0) {
        re.lastIndex = i;
        const m = re.exec(block.body);
        if (m && m.index === i) return m[1];
      }
      i++;
    }
    return null;
  };
  const pulledAt = findField('pulledAt');
  const fingerprint = findField('fingerprint');
  if (!pulledAt || !fingerprint) return null;
  return { pulledAt, fingerprint };
}

// Upsert pulledAt + fingerprint into the component's block. If the
// fields exist (any quoting style), their values are replaced; if not,
// they're inserted before the closing `}` with consistent indentation
// matched from the surrounding block.
//
// Throws when the component path isn't in the config — caller should
// guard, since pull-component requires the path to be configured anyway.
function writeComponentState(src, componentPath, { pulledAt, fingerprint }) {
  const block = findComponentBlock(src, componentPath);
  if (!block) {
    throw new Error('Component not found in adhd.config.ts: ' + componentPath);
  }
  // Update if present, insert if not — same logic for both fields.
  const upsert = (currentSrc, blockOpenAt, blockCloseAt, name, value) => {
    const localBody = currentSrc.slice(blockOpenAt + 1, blockCloseAt);
    const re = new RegExp('(' + name + '\\s*:\\s*)["\'][^"\']*["\']');
    const m = re.exec(localBody);
    if (m) {
      // Replace just the quoted value, preserving the existing quote style.
      const valueStart = blockOpenAt + 1 + m.index + m[1].length;
      const valueEnd = valueStart + (m[0].length - m[1].length);
      const quote = currentSrc[valueStart];
      return currentSrc.slice(0, valueStart) + quote + value + quote + currentSrc.slice(valueEnd);
    }
    // Insert before the closing `}`. Indent one nesting deeper than
    // the closing brace's line — the brace sits at the block's outer
    // indent, so its leading whitespace + 2 spaces gives us the inner
    // indent the existing entries use.
    const before = currentSrc.slice(0, blockCloseAt);
    const lastNl = before.lastIndexOf('\n');
    const closingLine = before.slice(lastNl + 1);
    const closingIndent = /^\s*/.exec(closingLine)[0];
    const indent = closingIndent + '  ';
    // Ensure the prior content ends in `,` — adhd configs always use
    // trailing commas, so an entry without one would be malformed.
    let prefix = '';
    const trimmedPrior = before.slice(0, lastNl).trimEnd();
    if (trimmedPrior.length > 0 && !trimmedPrior.endsWith(',') && !trimmedPrior.endsWith('{')) {
      prefix = ',';
    }
    const insertion = prefix + '\n' + indent + name + ': "' + value + '",';
    return currentSrc.slice(0, lastNl) + insertion + currentSrc.slice(lastNl);
  };
  let out = src;
  // Order matters — pulledAt first so re-finding the block uses fresh indices.
  out = upsert(out, block.openAt, block.closeAt, 'pulledAt', pulledAt);
  // Re-find the block since indices shifted.
  const block2 = findComponentBlock(out, componentPath);
  out = upsert(out, block2.openAt, block2.closeAt, 'fingerprint', fingerprint);
  return out;
}

module.exports = { findComponentBlock, readComponentState, writeComponentState };
