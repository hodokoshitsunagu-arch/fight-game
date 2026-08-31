import test from 'node:test';
import assert from 'node:assert/strict';

import { CLIPS, CAST_CLIPS, SEALS, KUJI, clipForElement, sampleClip, makeSample }
  from '../src/world/HandPoses.js';
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

test('the wrist is its own joint, and every seal uses it', () => {
  /*
   * Fingers pointing up while the forearm still comes in from below is a
   * wrist. Faking it by rotating the whole arm swings the elbow through the
   * frame, which is why this channel exists at all.
   *
   * Asserted across the whole sequence rather than at one instant. The seal
   * used to be a single held shape and a spot check at t=0.5 was the same as
   * checking all of it; now it is nine signs, and a spot check would only ever
   * catch whichever sign happened to land under the sample.
   */
  for (const [name, seal] of Object.entries(SEALS)) {
    for (const side of ['left', 'right']) {
      // Fingers run along -z; a *positive* X rotation swings them to +y.
      // Negative points them at the floor, which is what it did until this
      // was pinned down.
      assert.ok(seal[side].wrist[0] > 0.6, `${name}: ${side} pitches the hand up`);
      assert.ok(seal[side].rot[0] > 0.3,
        `${name}: ${side} lifts the forearm past the rest pitch, clearing the elbow`);
    }
  }
});

test('every seal brings the hands inward, never outward', () => {
  /*
   * `left` rests at negative x, so inward is +x. An earlier version of this
   * assertion encoded the opposite and passed happily while the hands were
   * being pushed off screen — a test agreeing with the bug it should catch.
   * It is checked on all nine now, because the mirror helper means one wrong
   * sign would take every symmetric seal with it.
   */
  for (const [name, seal] of Object.entries(SEALS)) {
    assert.ok(seal.left.pos[0] > 0, `${name}: the left hand travels toward centre`);
    assert.ok(seal.right.pos[0] < 0, `${name}: the right hand travels toward centre`);
  }
});

test('the seal is a sequence, not a held shape', () => {
  /*
   * The point of the chain is that it changes. If every sign collapsed to the
   * same numbers — a mirror bug, a bad chain builder, a table where every entry
   * aliases one object — the clip would still play, still loop, still pass
   * every other test here, and read on screen as a single frozen pose.
   */
  const shapes = new Set(
    KUJI.map((n) => `${SEALS[n].left.curl.toFixed(2)}/${SEALS[n].left.spread.toFixed(2)}`)
  );
  assert.ok(shapes.size >= 7, `nine signs produce ${shapes.size} distinct hand shapes`);

  // And the clip actually visits them: an open sign and a closed one, sampled
  // where the chain says each is being held.
  const open = at(CLIPS.seal, 0.02);           // 临 — flat palms together
  const fist = at(CLIPS.seal, 5 / 9 + 0.03);   // 陣 — the inner bond
  assert.ok(open.left.curl < 0.1, 'the sequence opens with an open hand');
  assert.ok(fist.left.curl > 0.8, 'and closes to a fist partway through');
});

test('the symmetric seals mirror exactly, and 智拳印 deliberately does not', () => {
  for (const [name, seal] of Object.entries(SEALS)) {
    if (name === 'retsu') continue;
    assert.equal(seal.left.pos[0], -seal.right.pos[0], `${name}: position mirrors`);
    assert.equal(seal.left.wrist[1], -seal.right.wrist[1], `${name}: wrist mirrors`);
    assert.equal(seal.left.curl, seal.right.curl, `${name}: both hands hold the same shape`);
  }
  /*
   * 智拳印 is one fist gripping the other hand's raised index finger. After
   * eight signs that mirror, the asymmetric one is what the eye catches — so
   * it is asserted rather than merely exempted, or a future mirror would
   * quietly flatten the only sign that breaks the pattern.
   */
  assert.ok(Math.abs(SEALS.retsu.left.curl - SEALS.retsu.right.curl) > 0.5,
    'one hand is closed while the other stays open');
});

/* ------------------------------------------------------------- geometry */

