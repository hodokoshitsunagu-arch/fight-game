import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';

import { settings } from '../src/config/settings.js';
import { VoiceController } from '../src/voice/VoiceController.js';
import { TargetSelector } from '../src/voice/TargetSelector.js';

/**
 * End-to-end over the real path: transcript in, cast out. `simulate()` feeds
 * the same `transcript` event the microphone produces, so everything below the
 * Web Speech API is exercised exactly as it runs in the browser.
 */

/** Records what AbilityManager was asked to do. */
function makeAbilities() {
  const casts = [];
  return {
    casts,
    selected: 'ice',
    select(element) {
      this.selected = element;
    },
    cast(origin, direction, distance, element, overrides) {
      const ability = {
        element,
        overrides,
        isActive: true,
        isFinished: false,
        setOverrides(patch) {
          this.overrides = patch;
        },
        mergeOverrides(patch) {
          this.overrides = { ...(this.overrides ?? {}), ...patch };
        }
      };
      casts.push({
        element,
        overrides,
        distance,
        origin: origin.clone(),
        direction: direction.clone(),
        ability
      });
      return ability;
    }
  };
}

function makeController({ enemies = { active: [] }, canCast = () => true } = {}) {
  const abilities = makeAbilities();
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 10, -10);
  camera.lookAt(0, 0, 0);
  const controller = new VoiceController({
    abilities,
    camera,
    enemies,
    character: { position: new Vector3() },
    canCast
  });
  return { controller, abilities };
}

const dummyAt = (x, z) => ({ position: new Vector3(x, 0, z), isDead: false });

/* ------------------------------------------------------------------ */

test('a spoken spell name casts that ability', () => {
  const { controller, abilities } = makeController();
  controller.simulate('frost lance');
  assert.equal(abilities.casts.length, 1);
  assert.equal(abilities.casts[0].element, 'ice');
});

test('all ten abilities are castable by voice', () => {
  const spoken = {
    'frost lance': 'ice',
    'storm lance': 'thunder',
    'cinder fall': 'meteor',
    'nova beam': 'beam',
    'voltaic snare': 'snare',
    'glacial crown': 'glacier',
    'rift sever': 'void',
    'solar phoenix': 'phoenix',
    'gravity singularity': 'singularity',
    'worldroot bloom': 'worldtree'
  };
  for (const [phrase, element] of Object.entries(spoken)) {
    const { controller, abilities } = makeController();
    controller.simulate(phrase);
    assert.equal(abilities.casts.length, 1, `"${phrase}" cast something`);
    assert.equal(abilities.casts[0].element, element, `"${phrase}" -> ${element}`);
  }
});

test('a leading modifier is applied at spawn, not a frame later', () => {
  const { controller, abilities } = makeController();
  controller.simulate(['greater', 'frost', 'lance']);
  const { overrides } = abilities.casts[0];
  assert.ok(overrides, 'the cast spawned with overrides in hand');
  assert.ok(overrides.height > settings.ice.height, 'and they are already greater');
});

test('a trailing modifier reshapes the cast already in flight', () => {
  const { controller, abilities } = makeController();
  // Word by word, as the recogniser delivers it.
  controller.simulate(['frost', 'lance', 'crimson']);

  assert.equal(abilities.casts.length, 1, 'still one cast, not two');
  const { ability } = abilities.casts[0];
  assert.ok(ability.overrides, 'the live cast picked up overrides after spawning');
  const colours = Object.keys(ability.overrides).filter((k) => k.startsWith('color'));
  assert.ok(colours.length > 0, 'and they are colour fields');
});

test('a trailing modifier is ignored once the cast has finished', () => {
  const { controller, abilities } = makeController();
  controller.simulate(['frost', 'lance']);
  const { ability } = abilities.casts[0];
  ability.isFinished = true;
  ability.isActive = false;
  const before = ability.overrides;
  controller.simulate(['frost lance', 'crimson']);
  // The second simulate casts afresh; the point is the first cast was not
  // mutated after it ended.
  assert.equal(ability.overrides, before);
});

test('the mutation window closes on its own', () => {
  const { controller } = makeController();
  controller.simulate(['frost', 'lance']);
  assert.ok(controller.live, 'a live cast is held');
  controller.update(settings.voice.mutationWindow + 0.1);
  assert.equal(controller.live, null, 'and released once the window passes');
});

test('conversation does not cast', () => {
  const { controller, abilities } = makeController();
  controller.simulate('so anyway what time is the meeting');
  controller.simulate('could you pass me that thing over there');
  assert.equal(abilities.casts.length, 0);
});

test('a cooldown refusal blocks the cast', () => {
  const { controller, abilities } = makeController({ canCast: () => false });
  controller.simulate('frost lance');
  assert.equal(abilities.casts.length, 0);
});

/* ------------------------------------------------------------------ */
/* Targeting                                                           */
/* ------------------------------------------------------------------ */

test('auto-target picks the nearest living dummy', () => {
  const near = dummyAt(0, 6);
  const far = dummyAt(0, 13);
  const selector = new TargetSelector({
    camera: new PerspectiveCamera(),
    enemies: { active: [far, near] },
    character: { position: new Vector3() }
  });
  const solved = selector.solve('ice');
  assert.equal(solved.target, near);
  assert.ok(Math.abs(solved.distance - 6) < 1e-3);
  assert.ok(Math.abs(solved.direction.z - 1) < 1e-3, 'aimed at it');
});

test('dead dummies are not targeted', () => {
  const dead = { position: new Vector3(0, 0, 3), isDead: true };
  const alive = dummyAt(0, 9);
  const selector = new TargetSelector({
    camera: new PerspectiveCamera(),
    enemies: { active: [dead, alive] },
    character: { position: new Vector3() }
  });
  assert.equal(selector.solve('ice').target, alive);
});

test('an empty arena still produces a castable line', () => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 8, -8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const selector = new TargetSelector({
    camera,
    enemies: { active: [] },
    character: { position: new Vector3() }
  });
  const solved = selector.solve('ice');
  assert.equal(solved.target, null);
  assert.ok(solved.distance > 0, 'a real distance');
  assert.ok(Math.abs(solved.direction.length() - 1) < 1e-6, 'a unit direction');
  assert.ok(Math.abs(solved.direction.y) < 1e-6, 'flat on the ground plane');
});

test('every ability resolves a line inside its own legal range', () => {
  const selector = new TargetSelector({
    camera: new PerspectiveCamera(),
    enemies: { active: [dummyAt(0, 40)] }, // deliberately far out of reach
    character: { position: new Vector3() }
  });
  for (const element of ['ice', 'thunder', 'meteor', 'beam', 'snare', 'glacier',
                         'void', 'phoenix', 'singularity', 'worldtree']) {
    const block = settings[element];
    const solved = selector.solve(element);
    assert.ok(solved.distance <= block.range + 1e-6, `${element} within range`);
    assert.ok(solved.distance >= block.minRange - 1e-6, `${element} beyond minRange`);
  }
});
