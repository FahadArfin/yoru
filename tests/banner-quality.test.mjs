import test from 'node:test';
import assert from 'node:assert/strict';
import { isBannerSharp } from '../src/banner-quality.js';

test('banner requires Full HD landscape pixels and enough resolution for cover cropping', () => {
  const box = { width: 1440, height: 900, density: 1 };
  assert.equal(isBannerSharp({ width: 1280, height: 720 }, box), false);
  assert.equal(isBannerSharp({ width: 2160, height: 3840 }, box), false);
  assert.equal(isBannerSharp({ width: 3840, height: 2160 }, box), true);
  assert.equal(isBannerSharp({ width: 1920, height: 1080 }, { ...box, density: 2 }), false);
  assert.equal(
    isBannerSharp({ width: 1920, height: 1080 }, { width: 390, height: 750, density: 2 }),
    false,
  );
  assert.equal(
    isBannerSharp({ width: 3840, height: 2160 }, { width: 390, height: 750, density: 3 }),
    true,
  );
  assert.equal(isBannerSharp({ width: 1920, height: 1080 }, { ...box, width: 2400 }), false);
  assert.equal(isBannerSharp(null, box), false);
});
