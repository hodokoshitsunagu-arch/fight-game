import { Vector3, Quaternion } from 'three';

/**
 * HandRetarget.js — drive somebody else's hand rig with our poses.
 *
 * The tier this exists for loads a rigged hand from a file. The mesh and the
 * skeleton are then whatever the author made them, and the numbers in
 * `HandPoses` are not: every one of them is written against this project's
 * conventions — bones extend along -z, the palm is -y, a curl is a negative
 * rotation about x. A foreign rig whose bones run along +y curls sideways.
 *
 * Mapping bone *names* is not enough, and that is the whole reason this file is
 * more than twenty lines. Names get you which bone is the index finger's middle
 * phalanx; they tell you nothing about which way it bends.
 *
 * ## What is derived rather than assumed
 *
 * For each bone, the axis it flexes about is computed from the rig's own
 * geometry:
 *
 *   d   the direction to the next joint, in the bone's local space — where the
 *       bone actually points, whatever the author's convention was
 *   p   the direction the fingers close toward, in the same space
 *
 * Rotating `d` about `d × p` by a positive angle moves it toward `p`. That is
 * Rodrigues' formula and it holds in any frame, so the flex axis falls out of
 * the model with nothing assumed about how it was authored.
 *
 * Finding `p` is the one genuinely ambiguous step. The palm normal is
 * perpendicular to the knuckle line and to the fingers, which leaves two
 * candidate directions; the thumb settles it, because a thumb is rotated out of
 * the hand's plane *toward* the palm and no other digit is.
 */

/**
 * Which of our roles a foreign bone name means.
 *
 * Deliberately loose. Rigs in the wild spell these `f_index.01.L`,
 * `LeftHandIndex1`, `thumb_02_l`, `Bip01_L_Finger12` and a dozen other ways,
 * and all of them agree on the digit word and on the digits being numbered
 * outward from the palm.
 */
const DIGIT_WORDS = {
  thumb: 'thumb',
  index: 'index',
  middle: 'middle',
  ring: 'ring',
  little: 'little',
  pinky: 'little',
  pinkie: 'little'
};

/**
 * The legacy 3ds Max / Biped naming, which has no digit words at all.
 *
 * `Bip01_L_Finger12` is the index finger's second segment: digit 1, segment 2,
 * numbered from zero, with the thumb as digit 0. Still common in older assets
 * and completely opaque to a word matcher.
 */
const BIPED = /finger(\d)(\d)?$/;
const BIPED_DIGITS = ['thumb', 'index', 'middle', 'ring', 'little'];

/**
 * Read a bone's name as the digit it belongs to.
 *
 * Only the digit. *Not* which segment — that used to be parsed out of the
 * name and it was wrong on the first real rig it met: almost every hand has a
 * fourth "tip" or "end" bone per finger, `LeftHandIndex4` left `4` after the
 * digit word, matched none of the segment patterns, and fell through to a
 * default that called it the knuckle. The tip bone then overwrote the actual
 * knuckle and every finger was retargeted from its own fingertip.
 *
 * Segment order comes from the hierarchy instead, in `findHandBones`. A finger
 * is a parent-to-child chain, so depth says which bone is which without caring
 * whether the author numbered from zero, from one, or not at all.
 *
 * `middle` is the other trap: it is both a digit name and a segment name. The
 * digit is matched by longest word, so `MiddleFinger2` is the middle finger.
 */
export function readBoneName(raw) {
  const name = String(raw ?? '').toLowerCase();

  const biped = BIPED.exec(name);
  if (biped) {
    const digit = BIPED_DIGITS[Number(biped[1])];
    if (digit) return { digit };
  }

  let best = null;
  for (const [word, role] of Object.entries(DIGIT_WORDS)) {
    if (!name.includes(word)) continue;
    // Longest word wins, so `pinkie` is not read as `pink`.
    if (best && word.length <= best.word.length) continue;
    best = { digit: role, word };
  }
  return best ? { digit: best.digit } : null;
}

/**
 * Find a hand's bones inside a loaded scene.
 *
 * @returns {{wrist: Bone, digits: Object<string, Bone[]>}|null}
 */