test('curling moves the fingertips toward the palm, on both tiers', async () => {
  /*
   * Written because this exact sign has now been wrong four times, in four
   * places, and every one of them compiled, ran, and looked reasonable in the
   * source. A fingertip that travels *away* from the palm as the hand closes
   * is a fist that looks identical to an open hand — which is precisely how it
   * shipped once. The invariant is geometric, so test it geometrically.
   */
  const { Group, Vector3 } = await import('three');
  const { buildArm, createMaterials, TIER } = await import('../src/world/HandAssets.js');
  const { FirstPersonHands } = await import('../src/world/FirstPersonHands.js');

  for (const tier of [TIER.PROCEDURAL, TIER.HIGH]) {
    const arm = new Group();
    const built = buildArm(arm, -1, createMaterials(tier), tier, -0.31);
    arm.userData = { side: -1, ...built };

    const tipOf = () => {
      arm.updateMatrixWorld(true);
      const finger = built.fingers[1];
      // The asset tier says where its own tip is; measuring the finger's origin
      // reports the knuckle, which barely moves and hides the whole bug.
      const [x, y, z] = finger.userData.tipOffset;
      return finger.userData.tipObject.localToWorld(new Vector3(x, y, z));
    };

    FirstPersonHands.prototype._shapeHand.call({}, arm, 0, 0);
    const open = tipOf();
    FirstPersonHands.prototype._shapeHand.call({}, arm, 1, 0);
    const closed = tipOf();

    assert.ok(closed.y < open.y - 0.005,
      `${tier}: the fingertip drops toward the palm when the hand closes ` +
      `(${open.y.toFixed(3)} → ${closed.y.toFixed(3)})`);
  }
});

test('the high tier gives fingers a second joint and the procedural one does not', async () => {
  const { Group } = await import('three');
  const { buildArm, createMaterials, TIER } = await import('../src/world/HandAssets.js');

  const parts = {};
  for (const tier of [TIER.PROCEDURAL, TIER.HIGH]) {
    const arm = new Group();
    parts[tier] = buildArm(arm, -1, createMaterials(tier), tier, -0.31);
  }
  assert.equal(parts[TIER.PROCEDURAL].fingers[0].userData.distal, undefined);
  assert.ok(parts[TIER.HIGH].fingers[0].userData.distal, 'two joints up here');

  // Both must present the same skeleton, or a gesture would play on one tier
  // and break on the other.
  for (const key of ['hand', 'knuckle', 'fingers', 'thumb']) {
    assert.ok(parts[TIER.PROCEDURAL][key], `procedural has ${key}`);
    assert.ok(parts[TIER.HIGH][key], `high has ${key}`);
  }
  assert.equal(parts[TIER.PROCEDURAL].fingers.length, parts[TIER.HIGH].fingers.length);
});

test('the procedural tier needs no files at all', async () => {
  const { createMaterials, TIER } = await import('../src/world/HandAssets.js');
  const { skin } = createMaterials(TIER.PROCEDURAL);
  assert.equal(skin.map, null, 'no texture to fetch, so nothing to fail');
  assert.equal(skin.type, 'MeshStandardMaterial');
});

test('the seal keeps both hands on screen, all nine signs, portrait and desktop', async () => {
  /*
   * The composition constant moved — 0.52 of the half-frame out to 0.41, off
   * measured footage — and at the same time the seal stopped being one shape
   * and became nine, one of which (日輪印) deliberately drops the hands and
   * splays the fingers as wide as the rig goes. Either change alone is safe;
   * together they are exactly the setup where a gesture ends up half off the
   * edge on the aspect ratio nobody tested.
   *
   * So sweep the whole clip and project every fingertip. Portrait is the case
   * that matters: a phone held upright has a horizontal field under half the
   * desktop one, and this is the build people actually play on a phone.
   */
  const { PerspectiveCamera, Vector3 } = await import('three');
  const { FirstPersonHands } = await import('../src/world/FirstPersonHands.js');
  const { CLIPS: C } = await import('../src/world/HandPoses.js');

  for (const [label, aspect] of [['desktop', 16 / 9], ['portrait', 0.46]]) {
    const camera = new PerspectiveCamera(46, aspect, 0.1, 100);
    const hands = new FirstPersonHands(camera);
    hands.setVisible(true);
    hands._clip = C.seal;
    hands._charging = true;
    hands._weight = 1;
    hands._targetWeight = 1;

    let worst = { x: 0, y: 0, t: 0 };
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      hands._clipTime = t;
      hands.update(0, 0);          // dt 0, so the cursor stays where it was put
      camera.updateMatrixWorld(true);

      for (const arm of hands.hands) {
        for (const finger of arm.userData.fingers) {
          const [fx, fy, fz] = finger.userData.tipOffset;
          const p = finger.userData.tipObject.localToWorld(new Vector3(fx, fy, fz));
          p.project(camera);
          if (Math.abs(p.x) > Math.abs(worst.x)) worst = { ...worst, x: p.x, t };
          if (Math.abs(p.y) > Math.abs(worst.y)) worst = { ...worst, y: p.y, t };
        }
      }
    }

    assert.ok(Math.abs(worst.x) <= 1,
      `${label}: fingertips stay inside the frame horizontally ` +
      `(worst ${worst.x.toFixed(2)} at t=${worst.t.toFixed(2)})`);
    // The bottom edge is allowed — wrists run off it, as they do in the
    // reference, where the forearms enter from below and are cut by the frame.
    assert.ok(worst.y <= 1,
      `${label}: nothing rides off the top (worst ${worst.y.toFixed(2)})`);
    hands.dispose();
  }
});

