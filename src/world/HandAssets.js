import {
  CapsuleGeometry,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader
} from 'three';

/**
 * HandAssets.js — what the hands are made of, in two tiers.
 *
 * The animation layer does not care. `HandPoses` moves an arm, a wrist, a
 * knuckle and four fingers, and both tiers present exactly that skeleton — so
 * a gesture authored once plays on either, and swapping the look can never
 * break the motion.
 *
 *   procedural  boxes and capsules with flat colours. No files, no network, no
 *               way to fail. This is the floor: whatever else goes wrong, there
 *               are hands.
 *   high        rounder geometry, two-jointed fingers, and a skin material with
 *               the project's own generated albedo and bump. Falls back to the
 *               procedural materials if the textures do not arrive, because a
 *               missing texture must cost detail and never the hands.
 *
 * The textures are generated from a text prompt by
 * `self-created/generate-hand-skin-kling.mjs` and made tileable by
 * `self-created/process-skin.mjs`; they are the project's own. The reference
 * footage and stills informed the pose *numbers* in `HandPoses.js`, and nothing
 * from them is shipped — a texture built from somebody's photograph is that
 * photograph, processed, which is a different thing from a measurement.
 *
 * A tile rather than a painted-on hand, deliberately: a photograph of a hand
 * mapped onto this geometry fights it at every seam and reads worse than the
 * flat colour it replaced. The anatomy belongs to the mesh and the shading.
 */

export const TIER = Object.freeze({ PROCEDURAL: 'procedural', HIGH: 'high' });

const SKIN_ALBEDO = './self-created/hand-skin.jpg';
const SKIN_BUMP = './self-created/hand-skin-bump.jpg';

/**
 * Radial segments around a high-tier finger.
 *
 * 12 was visibly faceted, which is most of what "the hands look coarse" meant.
 * A finger is 27mm across and covers a real fraction of a phone screen at
 * 0.56m, so the polygon edges read. 20 costs about 900 triangles a hand more,
 * paid for several times over by the geometry now being shared between the
 * two arms rather than built twice.
 */
const FINGER_SEGMENTS = 20;

/**
 * Build the materials for a tier.
 *
 * The high tier's textures load after the fact and are assigned when they
 * arrive; nothing waits on them, so a slow or failed fetch delays no frame.
 */
export function createMaterials(tier) {
  const sleeve = new MeshStandardMaterial({ color: 0x2a3340, roughness: 0.9, metalness: 0 });

  if (tier !== TIER.HIGH) {
    const skin = new MeshStandardMaterial({ color: 0xb98a68, roughness: 0.82, metalness: 0 });
    return { skin, sleeve, materials: [skin, sleeve] };
  }

  /*
   * `sheen` is the cheap approximation of skin that actually helps here.
   * Subsurface scattering is out of reach for a handful of small meshes on a
   * phone, but the thing it buys — a soft warm falloff at grazing angles
   * instead of a hard plastic edge — is exactly what sheen does.
   */
  const skin = new MeshPhysicalMaterial({
    color: 0xc59a78,
    roughness: 0.68,
    metalness: 0,
    sheen: 0.55,
    sheenColor: 0xff9c7a,
    sheenRoughness: 0.8
  });
  /*
   * No clearcoat. It was 0.06, which is invisible — and any non-zero value
   * defines USE_CLEARCOAT, compiling in a whole second specular lobe and an
   * extra IBL sample for every fragment of both hands. Paying a shader
   * permutation for something nobody can see.
   */

  /*
   * Only where there is a DOM to load into.
   *
   * `TextureLoader` builds an `<img>`, so constructing the high tier under Node
   * throws — which is where the tests build it to check the skeleton matches
   * the procedural one. Skipping the load here is the same path a failed fetch
   * takes: the material keeps its flat colour and the hands are fine.
   */
  if (typeof document === 'undefined') return { skin, sleeve, materials: [skin, sleeve] };

  const loader = new TextureLoader();
  loader.load(SKIN_ALBEDO, (texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    /*
     * Integer around the axis, or the tile does not meet itself.
     *
     * `u` runs 0..1 exactly once per circumference — see `normaliseU` — so a
     * whole number of tiles lands the last column on the same texel as the
     * first. 2.2 did not, and left a 346-pixel jump out of 1024 running the
     * full length of every finger, every frame. `bumpMap` differentiates the
     * UV, so it was a hard specular line as well as a colour break.
     *
     * Lengthwise it is free to be fractional: nothing wraps along `v`.
     */
    texture.repeat.set(2, 2.2);
    skin.map = texture;
    // The tile carries the colour now; tinting it again muddies it.
    skin.color.set(0xffffff);
    skin.needsUpdate = true;
  });
  loader.load(SKIN_BUMP, (texture) => {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    /*
     * Integer around the axis, or the tile does not meet itself.
     *
     * `u` runs 0..1 exactly once per circumference — see `normaliseU` — so a
     * whole number of tiles lands the last column on the same texel as the
     * first. 2.2 did not, and left a 346-pixel jump out of 1024 running the
     * full length of every finger, every frame. `bumpMap` differentiates the
     * UV, so it was a hard specular line as well as a colour break.
     *
     * Lengthwise it is free to be fractional: nothing wraps along `v`.
     */
    texture.repeat.set(2, 2.2);
    skin.bumpMap = texture;
    // Small: this is pores and creases, not knuckles. Knuckles are geometry.
    skin.bumpScale = 0.0035;
    skin.needsUpdate = true;
  });

  return { skin, sleeve, materials: [skin, sleeve] };
}