export function findHandBones(root, { side = null } = {}) {
  /*
   * Side matching has to be loose, and then optional.
   *
   * `mixamorig:LeftHandIndex1` puts a colon before the word and a capital H
   * after it; `f_index.01.L` puts the side last as a single letter; `thumb_01_l`
   * is lowercase. A pattern strict enough to avoid matching the `l` in `little`
   * rejected all three, and `retargetHand` returned null on a perfectly good
   * Mixamo rig.
   */
  const sideWord = side === -1 ? /left/ : side === 1 ? /right/ : null;
  const sideLetter = side === -1 ? /[._:-]l$/ : side === 1 ? /[._:-]r$/ : null;
  const matchesSide = (name) => {
    const lower = name.toLowerCase();
    return Boolean(sideWord?.test(lower) || sideLetter?.test(lower));
  };

  const depthOf = (node) => {
    let depth = 0;
    for (let n = node; n; n = n.parent) depth++;
    return depth;
  };

  const collect = (filtered) => {
    const found = { thumb: [], index: [], middle: [], ring: [], little: [] };
    root.traverse((node) => {
      if (!node.isBone) return;
      if (filtered && !matchesSide(node.name)) return;
      const read = readBoneName(node.name);
      if (!read) return;
      found[read.digit].push(node);
    });
    /*
     * Order by depth and keep three. A finger is a chain, so the shallowest
     * bone carrying the digit's name is its knuckle and the fourth — the tip
     * or end bone nearly every rig carries — is dropped. It has no length of
     * its own and nothing should be driving it.
     */
    for (const digit of Object.keys(found)) {
      found[digit] = found[digit].sort((a, b) => depthOf(a) - depthOf(b)).slice(0, 3);
    }
    return found;
  };

  // Filter by side first; if that finds nothing, the file holds one hand and
  // there is nothing to disambiguate.
  let digits = side ? collect(true) : collect(false);
  if (Object.values(digits).every((chain) => !chain.filter(Boolean).length)) {
    digits = collect(false);
  }

  const chains = Object.values(digits).filter((chain) => chain.length);
  if (chains.length < 4) return null;

  /*
   * The wrist is the nearest common ancestor of the digit roots — derived, not
   * matched by name, because "hand", "wrist", "palm" and "Bip01_L_Hand" are all
   * in use and some rigs put a twist bone in between.
   */
  const roots = chains.map((chain) => chain[0]).filter(Boolean);
  const ancestry = (bone) => {
    const path = [];
    for (let node = bone; node; node = node.parent) path.push(node);
    return path;
  };
  const first = ancestry(roots[0]);
  const wrist = first.find((node) => roots.every((r) => ancestry(r).includes(node)));
  if (!wrist) return null;

  return { wrist, digits };
}

const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _axis = new Vector3();
const _inverse = new Quaternion();

/** Where a bone's chain continues, in that bone's own local space. */
function localDirection(bone, next, out) {
  if (next && next.parent === bone) return out.copy(next.position).normalize();
  /*
   * A tip bone has no child to point at. Its predecessor's direction is the
   * best available answer and it is a good one — the last phalanx continues
   * the one before it, which is why a finger reads as a finger.
   */
  return out.set(0, 0, 0);
}

/**
 * Work out which way the fingers close.
 *
 * Perpendicular to the knuckle line and to the fingers leaves two candidates,
 * 180 degrees apart, and picking the wrong one makes every pose bend the
 * fingers backwards over the knuckles — which is a failure this project has
 * already shipped once, from the other direction.
 *
 * The thumb decides. It is rotated out of the hand's plane toward the palm, and
 * nothing else in the hand is.
 */
function palmDirection(hand, out) {
  const { wrist, digits } = hand;
  wrist.updateMatrixWorld(true);

  const knuckles = ['index', 'middle', 'ring', 'little']
    .map((name) => digits[name]?.[0])
    .filter(Boolean);
  if (knuckles.length < 2) return out.set(0, -1, 0);

  const across = _a.copy(knuckles[knuckles.length - 1].getWorldPosition(new Vector3()))
    .sub(knuckles[0].getWorldPosition(new Vector3())).normalize();

  const along = _b.set(0, 0, 0);
  for (const knuckle of knuckles) {
    const tip = knuckle.children.find((child) => child.isBone) ?? knuckle;
    along.add(tip.getWorldPosition(new Vector3()).sub(knuckle.getWorldPosition(new Vector3())));
  }
  along.normalize();

  out.copy(across).cross(along).normalize();

  const thumb = digits.thumb?.[0];
  if (thumb) {
    const thumbTip = thumb.getWorldPosition(new Vector3())
      .sub(wrist.getWorldPosition(new Vector3()));
    const knuckleMid = knuckles[0].getWorldPosition(new Vector3())
      .sub(wrist.getWorldPosition(new Vector3()));
    // Remove the part of the thumb that simply runs along the hand; what is
    // left is how far out of the plane it sits, and which side.
    thumbTip.addScaledVector(along, -thumbTip.dot(along));
    thumbTip.addScaledVector(across, -thumbTip.dot(across));
    if (out.dot(thumbTip) < 0) out.negate();
    void knuckleMid;
  }
  return out;
}

