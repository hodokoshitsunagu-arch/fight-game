import test from 'node:test';
import assert from 'node:assert/strict';

import { settings } from '../src/config/settings.js';
import { createIceMaterial } from '../src/materials/IceMaterial.js';
import { createLightningMaterial } from '../src/materials/LightningMaterial.js';
import { Vector3 } from 'three';

/**
 * Guards the seam that per-cast overrides very nearly missed.
 *
 * Geometry is computed by the ability from `this.config`, so overrides reached
 * it for free. Colour is not: it lives in uniforms that the *material* writes,
 * and every `sync` used to read the global settings block directly — so a
 * spoken "crimson" changed `config` and the crystals stayed blue. Materials are
 * built per ability instance, so `sync` takes the config now.
 *
 * These tests fail if a sync goes back to reading the global block.
 */

/** The only thing these materials want from the environment. */
const stubEnvironment = {
  registerShadowCasterWithPatch: () => {},
  register: () => {},
  probe: null,
  texture: null
};

test('the ice material paints from the config it is handed', () => {
  const material = createIceMaterial(stubEnvironment);
  const uniforms = material.userData.uniforms;

  material.userData.sync();
  const authored = uniforms.uColorIce.value.getHexString();
  assert.equal(`#${authored}`, settings.ice.colorIce, 'defaults to the global block');

  material.userData.sync({ ...settings.ice, colorIce: '#ff0000' });
  assert.equal(uniforms.uColorIce.value.getHexString(), 'ff0000', 'an override reaches the shader');

  // And the global block is still the fallback, untouched.
  material.userData.sync();
  assert.equal(uniforms.uColorIce.value.getHexString(), authored, 'no residue on the next cast');
});

test('the lightning material paints from the config it is handed', () => {
  const material = createLightningMaterial(stubEnvironment);
  // A raw shader material keeps its uniforms on the material itself.
  const uniforms = material.uniforms;
  const state = {
    origin: new Vector3(),
    target: new Vector3(0, 0, 10),
    side: new Vector3(1, 0, 0),
    seed: 1,
    progress: 0.5,
    fade: 0,
    strands: 4
  };

  material.userData.sync(state);
  const authored = uniforms.uColorCore.value.getHexString();

  material.userData.sync(state, { ...settings.thunder, colorCore: '#00ff00' });
  assert.equal(uniforms.uColorCore.value.getHexString(), '00ff00');

  material.userData.sync(state);
  assert.equal(uniforms.uColorCore.value.getHexString(), authored);
});

test('an overridden config still resolves every field the material reads', () => {
  // The proxy falls through for anything not overridden, so a sparse patch must
  // not leave a uniform undefined (which surfaces as NaN, not as an error).
  const material = createIceMaterial(stubEnvironment);
  const sparse = new Proxy(
    {},
    {
      get: (_, key) => (key === 'colorIce' ? '#ff0000' : settings.ice[key]),
      has: (_, key) => key in settings.ice
    }
  );
  material.userData.sync(sparse);
  for (const [name, uniform] of Object.entries(material.userData.uniforms)) {
    if (typeof uniform.value === 'number') {
      assert.equal(Number.isFinite(uniform.value), true, `${name} is finite`);
    }
  }
});
