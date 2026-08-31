/**
 * HandPoses.js — what the hands do, as data.
 *
 * Content, not machinery, for the same reason `campaign.js` is: these numbers
 * get nudged every time a gesture reads wrong, while `FirstPersonHands` holds
 * the evaluator that never changes. A pose tweak and a blending fix should not
 * land in the same file.
 *
 * Three references shaped this:
 *
 *   hand seals      a first-person view of somebody forming signs — hands meet
 *                   at the centre of the chest, hold, and break outward. This
 *                   is what the microphone drives: while you are speaking, the
 *                   hands are *preparing*, and the spell is the release.
 *   the kuji-in     three stills of the nine signs, which turned the charge
 *                   pose from one held shape into a sequence. See `SEALS`.
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
 * @param {number[]} rot radians, the forearm
 * @param {number} curl 0 open palm, 1 closed fist
 * @param {number} spread 0 fingers together, 1 splayed
 * @param {number[]} wrist radians, the hand relative to the forearm
 *
 * The wrist is separate from the forearm because a real arm has two joints and
 * the interesting gestures need both: fingers pointing up while the forearm
 * still comes in from below is a wrist, and rotating the whole arm to fake it
 * swings the elbow through the frame.
 */
const P = (pos = [0, 0, 0], rot = [0, 0, 0], curl = 0, spread = 0, wrist = [0, 0, 0]) =>
  ({ pos, rot, curl, spread, wrist });

/** Rest, so a keyframe can say "back to neutral" without repeating zeroes. */
export const REST = P();

/*
 * Seals.
 *
 * The nine of the kuji-in — 临兵斗者皆阵列前行 — read off three references of
 * the same sequence: a photographed set, a high-contrast silhouette wheel that
 * settles what each shape reads as when it is only an outline, and a set of
 * twelve two-hand signs shot against black that fills in what the fingers are
 * doing underneath.
 *
 * It is the right vocabulary for this game and not a decoration: the kuji-in is
 * a sequence performed *while chanting*, one sign per syllable. That is exactly
 * what the charge pose is — the microphone is open, somebody is speaking, and
 * the hands work through signs until the words land. So the seal is a chain,
 * not a single held shape.
 *
 * The rig has a curl and a spread, not twenty joints, so an interlace is
 * approximated: fingers laced through each other are *mostly closed and not
 * spread*, and what separates 外缚 from 内缚 in a silhouette is how tight the
 * fists are and how far the wrists have rolled, both of which the rig has.
 */

/**
 * Mirror a left-hand pose onto the right.
 *
 * One source of truth per seal, deliberately. Hand-writing both sides is how
 * six sign errors landed on the same axis last time — and one of them was
 * asserted the wrong way round by its own test, so it passed alongside the bug.
 * A seal that is symmetric cannot now disagree with itself.
 */
const mirror = (p) => P(
  [-p.pos[0], p.pos[1], p.pos[2]],
  [p.rot[0], -p.rot[1], -p.rot[2]],
  p.curl, p.spread,
  [p.wrist[0], -p.wrist[1], -p.wrist[2]]
);

/** A symmetric seal, written once. */
const S = (left) => ({ left, right: mirror(left) });

export const SEALS = {
  /** 临 — 不動根本印. Palms flat together, fingers straight up and closed. */
  rin: S(P([0.076, 0.030, 0.02], [0.48, 0.34, 0.08], 0.00, 0.00, [0.92, 0.06, 0.24])),

  /** 兵 — 大金剛輪印. Laced, with the index fingers extended and crossed. */
  pyo: S(P([0.070, 0.026, 0.02], [0.46, 0.30, 0.10], 0.42, 0.08, [0.88, 0.08, 0.20])),

  /** 斗 — 外獅子印. Laced outward, thumb and index closing a ring. */
  to: S(P([0.062, 0.020, 0.03], [0.44, 0.26, 0.14], 0.58, 0.22, [0.84, 0.10, 0.16])),

  /** 者 — 内獅子印. The same lion turned inward; tighter, wrists rolled in. */
  sha: S(P([0.058, 0.016, 0.03], [0.42, 0.24, 0.20], 0.70, 0.16, [0.82, 0.12, 0.10])),

  /** 皆 — 外縛印. The outer bond: fists pressed, fingers laced outside. */
  kai: S(P([0.052, 0.010, 0.04], [0.40, 0.20, 0.16], 0.86, 0.00, [0.76, 0.10, 0.06])),

  /** 陣 — 内縛印. The inner bond, knuckles out. The tightest shape here. */
  jin: S(P([0.050, 0.006, 0.04], [0.38, 0.18, 0.22], 0.94, 0.00, [0.74, 0.12, 0.02])),

  /**
   * 列 — 智拳印. One fist grips the other hand's raised index finger.
   *
   * The only asymmetric sign in the set, and worth keeping asymmetric: after
   * eight signs that mirror, a shape where the hands are doing different things
   * is the one the eye catches. Written out on both sides rather than mirrored,
   * because there is nothing to mirror.
   */
  retsu: {
    left:  P([0.048, -0.02, 0.03], [0.38, 0.22, 0.12], 0.92, 0.00, [0.70, 0.08, 0.10]),
    right: P([-0.040, 0.03, 0.02], [0.50, -0.18, -0.06], 0.12, 0.00, [0.94, -0.06, -0.14])
  },

  /**
   * 前 — 日輪印. Thumbs and index fingers close an aperture, the rest splayed.
   *
   * The clearest silhouette of the nine — an open triangle with light through
   * it — which is why the hands drop and widen for it rather than staying on
   * the centre line. It wants to be seen against the sky, not against the
   * other hand.
   */
  zai: S(P([0.026, -0.01, 0.05], [0.34, 0.14, -0.10], 0.06, 1.00, [0.82, 0.04, -0.06])),

  /** 行 — 隠形印. Hands cupped and closed over each other. The sequence lands. */
  zen: S(P([0.056, -0.005, 0.05], [0.38, 0.26, 0.18], 0.76, 0.05, [0.72, 0.14, 0.12]))
};

