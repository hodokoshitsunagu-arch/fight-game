import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

import { settings } from '../src/config/settings.js';
import { Ability } from '../src/abilities/Ability.js';

/**
 * The per-cast override layer is what lets a spoken modifier reshape one cast
 * without touching the block every other system reads. Two properties have to
 * hold: overrides must be visible through `config`, and a pooled instance must
 * never inherit the previous cast's overrides.
 */

const mockContext = {
  lights: { acquire: () => null, release: () => {}, set: () => {} },
  scene: { add: () => {} }
};

const ORIGIN = new Vector3();
const DIRECTION = new Vector3(0, 0, 1);

function makeAbility(element = 'ice') {
  return new Ability(element, mockContext);
}

test('config falls through to the live settings block when nothing is overridden', () => {
  const ability = makeAbility();
  ability.spawn(ORIGIN, DIRECTION, 10);
  assert.equal(ability.config, settings.ice, 'no-override path returns the block itself');
  assert.equal(ability.config.height, settings.ice.height);
});

test('overrides shadow the block without mutating it', () => {
  const baseline = settings.ice.height;
  const ability = makeAbility();
  ability.spawn(ORIGIN, DIRECTION, 10, { height: baseline * 2 });

  assert.equal(ability.config.height, baseline * 2, 'override is visible');
  assert.equal(settings.ice.height, baseline, 'global block is untouched');
  assert.equal(ability.config.width, settings.ice.width, 'unrelated fields fall through');
});

test('a second cast on the same instance does not inherit the first cast overrides', () => {
  const ability = makeAbility();
  const baseline = settings.ice.height;

  ability.spawn(ORIGIN, DIRECTION, 10, { height: baseline * 4 });
  assert.equal(ability.config.height, baseline * 4);

  // The pooling contract: `spawn` fully resets state. Recycling this instance
  // for a plain cast must come back at baseline, or "greater" leaks forward and
  // reads as random effect scaling four casts later.
  ability.spawn(ORIGIN, DIRECTION, 10);
  assert.equal(ability.config.height, baseline, 'overrides cleared on respawn');
  assert.equal(ability.config, settings.ice, 'and the fast path is restored');
});

test('mergeOverrides reshapes a cast that is already in flight', () => {
  const ability = makeAbility();
  const baseline = settings.ice.height;
  ability.spawn(ORIGIN, DIRECTION, 10);

  // Modifier heard after the spell name already fired.
  ability.mergeOverrides({ height: baseline * 3 });
  assert.equal(ability.config.height, baseline * 3);

  ability.mergeOverrides({ colorIce: '#ff0000' });
  assert.equal(ability.config.height, baseline * 3, 'earlier modifier survives');
  assert.equal(ability.config.colorIce, '#ff0000', 'later modifier lands too');
});

test('overridden config still enumerates like the real block', () => {
  const ability = makeAbility();
  ability.spawn(ORIGIN, DIRECTION, 10, { height: 99 });
  assert.deepEqual(Object.keys(ability.config), Object.keys(settings.ice));
  assert.equal('height' in ability.config, true);
  assert.equal('notAField' in ability.config, false);
});

test('every ability block exposes the fields the cast pipeline relies on', () => {
  // settings.js documents these four as the contract shared systems depend on.
  for (const element of ['ice', 'thunder', 'meteor', 'beam', 'snare', 'glacier',
                         'void', 'phoenix', 'singularity', 'worldtree']) {
    const block = settings[element];
    for (const field of ['range', 'minRange', 'speed', 'cooldown']) {
      assert.equal(typeof block[field], 'number', `${element}.${field} is a number`);
    }
  }
});
