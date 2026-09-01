/**
 * HandRig.js — the skeleton, as measurements.
 *
 * Data, not machinery, for the same reason `HandPoses` is: these numbers get
 * nudged whenever a hand reads wrong, while `HandMesh` holds the sweep that
 * turns them into a surface and never changes.
 *
 * Twenty bones. The old rig had six per hand — a wrist, a shared knuckle, four
 * two-segment fingers and a thumb that was one capsule — and its limits showed
 * up as specific things that could not be done: a fist whose fingertips reach
 * the palm needs a third phalanx, and a thumb that opposes needs a metacarpal.
 *
 * ## Where the numbers come from
 *
 * Phalanx proportions are the standard anatomical ones: within a finger the
 * three bones run roughly 0.45 / 0.31 / 0.24 of its length, proximal to distal.
 * Between fingers, middle is longest at 1.00, ring 0.96, index 0.93, little
 * 0.76.
 *
 * `self-created/measure-hand.mjs` cross-checks that against a photograph of an
 * open hand — a polar profile from the palm centroid, where fingertips are the
 * maxima and web spaces the minima. It measured four clearly different lengths
 * spanning 0.65 to 1.00. The spread is wider than the anatomical figures
 * because the hand in that photograph is tilted and the outer fingers are
 * foreshortened, so the photograph is not the source of these ratios — but it
 * settles the thing that actually matters, which is that the four fingers are
 * *not the same length*. The rig they replace made all four identical.
 *
 * Absolute size is inherited rather than measured: the total reach from knuckle
 * to fingertip stays at the 94mm the previous rig used, because
 * `FirstPersonHands._placeInFrustum` solves the on-screen composition against
 * it and changing both at once would make a framing regression look like a
 * modelling one.
 *
 * ## Axes
 *
 * Bones extend along **-z**, the same convention the poses are authored in, so
 * "toward the palm" stays -y and a curl stays a negative rotation about x.
 * Getting this wrong has cost six sign errors on one axis already; there is a
 * test that a fingertip travels toward the palm as the hand closes, and it
 * exists because every one of those errors compiled and looked reasonable.
 */

/** Knuckle to fingertip for the middle finger, metres. Everything scales off it. */
export const FINGER_REACH = 0.094;

/** Proximal / middle / distal, as fractions of a finger's length. */
const PHALANX = [0.45, 0.31, 0.24];

/** Length relative to the middle finger. */
const DIGIT_SCALE = { index: 0.93, middle: 1.0, ring: 0.96, little: 0.76 };

/**
 * Radius at the base of each finger's proximal phalanx, metres.
 *
 * Down from the old 13.5mm, which is 27mm across. An adult index measures
 * about 19mm at the knuckle. The fingers being too fat is a large part of why
 * the hand read as a mitten: at 27mm across on 24mm spacing they *overlapped*,
 * so there was no gap between them to see at any triangle count.
 */
const BASE_RADIUS = { index: 0.0095, middle: 0.0097, ring: 0.0090, little: 0.0080 };

/** How much thinner a phalanx is at its far end than its near one. */
const TAPER = 0.86;

/**
 * Where each finger meets the palm, in hand space, and which way it points.
 *
 * `splay` is the resting fan; `fan` is how much further `spread` opens it,
 * carried through unchanged from the old rig so a pose authored against it
 * still opens the hand by the same amount.
 */
const KNUCKLES = [
  { name: 'index', x: -0.0315, z: -0.062, splay: 0.10, fan: -0.39 },
  { name: 'middle', x: -0.0105, z: -0.066, splay: 0.02, fan: -0.13 },
  { name: 'ring', x: 0.0105, z: -0.063, splay: -0.06, fan: 0.13 },
  { name: 'little', x: 0.0315, z: -0.056, splay: -0.16, fan: 0.39 }
];

/*
 * 21mm between knuckles, not the 24mm inherited from the capsule rig. Four
 * fingers at 24mm spacing span 90mm across including their own width, and an
 * adult hand measures about 82mm at the knuckles — the old hand was not just
 * fat-fingered, it was a wide hand with fat fingers on it.
 */

