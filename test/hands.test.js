import test from 'node:test';
import assert from 'node:assert/strict';

import { CLIPS, CAST_CLIPS, SEALS, KUJI, DIGITS, clipForElement, sampleClip, makeSample }
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
   *
   * Asserted on the *effective* per-digit curl, which is where the asymmetry
   * actually lives now. It used to be a hand-wide difference — left 0.92
   * against right 0.12 — but that said "one fist and one open hand", and the
   * sign is one fist and a fist with a single finger out of it. Both hands are
   * closed; only the right index is not.
   */
  const effective = (pose, digit) => pose.curl * pose.digits[DIGITS.indexOf(digit)].curl;
  assert.ok(effective(SEALS.retsu.left, 'index') > 0.6, 'the gripping hand is closed');
  assert.ok(effective(SEALS.retsu.right, 'index') < 0.2, 'the gripped hand raises its index');
  for (const digit of ['middle', 'ring', 'little']) {
    assert.ok(effective(SEALS.retsu.right, digit) > 0.6,
      `and closes its ${digit} — it is a fist with one finger out, not an open hand`);
  }
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

test('the seal keeps the whole mesh on screen, not only the fingertips', async () => {
  /*
   * The older version of this swept the same nine signs but projected only the
   * four fingertips. That was the right test for a rig whose fingers were the
   * only thing that moved much; it is not enough for a skinned surface, where
   * a knuckle or the back of the palm can be the part that leaves the frame.
   *
   * Every eighth vertex, CPU-skinned through three's own `getVertexPosition` —
   * the same maths the shader does — so what is measured is where the pixels
   * actually land and not where the bones are.
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

    const meshes = [];
    for (const arm of hands.hands) arm.traverse((n) => { if (n.isSkinnedMesh) meshes.push(n); });
    assert.ok(meshes.length === 2, 'both hands are skinned meshes');

    const point = new Vector3();
    let worstX = 0;
    let worstY = -Infinity;
    for (let i = 0; i <= 30; i++) {
      hands._clipTime = i / 30;
      hands.update(0, 0);
      camera.updateMatrixWorld(true);
      for (const mesh of meshes) {
        const count = mesh.geometry.attributes.position.count;
        for (let v = 0; v < count; v += 8) {
          mesh.getVertexPosition(v, point);
          mesh.localToWorld(point).project(camera);
          if (Math.abs(point.x) > Math.abs(worstX)) worstX = point.x;
          if (point.y > worstY) worstY = point.y;
        }
      }
    }
    assert.ok(Math.abs(worstX) <= 1.05,
      `${label}: the hands stay in frame horizontally (worst ${worstX.toFixed(2)})`);
    // The bottom edge is allowed — wrists run off it, as they do in the
    // reference, where the forearms enter from below and are cut by the frame.
    assert.ok(worstY <= 1.05, `${label}: nothing rides off the top (worst ${worstY.toFixed(2)})`);
    hands.dispose();
  }
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

test('geometry is built once and reused', async () => {
  /*
   * Two invariants, and the second is the one with teeth.
   *
   * Building the same arm twice must return the *same* geometry objects — that
   * is the cache doing its job, and the waste it prevents is invisible in the
   * source because each arm's construction reads correctly on its own.
   *
   * Across the two arms, everything that is not chiral must be shared. A hand
   * is chiral, so the high tier's swept mesh is legitimately two buffers; a
   * forearm is not, so it had better be one.
   */
  const { Group } = await import('three');
  const { buildArm, createMaterials, TIER, disposeSharedGeometry } =
    await import('../src/world/HandAssets.js');

  for (const tier of [TIER.PROCEDURAL, TIER.HIGH]) {
    disposeSharedGeometry();
    const materials = createMaterials(tier);

    const geometriesOf = (side) => {
      const arm = new Group();
      buildArm(arm, side, materials, tier, -0.31);
      const out = [];
      arm.traverse((node) => { if (node.geometry) out.push(node.geometry); });
      return out;
    };

    const first = geometriesOf(-1);
    const again = geometriesOf(-1);
    assert.deepEqual(again, first, `${tier}: the same side rebuilt different geometry`);

    const other = geometriesOf(1);
    const shared = other.filter((g) => first.includes(g)).length;
    assert.ok(shared >= 1,
      `${tier}: the two arms share nothing, not even a forearm`);
    assert.ok(shared >= other.length - 1,
      `${tier}: ${other.length - shared} geometries differ between the arms; `
      + 'only the hand itself is chiral');
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

test('a pose that says nothing about its digits behaves exactly as before', async () => {
  /*
   * The whole reason the digit channel is multipliers rather than absolutes.
   * Forty-odd poses in this file predate it and none of them were touched; if
   * the default were anything but one, every one of them would have shifted.
   */
  const { SEALS: S, CLIPS: C, DIGITS: D } = await import('../src/world/HandPoses.js');
  const silent = [C.thrust, C.overhead, C.ground, C.sweep, C.shove, C.gather];
  for (const clip of silent) {
    for (const key of clip.keys) {
      for (const side of ['left', 'right']) {
        assert.equal(key[side].digits.length, D.length);
        for (const digit of key[side].digits) {
          assert.equal(digit.curl, 1, 'neutral curl multiplier');
          assert.equal(digit.splay, 1, 'neutral splay multiplier');
        }
      }
    }
  }
  // And the seals that do speak, speak about the digits they name and no others.
  assert.equal(S.rin.left.digits[D.indexOf('index')].curl, 1);
  assert.ok(S.zai.left.digits[D.indexOf('thumb')].curl > 1, '日輪印 bends its thumb harder');
  assert.equal(S.zai.left.digits[D.indexOf('little')].curl, 1, 'and leaves the little finger alone');
});

test('sampling still allocates nothing, digits included', async () => {
  const { CLIPS: C, sampleClip: sample, makeSample: scratch } =
    await import('../src/world/HandPoses.js');
  const out = scratch();
  const digitsBefore = out.left.digits;
  const entryBefore = out.left.digits[0];
  for (let i = 0; i <= 20; i++) sample(C.seal, i / 20, out);
  assert.equal(out.left.digits, digitsBefore, 'the digit array is reused, not rebuilt');
  assert.equal(out.left.digits[0], entryBefore, 'and so is each entry');
});

test('mirroring a seal does not swap or negate its digits', async () => {
  /*
   * The mirror of "the index finger stays straight" is "the index finger stays
   * straight" — same digit, same value. Reversing the array would have the left
   * hand extend its little finger while the right extends its index, and that
   * is the kind of wrongness that looks like a slightly odd hand rather than
   * like a bug.
   */
  const { SEALS: S, DIGITS: D } = await import('../src/world/HandPoses.js');
  for (const [name, seal] of Object.entries(S)) {
    if (name === 'retsu') continue;
    for (let d = 0; d < D.length; d++) {
      assert.equal(seal.left.digits[d].curl, seal.right.digits[d].curl,
        `${name}: ${D[d]} curl matches across the mirror`);
      assert.equal(seal.left.digits[d].splay, seal.right.digits[d].splay,
        `${name}: ${D[d]} splay matches across the mirror`);
    }
  }
});

test('_shapeHand bends a named finger without touching its neighbours', async () => {
  /*
   * The off-by-one this guards: `fingers` is index..little, `digits` is
   * thumb-first, so the finger at i wears the digit at i+1. Getting that wrong
   * gives every finger its neighbour's multiplier, which reads as a slightly
   * wrong hand and not as an error.
   */
  const { Group, Vector3 } = await import('three');
  const { buildArm, createMaterials, TIER, disposeSharedGeometry } =
    await import('../src/world/HandAssets.js');
  const { FirstPersonHands } = await import('../src/world/FirstPersonHands.js');
  const { DIGITS: D } = await import('../src/world/HandPoses.js');

  disposeSharedGeometry();
  const arm = new Group();
  const built = buildArm(arm, -1, createMaterials(TIER.HIGH), TIER.HIGH, -0.31);
  arm.userData = { side: -1, ...built };

  /*
   * Tip-to-base distance, not world height.
   *
   * Height cannot tell these apart: `knuckle.rotation.x` is driven by the
   * hand-wide curl, so the transverse arch stays rolled 66 degrees down in both
   * cases, and a *straight* finger on a rolled-down arch ends up lower than a
   * curled one that has tucked back toward the palm. Reach from the finger's
   * own base is what "straight" actually means, and it does not care which way
   * the hand is facing.
   */
  const reach = (i) => {
    arm.updateMatrixWorld(true);
    const finger = built.fingers[i];
    const [x, y, z] = finger.userData.tipOffset;
    const tip = finger.userData.tipObject.localToWorld(new Vector3(x, y, z));
    return finger.getWorldPosition(new Vector3()).distanceTo(tip);
  };

  const shape = (digits) => FirstPersonHands.prototype._shapeHand.call({}, arm, 1, 0, digits);

  const neutral = D.map(() => ({ curl: 1, splay: 1 }));
  shape(neutral);
  const closed = [0, 1, 2, 3].map(reach);

  // Straighten the index finger only. `fingers[0]` is the index.
  const indexOut = D.map((n) => ({ curl: n === 'index' ? 0 : 1, splay: 1 }));
  shape(indexOut);
  const raised = [0, 1, 2, 3].map(reach);

  assert.ok(raised[0] > closed[0] + 0.01,
    `the index reaches further when told not to curl `
    + `(${closed[0].toFixed(3)}m -> ${raised[0].toFixed(3)}m)`);
  for (const i of [1, 2, 3]) {
    assert.ok(Math.abs(raised[i] - closed[i]) < 1e-9,
      `finger ${i} does not move — it was told nothing`);
  }
  disposeSharedGeometry();
});

/* ------------------------------------------------- the swept skinned hand */

test('the swept hand is closed except where the digits enter the palm', async () => {
  /*
   * The palm and the five digits are separate shells sharing one skeleton, so
   * each digit's root ring is an open boundary. Those are the *only* holes
   * allowed, and they are only invisible while they are buried inside the palm.
   *
   * Edges are counted on welded positions, not on raw indices: the UV seam
   * duplicates coincident vertices, so a raw count reports a hole down the
   * length of every tube where there is only a texture seam.
   */
  const { buildRig, rootClearance } = await import('../src/world/HandRig.js');
  const { buildSkeleton, buildHandGeometry } = await import('../src/world/HandMesh.js');

  const rig = buildRig(-1);
  const geometry = buildHandGeometry(rig, buildSkeleton(rig));
  const position = geometry.attributes.position;
  const index = geometry.index.array;

  const key = (i) => [position.getX(i), position.getY(i), position.getZ(i)]
    .map((v) => Math.round(v * 1e6)).join(',');
  const canonical = new Map();
  const weld = new Int32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const k = key(i);
    if (!canonical.has(k)) canonical.set(k, i);
    weld[i] = canonical.get(k);
  }

  const edges = new Map();
  for (let i = 0; i < index.length; i += 3) {
    const t = [weld[index[i]], weld[index[i + 1]], weld[index[i + 2]]];
    // The fingertip fan collapses to a point, so its last band is degenerate.
    if (t[0] === t[1] || t[1] === t[2] || t[2] === t[0]) continue;
    for (const [u, v] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }

  let open = 0;
  for (const count of edges.values()) {
    assert.ok(count <= 2, 'no edge is shared by more than two faces');
    if (count === 1) open++;
  }
  // One ring of `radialSegments` edges per digit, and nothing else.
  assert.equal(open, 32 * rig.digits.length,
    `${open} open edges — expected exactly one root ring per digit`);

  for (const digit of rig.digits) {
    const clearance = rootClearance(rig, digit);
    assert.ok(clearance > 0.001,
      `${digit.name}: its root ring sits ${(clearance * 1000).toFixed(1)}mm inside the palm — `
      + 'a hole you can see into');
  }
});

test('the swept hand has usable normals, tangents and weights everywhere', async () => {
  /*
   * `USE_TANGENT` builds the entire normal-map frame from the tangent, so a
   * tangent that is not perpendicular to the normal tilts the lighting. The
   * palm's thenar bulge makes the radius vary with the angle, and the analytic
   * ring tangent that ignores that came out 8 degrees off.
   */
  const { buildRig } = await import('../src/world/HandRig.js');
  const { buildSkeleton, buildHandGeometry } = await import('../src/world/HandMesh.js');

  const rig = buildRig(-1);
  const geometry = buildHandGeometry(rig, buildSkeleton(rig));
  const normal = geometry.attributes.normal;
  const tangent = geometry.attributes.tangent;
  const weight = geometry.attributes.skinWeight;

  let worstLength = 0;
  let worstDot = 0;
  let worstWeight = 0;
  for (let i = 0; i < normal.count; i++) {
    const n = [normal.getX(i), normal.getY(i), normal.getZ(i)];
    worstLength = Math.max(worstLength, Math.abs(Math.hypot(...n) - 1));
    const t = [tangent.getX(i), tangent.getY(i), tangent.getZ(i)];
    worstDot = Math.max(worstDot, Math.abs(n[0] * t[0] + n[1] * t[1] + n[2] * t[2]));
    const sum = weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i);
    worstWeight = Math.max(worstWeight, Math.abs(sum - 1));
  }
  assert.ok(worstLength < 1e-3, `normals are unit length (worst ${worstLength.toExponential(1)})`);
  assert.ok(worstDot < 1e-4, `tangents are perpendicular (worst ${worstDot.toExponential(1)})`);
  assert.ok(worstWeight < 1e-5, `skin weights sum to one (worst ${worstWeight.toExponential(1)})`);
});

test('a fist actually closes', async () => {
  /*
   * The thing the two-phalanx rig could not do. A rod pivoting at the knuckle
   * sweeps an arc; without a middle phalanx the tip runs out of angle before it
   * gets anywhere near the palm, so a fist was a slightly shorter open hand.
   */
  const { PerspectiveCamera, Vector3 } = await import('three');
  const { FirstPersonHands } = await import('../src/world/FirstPersonHands.js');
  const { DIGITS: D } = await import('../src/world/HandPoses.js');

  const camera = new PerspectiveCamera(46, 16 / 9, 0.1, 100);
  const hands = new FirstPersonHands(camera);
  hands.setVisible(true);
  const arm = hands.hands[0];
  const neutral = D.map(() => ({ curl: 1, splay: 1 }));

  const reach = () => {
    arm.updateMatrixWorld(true);
    const wrist = arm.userData.hand.getWorldPosition(new Vector3());
    return arm.userData.fingers.map((finger) => {
      const [x, y, z] = finger.userData.tipOffset;
      return finger.userData.tipObject.localToWorld(new Vector3(x, y, z)).distanceTo(wrist);
    });
  };

  hands._shapeHand(arm, 0, 0, neutral);
  const open = reach();
  hands._shapeHand(arm, 1, 0, neutral);
  const closed = reach();

  for (let i = 0; i < open.length; i++) {
    assert.ok(closed[i] < open[i] * 0.45,
      `finger ${i} closes to under half its open reach `
      + `(${(open[i] * 1000).toFixed(0)}mm -> ${(closed[i] * 1000).toFixed(0)}mm)`);
  }
  hands.dispose();
});

test('the hands stay inside their budget', async () => {
  /*
   * Written so this cannot creep back. The pair used to be 24 meshes and 24
   * distinct geometries; each of those is a draw call, twice a frame, since the
   * hands appear in the depth prepass as well as the main pass.
   */
  const { PerspectiveCamera } = await import('three');
  const { FirstPersonHands } = await import('../src/world/FirstPersonHands.js');
  const { disposeSharedGeometry } = await import('../src/world/HandAssets.js');

  disposeSharedGeometry();
  const started = performance.now();
  const hands = new FirstPersonHands(new PerspectiveCamera(46, 16 / 9, 0.1, 100));
  const elapsed = performance.now() - started;

  let meshes = 0;
  let triangles = 0;
  const geometries = new Set();
  for (const arm of hands.hands) {
    arm.traverse((node) => {
      if (!node.geometry) return;
      meshes++;
      if (geometries.has(node.geometry)) return;
      geometries.add(node.geometry);
      const g = node.geometry;
      triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    });
  }

  assert.ok(meshes <= 4, `${meshes} draw calls for the pair — two hands and two sleeves is the budget`);
  assert.ok(triangles <= 12000, `${triangles} triangles for the pair`);
  assert.ok(elapsed < 120, `built in ${elapsed.toFixed(0)}ms`);
  hands.dispose();
});