/**
 * Prepare a foreign hand to be driven by this project's poses.
 *
 * Stores each bone's rest orientation and the local axis it flexes about, and
 * returns handles under the names the rest of the code uses — `fingers[i]`,
 * `userData.middle`, `userData.distal`, `userData.tipObject`, `userData.fan` —
 * so `FirstPersonHands._shapeHand` cannot tell the difference.
 */
export function retargetHand(root, { side = -1, fan = null } = {}) {
  const hand = findHandBones(root, { side });
  if (!hand) return null;

  root.updateMatrixWorld(true);
  const palm = palmDirection(hand, new Vector3());

  const prepare = (bone, next) => {
    bone.userData.rest = bone.quaternion.clone();

    localDirection(bone, next, _d);
    if (_d.lengthSq() < 1e-12) {
      // A tip bone: inherit the axis its parent flexes about, which keeps a
      // fingertip bending in the same plane as the rest of the finger.
      bone.userData.flexAxis = (bone.parent?.userData.flexAxis ?? new Vector3(1, 0, 0)).clone();
      return bone;
    }

    // The palm direction, brought into this bone's own space.
    bone.getWorldQuaternion(_inverse).invert();
    _p.copy(palm).applyQuaternion(_inverse);

    /*
     * Rotating `d` about `d × p` by a positive angle carries it toward `p`.
     * True in any frame, which is the point: nothing here assumes the author
     * pointed their bones down -z, or anywhere else.
     */
    _axis.copy(_d).cross(_p);
    if (_axis.lengthSq() < 1e-12) _axis.set(1, 0, 0);
    bone.userData.flexAxis = _axis.normalize().clone();
    return bone;
  };

  const chainOf = (name) => {
    const chain = hand.digits[name];
    chain.forEach((bone, i) => prepare(bone, chain[i + 1]));
    return chain;
  };

  const fingers = ['index', 'middle', 'ring', 'little'].map((name, i) => {
    const chain = chainOf(name);
    if (!chain.length) return null;
    const mcp = chain[0];
    mcp.userData.middle = chain[1] ?? null;
    mcp.userData.distal = chain[2] ?? chain[1] ?? null;
    mcp.userData.tipObject = mcp.userData.distal ?? mcp;
    /*
     * Where the tip is. A foreign rig rarely has a bone at the fingertip, so
     * the offset is the last phalanx's own length carried one segment further —
     * the same trick the swept rig uses, for the same reason: measuring a
     * bone's origin reports the joint, which barely moves.
     */
    const last = mcp.userData.distal ?? mcp;
    const lengthSource = last.parent?.isBone ? last.position.length() : 0.02;
    mcp.userData.tipOffset = [0, 0, 0];
    mcp.userData.tipLength = lengthSource;
    mcp.userData.fan = fan ? fan[i] : 0;
    mcp.userData.arch = 0;
    return mcp;
  }).filter(Boolean);

  const thumbChain = chainOf('thumb');
  const thumb = thumbChain[0] ?? null;
  if (thumb) {
    thumb.userData.middle = thumbChain[1] ?? null;
    thumb.userData.distal = thumbChain[2] ?? thumbChain[1] ?? null;
  }

  return { wrist: hand.wrist, fingers, thumb, palm };
}

const _delta = new Quaternion();

/**
 * Bend one retargeted bone.
 *
 * Applied as a delta on the rest orientation the author gave it, so a rig with
 * a curled rest pose stays curled and only the flexion this asks for is added.
 */
export function flex(bone, angle) {
  const rest = bone.userData.rest;
  const axis = bone.userData.flexAxis;
  if (!rest || !axis) return;
  _delta.setFromAxisAngle(axis, angle);
  bone.quaternion.copy(rest).multiply(_delta);
}