/**
 * The transverse metacarpal arch.
 *
 * The palm is not a board. Its far edge curls toward the thumb as the hand
 * closes, and how much depends on the finger: the index metacarpal barely
 * moves, the little finger's moves a long way. It is most of what separates a
 * fist from four rods, and it costs one rotation per finger.
 */
export const ARCH = { index: 0, middle: 0.1, ring: 0.6, little: 1.0 };

/**
 * The thumb, which is not a finger.
 *
 * It has two phalanges rather than three, its metacarpal is mobile where the
 * others are effectively fixed, and it sits on a saddle joint rotated out of
 * the palm plane — which is what opposition is, and what lets 斗 and 前 close
 * a ring between thumb and index.
 */
const THUMB = {
  /*
   * The base is near the middle of the wrist, not out at the edge of the palm.
   *
   * Written at the palm's edge first, which is where a thumb *looks* like it
   * starts, and that put its root ring 24mm outside the palm surface — a thumb
   * floating unattached with an open hole where it should have joined. The
   * carpometacarpal joint is a wrist bone; what sits at the edge of the palm is
   * the far end of the metacarpal, and the metacarpal is what travels there.
   */
  base: { x: -0.012, y: 0, z: -0.008 },
  /*
   * Rotation about **y**, not z, and both signs are worth writing down.
   *
   * Bones run along -z, and rotating a -z vector about z does not move it at
   * all — the first version splayed the thumb by 54 degrees about the one axis
   * that leaves it pointing exactly where it started.
   *
   * About y: R_y(t) sends (0,0,-L) to (-L sin t, 0, -L cos t), so a *negative*
   * angle throws the tip to +x, which is the side the thumb is on once `side`
   * has been applied. Positive put the thumb tip at x = -60mm with the index at
   * +40mm — a hand with a thumb on each side and none where it belonged.
   *
   * About x: the fingers curl toward -y, so -y is the palm. The thumb has to
   * tilt the same way to oppose them, which is what lets 斗 and 前 close a ring
   * against the index. Positive tilts it away from the palm, into the back of
   * the hand.
   */
  rotation: { x: -0.25, y: 0.85, z: 0 },
  bones: [
    // Slimmer than it looks from outside: most of a thumb's base is thenar
    // muscle, which belongs to the palm's cross-section, not to this bone.
    { name: 'metacarpal', length: 0.042, radius: 0.0100 },
    { name: 'proximal', length: 0.030, radius: 0.0098 },
    { name: 'distal', length: 0.024, radius: 0.0088 }
  ]
};

/**
 * The palm's cross-section, station by station.
 *
 * `t` runs 0 at the wrist to 1 at the knuckle line, and overshoots at both ends
 * so the form closes rather than stopping square. `w` and `h` scale the palm's
 * width and thickness; `thenar` is the pad at the base of the thumb, added on
 * the thumb side only — a palm is not symmetric and adding it to the radius
 * everywhere would just make a fatter tube.
 *
 * Here rather than in `HandMesh` because it is a measurement, and because the
 * test that checks each digit's root is buried inside the palm has to ask the
 * same question the sweep answers.
 */
export const PALM_STATIONS = Object.freeze([
  { t: -0.10, w: 0.36, h: 0.62, thenar: 0.0 },
  { t: 0.00, w: 0.46, h: 0.74, thenar: 0.14 },
  { t: 0.26, w: 0.72, h: 0.92, thenar: 0.34 },
  { t: 0.52, w: 0.92, h: 1.00, thenar: 0.30 },
  { t: 0.78, w: 1.00, h: 0.96, thenar: 0.14 },
  { t: 1.00, w: 0.98, h: 0.88, thenar: 0.0 },
  { t: 1.10, w: 0.80, h: 0.66, thenar: 0.0 }
]);

/**
 * The palm's half-width, half-thickness and thenar bulge at a fraction along.
 *
 * @returns {{rx: number, ry: number, thenar: number}} metres, metres, ratio
 */
