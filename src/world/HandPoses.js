/**
 * HandPoses.js — what the hands do, as data.
 *
 * Content, not machinery, for the same reason `campaign.js` is: these numbers
 * get nudged every time a gesture reads wrong, while `FirstPersonHands` holds
 * the evaluator that never changes. A pose tweak and a blending fix should not
 * land in the same file.
 *
 * Two references shaped this:
 *
 *   hand seals      a first-person view of somebody forming signs — hands meet
 *                   at the centre of the chest, hold, and break outward. This
 *                   is what the microphone drives: while you are speaking, the
 *                   hands are *preparing*, and the spell is the release.
 *   weapon handling animation reference notable for weight rather than speed —
 *                   nothing starts instantly. Every clip here anticipates in
 *                   the opposite direction before it moves, and overshoots
 *                   before it settles. That is the whole difference between a
 *                   cast that reads as a throw and one that reads as a twitch.
 *
 * A pose is a *delta from rest*, never an absolute: rest is solved per frame
 * from the frustum so the hands sit correctly on any aspect ratio, and a clip
 * that specified absolute positions would fight that solve on every phone.
 */

/**
 * @param {number[]} pos metres, camera space
 * @param {number[]} rot radians
 * @param {number} curl 0 open palm, 1 closed fist
 * @param {number} spread 0 fingers together, 1 splayed
 */
const P = (pos = [0, 0, 0], rot = [0, 0, 0], curl = 0, spread = 0) => ({ pos, rot, curl, spread });

/** Rest, so a keyframe can say "back to neutral" without repeating zeroes. */
export const REST = P();

/*
 * Clips.
 *
 * `t` is normalised, so a clip can be retimed by changing one number rather
 * than every key. Keys must be sorted; the evaluator does not sort them,
 * because a clip with keys out of order is an authoring mistake worth seeing.
 *
 * The shapes, and why each is a separate clip rather than one parameterised
 * motion: a lance is a straight punch, a meteor is an overhead slam, and a
 * zone is a downward press. Those read as three different intents, and blending
 * between them through a single "power" number produced something that read as
 * none of them.
 */
