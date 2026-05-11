'use strict';

function baseSlug(componentPath) {
  // Strip /index.tsx or .tsx; take the last meaningful segment.
  let p = componentPath.replace(/\\/g, '/').replace(/\.tsx?$/, '').replace(/\/index$/, '');
  const segs = p.split('/').filter(Boolean);
  return (segs[segs.length - 1] || '').toLowerCase();
}

function slugFor(componentPath) {
  return baseSlug(componentPath);
}

function slugMap(paths) {
  // Pass 1: tentative slugs
  const tentative = paths.map(p => ({ path: p, slug: baseSlug(p) }));
  // Pass 2: find collisions
  const counts = {};
  for (const t of tentative) counts[t.slug] = (counts[t.slug] || 0) + 1;
  // Pass 3: resolve collisions by prepending the parent dir
  for (const t of tentative) {
    if (counts[t.slug] === 1) continue;
    const segs = t.path.replace(/\\/g, '/').replace(/\.tsx?$/, '').replace(/\/index$/, '').split('/').filter(Boolean);
    // Prepend one level of parent until unique
    let depth = 2;
    while (depth <= segs.length) {
      const candidate = segs.slice(segs.length - depth).join('-').toLowerCase();
      const colliders = tentative.filter(x => x !== t && x.slug === candidate).length;
      if (colliders === 0) {
        t.slug = candidate;
        break;
      }
      depth++;
    }
  }
  const out = {};
  for (const t of tentative) out[t.path] = t.slug;
  return out;
}

module.exports = { slugFor, slugMap };