export function palmProfile(rig, t) {
  const S = PALM_STATIONS;
  const clamped = Math.max(S[0].t, Math.min(S[S.length - 1].t, t));
  for (let i = 0; i < S.length - 1; i++) {
    if (clamped < S[i].t || clamped > S[i + 1].t) continue;
    const k = (clamped - S[i].t) / (S[i + 1].t - S[i].t);
    return {
      rx: (rig.palm.width / 2) * (S[i].w + (S[i + 1].w - S[i].w) * k),
      ry: (rig.palm.thickness / 2) * (S[i].h + (S[i + 1].h - S[i].h) * k),
      thenar: S[i].thenar + (S[i + 1].thenar - S[i].thenar) * k
    };
  }
  return { rx: 0, ry: 0, thenar: 0 };
}

/**
 * How far inside the palm surface a digit's open root ring sits, metres.
 *
 * The root rings are the only holes in the mesh — the sweep builds the palm and
 * the five digits as separate shells sharing one skeleton — so they have to be
 * buried, and "buried" is a number, not an opinion. Negative means the ring
 * pokes out and you can see into the digit.
 */
export function rootClearance(rig, digit) {
  const { rx, ry, thenar } = palmProfile(rig, Math.abs(digit.base.z) / rig.palm.depth);
  const radius = digit.bones[0].radius;
  // The bulge sits on the thumb side, which is the side the thumb is on.
  const towardThumb = digit.name === 'thumb' ? 1 : 0;
  const halfWidth = rx * (1 + thenar * towardThumb);
  return Math.min(
    halfWidth - (Math.abs(digit.base.x) + radius),
    ry - (Math.abs(digit.base.y) + radius)
  );
}

/**
 * Build the rig for one side.
 *
 * Mirrored by x, and by x alone. Writing both sides out is how six sign errors
 * landed on one axis in the poses; one source of truth per measurement means a
 * hand cannot disagree with itself.
 *
 * @param {number} side -1 screen-left, +1 screen-right
 */
export function buildRig(side = -1) {
  const digits = KNUCKLES.map(({ name, x, z, splay, fan }) => {
    const scale = DIGIT_SCALE[name];
    const total = FINGER_REACH * scale;
    let radius = BASE_RADIUS[name];
    const bones = PHALANX.map((fraction, i) => {
      const bone = {
        name: ['proximal', 'middle', 'distal'][i],
        length: total * fraction,
        radius,
        tipRadius: radius * TAPER
      };
      radius *= TAPER;
      return bone;
    });
    return {
      name,
      base: { x: side * x, y: 0, z },
      // Splay fans outward from the middle finger, so it flips with the hand.
      rotation: { x: 0, y: side * splay, z: 0 },
      fan: side * fan,
      arch: ARCH[name],
      bones
    };
  });

  const thumb = {
    name: 'thumb',
    base: { x: side * THUMB.base.x, y: THUMB.base.y, z: THUMB.base.z },
    rotation: { x: THUMB.rotation.x, y: side * THUMB.rotation.y, z: THUMB.rotation.z },
    fan: 0,
    arch: 0,
    bones: THUMB.bones.map((b) => ({ ...b, tipRadius: b.radius * TAPER }))
  };

  return {
    side,
    /*
     * The palm: 66mm from wrist to knuckles, 86mm across, 30mm thick. Adult
     * measurements, and — not by accident — wide and thick enough that every
     * digit's open base ring sits *inside* this surface. Those rings are the
     * only holes in the whole mesh and they are only invisible while they are
     * buried, so a test measures the clearance rather than trusting a comment.
     */
    palm: { depth: 0.066, width: 0.086, thickness: 0.030, radius: 0.020 },
    /** Thumb first, so the digit multipliers in `HandPoses` index straight in. */
    digits: [thumb, ...digits]
  };
}

/** Total bones in one hand, for the budget test to hold a number against. */
export function boneCount(rig) {
  return 1 + rig.digits.reduce((n, d) => n + d.bones.length, 0);
}
