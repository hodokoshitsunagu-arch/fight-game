import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';

import { settings } from '../src/config/settings.js';
import { Environment } from '../src/world/Environment.js';

/**
 * The horizon sampler decides what colour the fog fades the floor into when the
 * panorama backdrop is on. Get it wrong and a hard ring appears where the floor
 * stops — which is precisely the seam the panorama mode exists to avoid.
 *
 * `_sampleHorizon` touches no instance state, so it is exercised directly
 * rather than standing up a renderer.
 */
const sample = (texture) => Environment.prototype._sampleHorizon.call(null, texture);

/** A fake equirect: `rows(y)` returns the linear [r,g,b] for that row. */
function makeTexture(width, height, rows, { half = true, components = 4 } = {}) {
  const data = half
    ? new Uint16Array(width * height * components)
    : new Float32Array(width * height * components);

  for (let y = 0; y < height; y++) {
    const [r, g, b] = rows(y);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * components;
      const write = (offset, value) => {
        data[i + offset] = half ? DataUtils.toHalfFloat(value) : value;
      };
      write(0, r);
      write(1, g);
      write(2, b);
      if (components === 4) write(3, 1);
    }
  }
  return { image: { width, height, data } };
}

const BLUE = [0.1, 0.2, 0.6];
const SAND = [0.5, 0.4, 0.2];

/** Sky above the equator, ground below, a distinct band across the horizon. */
const skyGroundHorizon = (height) => (y) => {
  if (Math.abs(y - height / 2) < height * 0.03) return SAND;
  return y < height / 2 ? BLUE : [0.05, 0.04, 0.03];
};

test('reads the colour of the horizon band, not the sky or the ground', () => {
  const texture = makeTexture(256, 128, skyGroundHorizon(128));
  const horizon = sample(texture);
  assert.ok(horizon, 'a colour came back');
  // Should land near the sand band, and clearly not on the blue sky.
  assert.ok(horizon.r > horizon.b, 'warm, like the band it sampled');
  assert.ok(Math.abs(horizon.r - SAND[0]) < 0.2, `r ${horizon.r} near ${SAND[0]}`);
});

test('a sun on the horizon does not drag the average to white', () => {
  const width = 256;
  const height = 128;
  // One brutally bright column, as an HDR sun actually is.
  const texture = makeTexture(width, height, () => [0.2, 0.2, 0.2]);
  const components = 4;
  for (let y = 0; y < height; y++) {
    const i = (y * width + 8) * components;
    for (let c = 0; c < 3; c++) texture.image.data[i + c] = DataUtils.toHalfFloat(6000);
  }
  const horizon = sample(texture);
  // Without clamping, one 6000-nit column would swamp 256 samples of 0.2.
  assert.ok(horizon.r < 0.6, `stayed near the sky value, got ${horizon.r}`);
});

test('float and half-float sources agree', () => {
  const rows = skyGroundHorizon(128);
  const asHalf = sample(makeTexture(256, 128, rows, { half: true }));
  const asFloat = sample(makeTexture(256, 128, rows, { half: false }));
  for (const channel of ['r', 'g', 'b']) {
    assert.ok(Math.abs(asHalf[channel] - asFloat[channel]) < 0.01,
      `${channel}: ${asHalf[channel]} vs ${asFloat[channel]}`);
  }
});

test('three-component data is handled as well as four', () => {
  const rows = skyGroundHorizon(128);
  const rgb = sample(makeTexture(256, 128, rows, { components: 3 }));
  const rgba = sample(makeTexture(256, 128, rows, { components: 4 }));
  assert.ok(rgb, 'RGB source read');
  assert.ok(Math.abs(rgb.r - rgba.r) < 0.01, 'and agrees with RGBA');
});

test('an unreadable texture returns null rather than throwing', () => {
  // A compressed or GPU-only source has no CPU-side pixels; the caller falls
  // back to the authored fog colour.
  assert.equal(sample(null), null);
  assert.equal(sample({}), null);
  assert.equal(sample({ image: {} }), null);
  assert.equal(sample({ image: { width: 4, height: 2 } }), null);
  assert.equal(sample({ image: { width: 0, height: 0, data: new Float32Array(0) } }), null);
});

test('non-finite samples are skipped instead of poisoning the average', () => {
  const texture = makeTexture(64, 32, () => [0.3, 0.3, 0.3], { half: false });
  texture.image.data[0] = Number.NaN;
  texture.image.data[4] = Number.POSITIVE_INFINITY;
  const horizon = sample(texture);
  assert.ok(Number.isFinite(horizon.r), 'r is finite');
  assert.ok(Number.isFinite(horizon.g), 'g is finite');
  assert.ok(Number.isFinite(horizon.b), 'b is finite');
});

test('the backdrop settings exist with the documented shape', () => {
  const env = settings.environment;
  assert.ok(['flat', 'panorama'].includes(env.backgroundMode));
  assert.equal(env.backgroundMode, 'flat', 'off by default — the stage was tuned against the void');
  assert.equal(typeof env.backgroundIntensity, 'number');
  assert.equal(typeof env.backgroundBlur, 'number');
  assert.equal(typeof env.backgroundRotation, 'number');
  assert.equal(typeof env.fogFromHorizon, 'boolean');
});

/* ------------------------------------------------------------------ */
/* Panorama source selection                                           */
/* ------------------------------------------------------------------ */

test('HDR sources are told apart from sRGB ones', async () => {
  const { isHighDynamicRange } = await import('../src/loaders/AssetLoader.js');

  for (const url of ['./sky.hdr', './sky.EXR', 'a/b/c.hdr', './sky.hdr?v=2', './sky.exr#frag']) {
    assert.equal(isHighDynamicRange(url), true, `${url} is HDR`);
  }
  for (const url of ['./sky.jpg', './sky.png', './sky.webp', './sky.jpeg?w=8192', '', null]) {
    assert.equal(isHighDynamicRange(url), false, `${url} is not HDR`);
  }
  // The trap: a query string after the extension. Matching only at the end of
  // the string would read a generated `.hdr?v=2` as sRGB and render it black.
  assert.equal(isHighDynamicRange('./generated.hdr?signature=abc123'), true);
});

test('a backdrop URL is configurable and empty by default', () => {
  assert.equal(typeof settings.environment.panoramaUrl, 'string');
  assert.equal(settings.environment.panoramaUrl, '', 'defaults to reusing the lighting probe');
  assert.equal(typeof settings.environment.backgroundTilt, 'number');
});