test('both arms share their geometry', async () => {
  /*
   * Nothing about a forearm, a wrist, a palm or a finger is side-dependent —
   * only where the thumb sits, and that is a mesh transform. Building them per
   * arm put 24 distinct geometries on screen where 6 will do, and the waste is
   * invisible in the source because each arm's construction looks correct in
   * isolation.
   */
  const { Group } = await import('three');
  const { buildArm, createMaterials, TIER, disposeSharedGeometry } =
    await import('../src/world/HandAssets.js');

  for (const tier of [TIER.PROCEDURAL, TIER.HIGH]) {
    disposeSharedGeometry();
    const materials = createMaterials(tier);
    const geometries = new Set();
    let meshes = 0;
    for (const side of [-1, 1]) {
      const arm = new Group();
      buildArm(arm, side, materials, tier, -0.31);
      arm.traverse((node) => {
        if (!node.geometry) return;
        meshes++;
        geometries.add(node.geometry.uuid);
      });
    }
    assert.ok(geometries.size * 2 <= meshes,
      `${tier}: ${meshes} meshes drawn from ${geometries.size} geometries — the pair is not sharing`);
  }
  disposeSharedGeometry();
});

test('u runs exactly one turn, so a whole number of tiles closes the seam', async () => {
  /*
   * `CapsuleGeometry` emits `-1/(2s) .. 1 + 1/(2s)`, and `s` differs between
   * the wrist, the palm and the fingers — 1.0625, 1.05 and 1.0833 measured.
   * Three spans on one shared material meant no `repeat` could close the seam
   * for all of them, and the tile met itself 346 pixels out of 1024 down the
   * length of every finger. Since `bumpMap` differentiates the UV, that was a
   * specular line as well as a colour break.
   */
  const { Group } = await import('three');
  const { buildArm, createMaterials, TIER, disposeSharedGeometry } =
    await import('../src/world/HandAssets.js');

  for (const tier of [TIER.PROCEDURAL, TIER.HIGH]) {
    disposeSharedGeometry();
    const arm = new Group();
    buildArm(arm, -1, createMaterials(tier), tier, -0.31);
    arm.traverse((node) => {
      const uv = node.geometry?.attributes.uv;
      if (!uv) return;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        if (u < min) min = u;
        if (u > max) max = u;
      }
      assert.ok(Math.abs(min) < 1e-6 && Math.abs(max - 1) < 1e-6,
        `${tier}: u spans ${min.toFixed(4)}..${max.toFixed(4)}, not 0..1`);
    });
  }
  disposeSharedGeometry();
});

test('the high skin material compiles no clearcoat lobe', async () => {
  // Any non-zero clearcoat defines USE_CLEARCOAT and compiles in a second
  // specular lobe plus an IBL sample, for every fragment of both hands. It was
  // set to 0.06, which nobody can see.
  const { createMaterials, TIER } = await import('../src/world/HandAssets.js');
  assert.equal(createMaterials(TIER.HIGH).skin.clearcoat, 0);
});