export const CLIPS = {
  /**
   * Held while the microphone is open.
   *
   * Loops, because it lasts as long as somebody is talking and there is no way
   * to know in advance how long that is. The hands come together and stay
   * *slightly* alive — a frozen ready pose reads as the game having hung.
   */
  seal: {
    duration: 1.6,
    loop: true,
    keys: [
      { t: 0.0, left: P([0.07, 0.05, 0.06], [-0.5, 0.5, 0.3], 0.55, 0),
                right: P([-0.07, 0.05, 0.06], [-0.5, -0.5, -0.3], 0.55, 0) },
      { t: 0.5, left: P([0.08, 0.075, 0.05], [-0.56, 0.54, 0.34], 0.62, 0),
                right: P([-0.08, 0.075, 0.05], [-0.56, -0.54, -0.34], 0.62, 0) },
      { t: 1.0, left: P([0.07, 0.05, 0.06], [-0.5, 0.5, 0.3], 0.55, 0),
                right: P([-0.07, 0.05, 0.06], [-0.5, -0.5, -0.3], 0.55, 0) }
    ]
  },

  /** Line casts — ice, thunder, void, beam. One hand leads, the other braces. */
  thrust: {
    duration: 0.52,
    keys: [
      { t: 0.0,  left: REST, right: REST },
      // Anticipation: back and down before anything goes forward.
      { t: 0.18, left: P([0.03, -0.02, 0.10], [0.22, 0.1, 0.05], 0.8, 0),
                 right: P([-0.02, -0.03, 0.12], [0.3, -0.05, -0.06], 0.85, 0) },
      // Release. The leading hand opens as it drives out.
      { t: 0.42, left: P([-0.01, 0.03, -0.20], [-0.5, -0.06, -0.04], 0.1, 0.7),
                 right: P([0.02, 0.0, -0.08], [-0.25, 0.05, 0.05], 0.5, 0.2) },
      // Overshoot, then settle — the follow-through is what carries the weight.
      { t: 0.68, left: P([0.0, 0.01, -0.05], [-0.18, -0.02, 0.0], 0.3, 0.3),
                 right: P([0.0, 0.0, -0.02], [-0.1, 0.0, 0.0], 0.35, 0.1) },
      { t: 1.0,  left: REST, right: REST }
    ]
  },

  /** Meteor and phoenix — up, then down through the shot. */
  overhead: {
    duration: 0.66,
    keys: [
      { t: 0.0,  left: REST, right: REST },
      { t: 0.24, left: P([0.02, 0.12, 0.03], [-0.92, 0.16, 0.1], 0.7, 0),
                 right: P([-0.02, 0.12, 0.03], [-0.92, -0.16, -0.1], 0.7, 0) },
      { t: 0.30, left: P([0.02, 0.135, 0.025], [-0.96, 0.16, 0.1], 0.75, 0),
                 right: P([-0.02, 0.135, 0.025], [-0.96, -0.16, -0.1], 0.75, 0) },
      { t: 0.52, left: P([0.01, -0.08, -0.14], [0.5, 0.06, 0.04], 0.15, 0.6),
                 right: P([-0.01, -0.08, -0.14], [0.5, -0.06, -0.04], 0.15, 0.6) },
      { t: 0.74, left: P([0.0, -0.02, -0.04], [0.16, 0.02, 0.0], 0.3, 0.3),
                 right: P([0.0, -0.02, -0.04], [0.16, -0.02, 0.0], 0.3, 0.3) },
      { t: 1.0,  left: REST, right: REST }
    ]
  },

  /** Zone casts — snare, glacier, singularity, worldtree. Palms turned down. */
  ground: {
    duration: 0.7,
    keys: [
      { t: 0.0,  left: REST, right: REST },
      { t: 0.22, left: P([0.05, 0.10, 0.04], [-0.75, 0.3, 0.5], 0.35, 0.4),
                 right: P([-0.05, 0.10, 0.04], [-0.75, -0.3, -0.5], 0.35, 0.4) },
      // The press. Palms rotate flat and push down and out.
      { t: 0.48, left: P([0.05, -0.06, -0.10], [0.85, 0.24, 0.55], 0.0, 1.0),
                 right: P([-0.05, -0.06, -0.10], [0.85, -0.24, -0.55], 0.0, 1.0) },
      { t: 0.72, left: P([0.04, -0.05, -0.04], [0.5, 0.14, 0.34], 0.1, 0.8),
                 right: P([-0.04, -0.05, -0.04], [0.5, -0.14, -0.34], 0.1, 0.8) },
      { t: 1.0,  left: REST, right: REST }
    ]
  },

  /** Rift Sever — a diagonal cut, one arm across the body. */
  sweep: {
    duration: 0.48,
    keys: [
      { t: 0.0,  left: REST, right: REST },
      // The cross-body reach compounds with the arm's own outward yaw; measured
      // at ndc x 1.00 — exactly on the edge — before these were reined in.
      { t: 0.2,  left: P([0.075, 0.09, 0.06], [-0.5, 0.55, 0.7], 0.75, 0),
                 right: P([-0.03, -0.02, 0.06], [0.2, -0.1, 0.0], 0.7, 0) },
      { t: 0.44, left: P([-0.085, -0.07, -0.12], [0.3, -0.5, -0.9], 0.2, 0.5),
                 right: P([0.01, 0.0, -0.04], [-0.1, 0.05, 0.05], 0.5, 0.1) },
      { t: 0.7,  left: P([-0.03, -0.02, -0.03], [0.1, -0.18, -0.3], 0.35, 0.3),
                 right: REST },
      { t: 1.0,  left: REST, right: REST }
    ]
  },

  /** Force Repulse — both palms out, a shove rather than a throw. */
  shove: {
    duration: 0.44,
    keys: [
      { t: 0.0,  left: REST, right: REST },
      { t: 0.2,  left: P([0.05, 0.02, 0.11], [-0.1, 0.35, 0.2], 0.6, 0.2),
                 right: P([-0.05, 0.02, 0.11], [-0.1, -0.35, -0.2], 0.6, 0.2) },
      { t: 0.44, left: P([0.03, 0.02, -0.19], [-0.15, 0.1, 0.05], 0.0, 1.0),
                 right: P([-0.03, 0.02, -0.19], [-0.15, -0.1, -0.05], 0.0, 1.0) },
      { t: 0.72, left: P([0.01, 0.0, -0.04], [-0.05, 0.03, 0.0], 0.15, 0.6),
                 right: P([-0.01, 0.0, -0.04], [-0.05, -0.03, 0.0], 0.15, 0.6) },
      { t: 1.0,  left: REST, right: REST }
    ]
  },

  /** Verdant Heal — inward, toward the chest, the one gesture that comes back. */
  gather: {
    duration: 0.8,
    keys: [
      { t: 0.0,  left: REST, right: REST },
      // Measured leaving the frame at ±0.10 with a 0.6 yaw: the two compound,
      // and the hand swung to ndc x 1.32 — off screen, mid-heal.
      { t: 0.28, left: P([0.05, -0.02, -0.08], [-0.3, 0.34, 0.4], 0.1, 0.9),
                 right: P([-0.05, -0.02, -0.08], [-0.3, -0.34, -0.4], 0.1, 0.9) },
      { t: 0.58, left: P([0.02, 0.06, 0.05], [-0.7, 0.22, 0.25], 0.5, 0.2),
                 right: P([-0.02, 0.06, 0.05], [-0.7, -0.22, -0.25], 0.5, 0.2) },
      { t: 1.0,  left: REST, right: REST }
    ]
  }
};

