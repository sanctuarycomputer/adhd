'use strict';

function variantMatrix(axes) {
  const names = Object.keys(axes);
  if (names.length === 0) return [{}];
  // Cartesian product
  let result = [{}];
  for (const name of names) {
    const next = [];
    for (const combo of result) {
      for (const value of axes[name]) {
        next.push({ ...combo, [name]: value });
      }
    }
    result = next;
  }
  return result;
}

function variantKey(combo) {
  return Object.keys(combo).sort().map(k => k + '=' + combo[k]).join(';');
}

function capWithCoverage(full, axes, cap) {
  // Sanity: cap must be >= max axis size (otherwise we can't cover all values).
  const maxAxisSize = Math.max(...Object.values(axes).map(vs => vs.length));
  if (cap < maxAxisSize) {
    throw new Error('cap too small for coverage: cap=' + cap + ' but max axis size=' + maxAxisSize);
  }
  if (full.length <= cap) return [...full].sort((a, b) => variantKey(a).localeCompare(variantKey(b)));

  // Greedy coverage-first selection
  const remaining = new Set(Object.entries(axes).flatMap(([name, vs]) => vs.map(v => name + '=' + v)));
  const sorted = [...full].sort((a, b) => variantKey(a).localeCompare(variantKey(b)));
  const chosen = [];

  // Pass 1: pick combos that uniquely cover remaining axis values
  for (const combo of sorted) {
    if (chosen.length >= cap) break;
    let contributes = false;
    for (const [name, value] of Object.entries(combo)) {
      if (remaining.has(name + '=' + value)) { contributes = true; break; }
    }
    if (contributes) {
      chosen.push(combo);
      for (const [name, value] of Object.entries(combo)) {
        remaining.delete(name + '=' + value);
      }
    }
  }
  // Pass 2: fill remaining capacity with the next combos in sorted order
  for (const combo of sorted) {
    if (chosen.length >= cap) break;
    if (!chosen.includes(combo)) chosen.push(combo);
  }
  // Return in lexical order
  return chosen.sort((a, b) => variantKey(a).localeCompare(variantKey(b)));
}

module.exports = { variantMatrix, variantKey, capWithCoverage };