/** The order they are performed in: 临兵斗者皆阵列前行. */
export const KUJI = ['rin', 'pyo', 'to', 'sha', 'kai', 'jin', 'retsu', 'zai', 'zen'];

/**
 * Build a looping clip that steps through named seals.
 *
 * Each sign is *held* and then moved out of, rather than eased continuously
 * from one to the next: a hand sign that is never still does not read as a
 * sign. `hold` is the fraction of each slot spent stationary, so the shape has
 * time to register before the hands travel to the next one.
 */
function chain(names, { slot = 0.5, hold = 0.62 } = {}) {
  const duration = slot * names.length;
  const keys = [];
  names.forEach((name, i) => {
    const seal = SEALS[name];
    if (!seal) throw new Error(`unknown seal: ${name}`);
    const start = i / names.length;
    keys.push({ t: start, left: seal.left, right: seal.right });
    keys.push({ t: start + hold / names.length, left: seal.left, right: seal.right });
  });
  // Close the loop on the first sign so the wrap is not a jump.
  keys.push({ t: 1, left: SEALS[names[0]].left, right: SEALS[names[0]].right });
  return { duration, loop: true, keys };
}

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
   * Nine signs rather than one held shape. It loops because an utterance has
   * no known length, and it *changes* because the reference is a sequence:
   * whoever is chanting works through 临兵斗者皆阵列前行 while the words come
   * out. A short word shows two or three signs, a long incantation shows all
   * nine — which means the hands report how long you have been talking without
   * anything having to draw a bar.
   *
   * Half a second a sign. Measured against the recogniser rather than chosen:
   * a typical spell phrase runs one to three seconds, so this puts two to six
   * signs on screen per cast, which is enough to read as a sequence and not so
   * many that it blurs.
   */
  seal: chain(KUJI, { slot: 0.5, hold: 0.62 }),

  /** Line casts — ice, thunder, void, beam. One hand leads, the other braces. */
  thrust: {
    duration: 0.52,
    keys: [
      { t: 0.0,  left: REST, right: REST },
      // Anticipation: back and down before anything goes forward.
      { t: 0.18, left: P([0.03, -0.02, 0.10], [0.22, 0.1, 0.05], 0.8, 0),
                 right: P([-0.02, -0.03, 0.12], [0.3, -0.05, -0.06], 0.85, 0) },
      // Release. The leading hand opens as it drives out.
      { t: 0.42, left: P([-0.01, 0.03, -0.20], [-0.5, -0.06, -0.04], 0.1, 0.7, [-0.35, 0, 0]),
                 right: P([0.02, 0.0, -0.08], [-0.25, 0.05, 0.05], 0.5, 0.2, [-0.2, 0, 0]) },
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
      { t: 0.52, left: P([0.01, -0.08, -0.14], [0.5, 0.06, 0.04], 0.15, 0.6, [0.45, 0, 0]),
                 right: P([-0.01, -0.08, -0.14], [0.5, -0.06, -0.04], 0.15, 0.6, [0.45, 0, 0]) },
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
      { t: 0.48, left: P([0.05, -0.06, -0.10], [0.85, 0.24, 0.55], 0.0, 1.0, [0.5, 0, 0]),
                 right: P([-0.05, -0.06, -0.10], [0.85, -0.24, -0.55], 0.0, 1.0, [0.5, 0, 0]) },
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
      { t: 0.44, left: P([0.03, 0.02, -0.19], [-0.15, 0.1, 0.05], 0.0, 1.0, [-0.55, 0, 0]),
                 right: P([-0.03, 0.02, -0.19], [-0.15, -0.1, -0.05], 0.0, 1.0, [-0.55, 0, 0]) },
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
      dst.wrist[axis] = lerp(from.wrist[axis], to.wrist[axis], local);
    }
    dst.curl = lerp(from.curl, to.curl, local);
    dst.spread = lerp(from.spread, to.spread, local);
  }
  return out;
}

/** A scratch pair for `sampleClip` to write into. */
export function makeSample() {
  return {
    left: { pos: [0, 0, 0], rot: [0, 0, 0], curl: 0, spread: 0, wrist: [0, 0, 0] },
    right: { pos: [0, 0, 0], rot: [0, 0, 0], curl: 0, spread: 0, wrist: [0, 0, 0] }
  };
}