/**
 * Which gesture each spell uses.
 *
 * Grouped by what the cast *is*, not by element: two line casts that look
 * nothing alike still throw the same way, and a hand animation that tried to
 * be unique per element would be nine variations nobody could tell apart.
 */
export const CAST_CLIPS = {
  ice: 'thrust',
  thunder: 'thrust',
  beam: 'thrust',
  void: 'sweep',
  meteor: 'overhead',
  phoenix: 'overhead',
  snare: 'ground',
  glacier: 'ground',
  singularity: 'ground',
  worldtree: 'ground',
  repulse: 'shove',
  heal: 'gather'
};

/** The clip a cast should play, falling back to the generic throw. */
export function clipForElement(element) {
  return CLIPS[CAST_CLIPS[element] ?? 'thrust'] ?? CLIPS.thrust;
}

/** Smoothstep — eases every segment so no keyframe lands as a corner. */
const ease = (t) => t * t * (3 - 2 * t);

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Sample a clip at normalised time, into `out`.
 *
 * Writes into a scratch object rather than allocating: this runs twice a frame,
 * every frame, for the whole session.
 */
export function sampleClip(clip, t, out) {
  const keys = clip.keys;
  const time = clip.loop ? t % 1 : Math.max(0, Math.min(1, t));

  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < time) i++;

  const a = keys[i];
  const b = keys[i + 1] ?? a;
  const span = b.t - a.t;
  const local = span > 1e-6 ? ease((time - a.t) / span) : 0;

  for (const side of ['left', 'right']) {
    const from = a[side];
    const to = b[side];
    const dst = out[side];
    for (let axis = 0; axis < 3; axis++) {
      dst.pos[axis] = lerp(from.pos[axis], to.pos[axis], local);
      dst.rot[axis] = lerp(from.rot[axis], to.rot[axis], local);
    }
    dst.curl = lerp(from.curl, to.curl, local);
    dst.spread = lerp(from.spread, to.spread, local);
  }
  return out;
}

/** A scratch pair for `sampleClip` to write into. */
export function makeSample() {
  return {
    left: { pos: [0, 0, 0], rot: [0, 0, 0], curl: 0, spread: 0 },
    right: { pos: [0, 0, 0], rot: [0, 0, 0], curl: 0, spread: 0 }
  };
}
