import test from 'node:test';
import assert from 'node:assert/strict';

import { CLIPS, CAST_CLIPS, clipForElement, sampleClip, makeSample } from '../src/world/HandPoses.js';
import { ELEMENT_META } from '../src/config/settings.js';

const at = (clip, t) => sampleClip(clip, t, makeSample());

test('every clip starts and ends at rest', () => {
  for (const [name, clip] of Object.entries(CLIPS)) {
    if (clip.loop) continue;
    for (const t of [0, 1]) {
      const s = at(clip, t);
      for (const side of ['left', 'right']) {
        for (let i = 0; i < 3; i++) {
          assert.equal(s[side].pos[i], 0, `${name} at t=${t}: ${side} position is neutral`);
          assert.equal(s[side].rot[i], 0, `${name} at t=${t}: ${side} rotation is neutral`);
        }
      }
    }
  }
});

test('a looping clip is seamless where it wraps', () => {
  const start = at(CLIPS.seal, 0);
  const end = at(CLIPS.seal, 0.999);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(start.left.pos[i] - end.left.pos[i]) < 0.01,
      'the seal does not jump when it repeats');
  }
});

test('every clip anticipates before it releases', () => {
  /*
   * The whole difference between a throw and a twitch. Each of these moves
   * away from the target first — back for a thrust, up for an overhead — and
   * a clip that lost that would still "work" while reading as weightless.
   */
  const back = at(CLIPS.thrust, 0.18).left.pos[2];
  const out = at(CLIPS.thrust, 0.42).left.pos[2];
  assert.ok(back > 0, 'thrust pulls back first');
  assert.ok(out < 0, 'then drives forward');

  const up = at(CLIPS.overhead, 0.27).left.pos[1];
  const down = at(CLIPS.overhead, 0.52).left.pos[1];
  assert.ok(up > 0.1 && down < 0, 'overhead raises, then slams');
});

test('every clip overshoots and settles rather than snapping home', () => {
  for (const name of ['thrust', 'overhead', 'ground', 'sweep', 'shove']) {
    const clip = CLIPS[name];
    const peak = Math.min(...[0.3, 0.4, 0.5, 0.6].map((t) => at(clip, t).left.pos[2]));
    const settle = at(clip, 0.75).left.pos[2];
    assert.ok(settle > peak, `${name} comes back from its extreme`);
    assert.ok(Math.abs(settle) < Math.abs(peak), `${name} settles rather than stopping dead`);
  }
});

test('fingers actually move — an open palm and a fist are different shapes', () => {
  const pressed = at(CLIPS.ground, 0.48);
  assert.equal(pressed.left.curl, 0, 'the zone press is a flat palm');
  assert.equal(pressed.left.spread, 1, 'with the fingers fanned');

  const wound = at(CLIPS.thrust, 0.18);
  assert.ok(wound.left.curl > 0.7, 'the thrust winds up as a fist');
});

test('the two hands are not mirrored copies', () => {
  // A sweep is one arm across the body; both doing it is a jumping jack.
  const s = at(CLIPS.sweep, 0.44);
  assert.ok(Math.abs(s.left.pos[0] - s.right.pos[0]) > 0.05,
    'the leading hand travels and the other braces');
});

test('every castable spell has a gesture, and they are grouped by intent', () => {
  for (const element of Object.keys(ELEMENT_META)) {
    const clip = clipForElement(element);
    assert.ok(clip && clip.keys?.length, `${element} resolves to a real clip`);
  }
  assert.equal(CAST_CLIPS.ice, CAST_CLIPS.thunder, 'two line casts throw the same way');
  assert.notEqual(CAST_CLIPS.ice, CAST_CLIPS.meteor, 'a lance and a meteor do not');
  assert.equal(CAST_CLIPS.singularity, CAST_CLIPS.worldtree, 'zone casts press the ground');
});

test('an unknown element still gets hands rather than nothing', () => {
  assert.equal(clipForElement('not-a-spell'), CLIPS.thrust);
});

test('sampling never allocates, and clamps outside its range', () => {
  const out = makeSample();
  const before = sampleClip(CLIPS.thrust, -0.5, out);
  assert.equal(before, out, 'writes into the scratch it was given');
  assert.equal(before.left.pos[2], 0, 'before the start is rest');
  assert.equal(sampleClip(CLIPS.thrust, 2, out).left.pos[2], 0, 'after the end is rest');
});

test('the wrist is its own joint, and the seal uses it', () => {
  /*
   * Fingers pointing up while the forearm still comes in from below is a
   * wrist. Faking it by rotating the whole arm swings the elbow through the
   * frame, which is why this channel exists at all.
   */
  const s = at(CLIPS.seal, 0.5);
  // Fingers run along -z; a *positive* X rotation swings them to +y. Negative
  // points them at the floor, which is what it did until this was pinned down.
  assert.ok(s.left.wrist[0] > 0.8, 'the seal pitches the hand up hard');
  assert.ok(s.left.rot[0] > 0.3,
    'and lifts the forearm past the rest pitch, so the hand clears the elbow');
});

test('the seal presents rather than clutches', () => {
  // Taken from the reference: hands to the centre, fingers up and spread wide,
  // palms turned away. The first pass had them low and half closed.
  const s = at(CLIPS.seal, 0.5);
  assert.ok(s.left.spread > 0.9, 'fingers splayed');
  assert.ok(s.left.curl < 0.1, 'and open, not curled');
  /*
   * `left` rests at negative x, so inward is +x. The first version of this
   * assertion encoded the opposite and passed happily while the hands were
   * being pushed off screen — a test agreeing with the bug it should catch.
   */
  assert.ok(s.left.pos[0] > 0 && s.right.pos[0] < 0,
    'both hands travel inward, toward each other');
  assert.ok(s.left.rot[0] > 0.3, 'and up into frame, mostly by rotation');
});

test('the seal is symmetric', () => {
  const s = at(CLIPS.seal, 0.5);
  assert.equal(s.left.pos[0], -s.right.pos[0]);
  assert.equal(s.left.wrist[1], -s.right.wrist[1]);
  assert.equal(s.left.curl, s.right.curl);
});
