'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugFor, slugMap } = require('../slug');

test('slugs a simple component path', () => {
  assert.equal(slugFor('app/components/avatar/index.tsx'), 'avatar');
});

test('preserves hyphens', () => {
  assert.equal(slugFor('app/components/avatar-group/index.tsx'), 'avatar-group');
});

test('handles files without /index.tsx', () => {
  assert.equal(slugFor('app/components/Logo.tsx'), 'logo');
});

test('lowercases', () => {
  assert.equal(slugFor('app/components/AvatarGroup/index.tsx'), 'avatargroup');
});

test('slugMap returns { path: slug } for unique paths', () => {
  const paths = [
    'app/components/avatar/index.tsx',
    'app/components/avatar-group/index.tsx',
  ];
  assert.deepEqual(slugMap(paths), {
    'app/components/avatar/index.tsx': 'avatar',
    'app/components/avatar-group/index.tsx': 'avatar-group',
  });
});

test('slugMap disambiguates collisions by prepending parent dir', () => {
  const paths = [
    'app/components/avatar/index.tsx',
    'app/design-system/avatar/index.tsx',
  ];
  const m = slugMap(paths);
  assert.equal(new Set(Object.values(m)).size, 2, 'slugs must be unique');
  // Both contain "avatar"; we expect e.g. "components-avatar" and "design-system-avatar"
  assert.ok(Object.values(m).every(s => s.includes('avatar')));
});