/**
 * Rescale `u` to exactly one turn, 0..1.
 *
 * `CapsuleGeometry` does not produce that. It emits `-1/(2s) .. 1 + 1/(2s)`
 * for `s` radial segments, so the span depends on the segment count — measured
 * 1.0625 for the 16-segment wrist, 1.05 for the 20-segment palm, 1.0833 for
 * the 12-segment fingers. Three different spans on one shared material, which
 * is why no single `repeat` value could ever have closed the seam: whatever
 * suits one part is wrong for the other two.
 *
 * Fixing it on the geometry instead makes the material's job trivial and keeps
 * working when a segment count changes, which the next tier of this file will
 * change again.
 */
function normaliseU(geometry) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    if (u < min) min = u;
    if (u > max) max = u;
  }
  const span = max - min;
  if (span <= 0) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) - min) / span);
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Geometry, built once and shared by both arms.
 *
 * Nothing about a forearm, a wrist, a palm or a finger is side-dependent —
 * only the thumb's placement is, and that lives on the mesh transform, not in
 * the geometry. Building them per arm meant 24 distinct geometries on screen
 * where 12 would do.
 */
const geometryCache = new Map();

function shared(key, build) {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = normaliseU(build());
    geometryCache.set(key, geometry);
  }
  return geometry;
}

/**
 * Release the shared geometry.
 *
 * Only for teardown that means it — the cache is process-wide, so disposing it
 * while a second pair of hands exists would leave that pair holding freed
 * buffers. `FirstPersonHands.dispose` deliberately does not call this.
 */
export function disposeSharedGeometry() {
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
}

/**
 * Build one arm's parts and hang them off `arm`.
 *
 * Returns the handles the animation layer needs. Both tiers return the same
 * shape; only `fingers[i].userData.distal` is tier-specific, and `_shapeHand`
 * treats it as optional.
 *
 * @param {Group} arm
 * @param {number} side -1 screen-left, +1 screen-right
 */
