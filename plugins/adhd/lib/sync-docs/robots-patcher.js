'use strict';

function patchRobots(source, routeUrl) {
  const disallowLine = `Disallow: ${routeUrl}`;
  if (!source) {
    return `User-agent: *\n${disallowLine}\n`;
  }
  // Idempotent: line-anchored exact match
  const exactRe = new RegExp(`^${disallowLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  if (exactRe.test(source)) return source;
  // Append (ensure newline before, single newline after)
  const trimmed = source.replace(/\n+$/, '');
  return trimmed + '\n' + disallowLine + '\n';
}

module.exports = { patchRobots };