export function buildArm(arm, side, { skin, sleeve }, tier, PALM_Z) {
  const high = tier === TIER.HIGH;
  const seg = high ? 20 : 10;

  /*
   * Tapered, not a tube. A uniform capsule reads as a pipe; a wedge narrowing
   * into the wrist is both what an arm looks like and what keeps the eye
   * travelling toward the hand, where the gesture is. Rotated onto z, the
   * cylinder's +y end becomes the wrist end, so that is the thin one.
   */
  const forearm = new Mesh(
    shared(`forearm:${seg}`, () => new CylinderGeometry(0.032, 0.05, 0.19, seg)), sleeve);
  forearm.rotation.x = Math.PI / 2;
  forearm.position.z = -0.11;
  arm.add(forearm);

  const wrist = new Mesh(shared(`wrist:${tier}`,
    () => new CapsuleGeometry(0.031, 0.035, high ? 6 : 4, high ? 16 : 8)), skin);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.z = -0.235;
  arm.add(wrist);

  // The hand is its own group so a gesture can rotate the wrist without
  // dragging the forearm through the player's face.
  const hand = new Group();
  hand.position.z = PALM_Z;

  /*
   * The palm is the one place the tiers differ in silhouette. A box has four
   * hard edges catching the light along their whole length, which is the single
   * most plastic-looking thing in frame; a capsule squashed flat is a rounded
   * slab for the same triangle budget.
   */
  const palm = high
    ? new Mesh(shared('palm:high', () => new CapsuleGeometry(0.045, 0.052, 6, 20)), skin)
    : new Mesh(shared('palm:proc', () => new BoxGeometry(0.098, 0.034, 0.105)), skin);
  if (high) {
    palm.rotation.x = Math.PI / 2;
    palm.scale.set(1.08, 1, 0.42);
  }
  palm.position.z = -0.015;
  hand.add(palm);

  // Fingers hang off a knuckle group, which is the thing `curl` rotates.
  const knuckle = new Group();
  knuckle.position.z = -0.066;

  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const fan = (i - 1.5) * 0.26;
    const longer = i === 1 || i === 2 ? 0.009 : 0;

    if (!high) {
      // Nearly palm length. At two thirds they read as knuckles, and an open
      // hand and a fist stop being different silhouettes.
      const finger = new Mesh(
        shared('finger:proc', () => new CapsuleGeometry(0.0132, 0.094, 3, 6)), skin);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(-0.036 + i * 0.024, 0, -0.052 - longer);
      finger.userData.fan = fan;
      /*
       * Where the tip is, so callers do not have to know how this tier is
       * built. The capsule's axis is its own local y, and the mesh carries a
       * baked quarter turn — measuring the *origin* instead reports the
       * knuckle, which is what let a fist that curled the wrong way pass for
       * an open hand.
       */
      finger.userData.tipObject = finger;
      finger.userData.tipOffset = [0, 0.047, 0];
      knuckle.add(finger);
      fingers.push(finger);
      continue;
    }

    /*
     * Two joints, because one does not bend like a finger.
     *
     * A single capsule rotating at the knuckle sweeps a straight rod through an
     * arc — the fingertip travels miles and never curls. Splitting it means the
     * tip comes back toward the palm, which is what a fist is.
     */
    const finger = new Group();
    finger.position.set(-0.036 + i * 0.024, 0, -0.012);
    finger.userData.fan = fan;

    const proximal = new Mesh(
      shared('proximal:high', () => new CapsuleGeometry(0.0135, 0.05, 4, FINGER_SEGMENTS)), skin);
    proximal.rotation.x = Math.PI / 2;
    proximal.position.z = -0.032 - longer * 0.5;
    finger.add(proximal);

    const distalPivot = new Group();
    distalPivot.position.z = -0.062 - longer;
    const distal = new Mesh(
      shared('distal:high', () => new CapsuleGeometry(0.0118, 0.042, 4, FINGER_SEGMENTS)), skin);
    distal.rotation.x = Math.PI / 2;
    distal.position.z = -0.026;
    distalPivot.add(distal);
    finger.add(distalPivot);
    finger.userData.distal = distalPivot;
    finger.userData.tipObject = distalPivot;
    finger.userData.tipOffset = [0, 0, -0.047];

    knuckle.add(finger);
    fingers.push(finger);
  }
  hand.add(knuckle);

  const thumb = new Mesh(shared(`thumb:${tier}`,
    () => new CapsuleGeometry(0.015, 0.05, high ? 5 : 3, high ? FINGER_SEGMENTS : 6)), skin);
  thumb.position.set(side * -0.048, 0, -0.016);
  thumb.rotation.set(Math.PI / 2, 0, side * 0.9);
  hand.add(thumb);

  arm.add(hand);
  return { hand, knuckle, fingers, thumb };
}
