import { Vector3, Group } from 'three';
import { settings } from '../config/settings.js';
import { LAYER } from '../core/Layers.js';
import { CLIPS, clipForElement, sampleClip, makeSample } from './HandPoses.js';
import { TIER, createMaterials, buildArm } from './HandAssets.js';

/**
 * FirstPersonHands.js — the two hands an unarmed caster shows you.
 *
 * Built rather than rigged. The character FBX has arms, but they are skinned to
 * one mesh with the rest of the body: there is no way to draw only the forearms
 * without authoring a separate model.
 *
 * Everything is in camera space, so none of it needs the camera's world
 * transform and none of it lags a frame behind a moving view. The cost is that
 * they cannot be occluded by the world, which for hands held in front of your
 * own face is correct anyway.
 *
 * ## Layers
 *
 * Three, evaluated in order and summed onto the frustum-solved rest pose:
 *
 *   base    breathing. Always on, and the reason a still hand does not read as
 *           a texture.
 *   stride  a counter-swing weighted by how fast the street is moving past.
 *   action  one clip at a time — a cast, or the seal held while the microphone
 *           is open — faded in and out by its own weight so a gesture never
 *           starts or ends on a hard cut.
 *
 * The action layer is what makes this an animation system rather than the
 * single `punch()` it replaced. A cast used to be one push forward and back,
 * identical for a lance, a meteor and a zone. Those are three different intents
 * and they now look like three different intents.
 *
 * ## Tiers
 *
 * What the hands are *made of* lives in `HandAssets`, in two tiers. The
 * procedural one is boxes and capsules with flat colours and cannot fail; the
 * high one has rounder geometry, two-jointed fingers and a textured skin
 * material. Both present the same skeleton, so a gesture authored once plays on
 * either and swapping the look can never break the motion.
 *
 * ## Fingers
 *
 * The old hand was a sphere, which cannot express a gesture: an open palm and
 * a fist are the same silhouette. Four fingers and a thumb over a flat palm is
 * the least geometry that lets `curl` and `spread` read at arm's length, and
 * without them the seal pose — hands together, fingers half closed — is just
 * two blobs touching.
 */

/** Scratch for the palm-offset solve. */
const _palmOffset = new Vector3();

/**
 * Where the palm sits along the arm, before scaling.
 *
 * Shortened from 0.40. The sleeve used to run 36cm to a 14cm hand, and on
 * screen that read as a dark tube with something small on the end — the exact
 * inverse of what needs reading, since the gesture is in the fingers. Real
 * proportions are closer to a 25cm forearm and a 19cm hand, and moving the
 * visual weight onto the hand is what makes a fist and an open palm tell
 * themselves apart at arm's length.
 */
const PALM_Z = -0.31;

/**
 * What the digits do when a caller says nothing about them.
 *
 * Module scope and frozen, so `_shapeHand` stays callable with three arguments
 * — which the geometry test does — and so the default costs no allocation on
 * a path that runs twice a frame.
 */
const NEUTRAL = Object.freeze({ curl: 1, splay: 1 });
const NEUTRAL_DIGITS = Object.freeze([NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL]);

export class FirstPersonHands {
  constructor(camera) {
    this.camera = camera;
    this.group = new Group();
    this.group.name = 'FirstPersonHands';
    // Drawn with the effects rather than the world, so the scene's own fog and
    // shadow passes leave them alone.
    this.group.layers.set(LAYER.VFX);
    camera.add(this.group);

    this.tier = settings.camera.hands.fidelity === TIER.HIGH ? TIER.HIGH : TIER.PROCEDURAL;
    const parts = createMaterials(this.tier);
    this.materials = parts.materials;

    this.hands = [-1, 1].map((side) => this._buildArm(side, parts));

    /* --- layer state --- */
    this._time = 0;
    this._stride = 0;

    /** The clip playing, its cursor, its weight, and how hard it was thrown. */
    this._clip = null;
    this._clipTime = 0;
    this._weight = 0;
    this._targetWeight = 0;
    this._strength = 1;
    /** True while the microphone is open — holds the looping seal. */
    this._charging = false;

    this._sample = makeSample();
    this.setVisible(false);
  }

  _buildArm(side, parts) {
    const arm = new Group();
    const built = buildArm(arm, side, parts, this.tier, PALM_Z);

    arm.rotation.set(-0.28, side * 0.34, side * -0.16);
    arm.userData.side = side;
    arm.userData.rest = new Vector3();
    // The pose the rest position is solved against; layers move away from it.
    arm.userData.baseRotation = arm.rotation.clone();
    arm.userData.hand = built.hand;
    arm.userData.knuckle = built.knuckle;
    arm.userData.fingers = built.fingers;
    arm.userData.thumb = built.thumb;

    this.group.add(arm);
    return arm;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  get config() {
    return settings.camera.hands;
  }

  /* ------------------------------------------------------------- actions */

  /**
   * Hold the seal while the microphone is open.
   *
   * The hands prepare for as long as somebody is speaking, and the spell is
   * the release. That is the whole reason this layer is driven by the mic and
   * not only by the cast: without it the gesture starts when the spell already
   * exists, which is half a second after the player committed to it.
   */
  setCharging(charging) {
    if (this._charging === charging) return;
    this._charging = charging;
    if (charging) {
      this._play(CLIPS.seal, 1);
    } else if (this._clip === CLIPS.seal) {
      // Released without a cast — let the seal fade rather than snap open.
      this._targetWeight = 0;
    }
  }

  /**
   * A spell went out.
   *
   * @param {string} element which spell, to pick the gesture
   * @param {number} strength 0..1-ish, how fully to throw it — the pronunciation
   *   score, so a mumbled cast is a smaller motion as well as a smaller spell
   */
  cast(element, strength = 1) {
    this._play(clipForElement(element), strength);
  }

  /** Kept for the keyboard and mouse paths, which have no element to hand in. */
  punch() {
    this._play(CLIPS.thrust, 1);
  }

  _play(clip, strength) {
    this._clip = clip;
    this._clipTime = 0;
    this._strength = Math.max(this.config.minStrength, Math.min(1.2, strength));
    this._targetWeight = 1;
    // A cast interrupting the seal takes over immediately rather than blending
    // out of it: the release *is* the transition, and easing between them ate
    // the moment the spell fires.
    if (clip !== CLIPS.seal) this._weight = Math.max(this._weight, 0.65);
  }

  /* -------------------------------------------------------------- update */

  /**
   * @param {number} dt
   * @param {number} speed 0 standing, 1 running — drives the stride swing
   */
  update(dt, speed = 0) {
    if (!this.group.visible) return;
    this._placeInFrustum();

    this._time += dt;
    this._stride += dt * (2.2 + speed * 6);

    this._advanceClip(dt);

    const bob = settings.camera.handBob;
    const sample = this._sample;
    if (this._clip && this._weight > 0.001) {
      sampleClip(this._clip, this._clipTime, sample);
    }
    const weight = this._weight * this._strength;

    for (const arm of this.hands) {
      const side = arm.userData.side;
      const rest = arm.userData.rest;
      const base = arm.userData.baseRotation;
      // Left arm is index 0 (side -1); the clips are authored left/right.
      const pose = side < 0 ? sample.left : sample.right;

      const breathe = Math.sin(this._time * 1.6 + side) * 0.008;
      const stride = Math.sin(this._stride + (side > 0 ? Math.PI : 0)) * 0.02 * speed;

      const active = this._clip && this._weight > 0.001;
      const px = active ? pose.pos[0] * weight : 0;
      const py = active ? pose.pos[1] * weight : 0;
      const pz = active ? pose.pos[2] * weight : 0;

      arm.position.set(
        rest.x + stride * 0.5 + px,
        rest.y + (breathe + stride) * bob + py,
        rest.z + pz
      );
      arm.rotation.set(
        base.x + stride * 0.6 + (active ? pose.rot[0] * weight : 0),
        base.y + (active ? pose.rot[1] * weight : 0),
        base.z + (active ? pose.rot[2] * weight : 0)
      );

      const hand = arm.userData.hand;
      hand.rotation.set(
        active ? pose.wrist[0] * weight : 0,
        active ? pose.wrist[1] * weight : 0,
        active ? pose.wrist[2] * weight : 0
      );

      this._shapeHand(arm, active ? pose.curl * weight : 0, active ? pose.spread * weight : 0,
        active ? pose.digits : NEUTRAL_DIGITS);
    }
  }

  _advanceClip(dt) {
    // Weight always chases its target, so a fade is never left half finished.
    const rate = this._targetWeight > this._weight ? this.config.blendIn : this.config.blendOut;
    this._weight += (this._targetWeight - this._weight) * Math.min(1, dt * rate);

    if (!this._clip) return;
    this._clipTime += dt / this._clip.duration;

    if (this._clip.loop) {
      // A held seal never ends on its own; releasing the mic clears the target.
      if (!this._charging && this._weight < 0.01) this._clip = null;
      return;
    }

    if (this._clipTime >= 1) {
      this._clipTime = 1;
      this._targetWeight = 0;
      if (this._weight < 0.01) {
        this._clip = null;
        // Back to the seal if the player is still talking — one utterance can
        // contain several casts, and dropping to neutral between them reads as
        // the hands giving up mid-sentence.
        if (this._charging) this._play(CLIPS.seal, 1);
      }
    }
  }

  /**
   * Curl and fan the fingers.
   *
   * Staggered along the hand rather than uniform: four fingers closing in
   * lockstep reads as a mitten, and the difference costs one multiply.
   */
  _shapeHand(arm, curl, spread, digits = NEUTRAL_DIGITS) {
    const knuckle = arm.userData.knuckle;
    // Toward the palm is -y, here as everywhere else on this axis.
    knuckle.rotation.x = -curl * 1.15;

    const fingers = arm.userData.fingers;
    for (let i = 0; i < fingers.length; i++) {
      const finger = fingers[i];
      const lag = 1 + (i - 1.5) * 0.09;
      /*
       * `fingers` is index..little; `digits` is thumb-first, so the thumb is
       * entry 0 and this finger is i + 1. Off by one here would have every
       * finger wearing its neighbour's multiplier, which reads as a slightly
       * wrong hand rather than as a bug.
       */
      const digit = digits[i + 1] ?? NEUTRAL;
      const fingerCurl = curl * digit.curl;
      const fingerSpread = spread * digit.splay;
      const distal = finger.userData.distal;
      const middle = finger.userData.middle;
      if (middle && distal) {
        /*
         * Three joints, which is what a finger has.
         *
         * Anatomical full flexion is about 90 degrees at the knuckle, 100 at
         * the middle joint and 70 at the last. The two-joint version could not
         * reach the palm: a rod pivoting at the knuckle sweeps an arc, and
         * without the middle phalanx the tip runs out of angle before it gets
         * back to where a fist would close.
         *
         * Negative: fingers extend along -z and curl toward the *palm*, which
         * is -y. Positive tips them back over the knuckles, which is how an
         * open hand and a fist came out looking identical once already.
         */
        const pip = -fingerCurl * 1.75 * lag;
        finger.rotation.x = -fingerCurl * 1.55 * lag;
        middle.rotation.x = pip;
        // The last joint is not independent in a real hand — it follows the
        // middle one through the tendon. Driving it separately looks like a
        // finger with a broken tip.
        distal.rotation.x = pip * 0.66;
      } else if (distal) {
        // One capsule, already lying along -z, so the rest pitch is baked in —
        // and the curl subtracts from it, for the same reason the two-jointed
        // version does: toward the palm is -y. This was adding, which bent the
        // fingers back over the knuckles.
        finger.rotation.x = Math.PI / 2 - fingerCurl * 1.15 * lag;
      }
      finger.rotation.y = finger.userData.fan * fingerSpread;

      /*
       * The transverse metacarpal arch.
       *
       * The palm is not a board. Its far edge rolls toward the thumb as the
       * hand closes, and how far depends on the finger — the index metacarpal
       * barely moves, the little finger's travels a long way. It is most of
       * what separates a fist from four rods, and where the rig has no arch
       * weight (the capsule tier) this is simply zero.
       */
      const arch = finger.userData.arch ?? 0;
      finger.rotation.z = -arm.userData.side * curl * arch * 0.30;
    }

    const side = arm.userData.side;
    const thumb = arm.userData.thumb;
    const thumbCurl = curl * (digits[0] ?? NEUTRAL).curl;
    const thumbSpread = spread * (digits[0] ?? NEUTRAL).splay;

    if (thumb.userData.middle) {
      /*
       * The thumb closes by *opposition*, not by curling like a finger: the
       * metacarpal swings across the palm at the saddle joint and the two
       * phalanges follow. Rotating it about the same axis as the fingers is
       * what made the old thumb read as a fifth finger stuck on sideways.
       *
       * These are deltas on the rest pose the rig already set, so the saddle's
       * own tilt stays where `HandRig` put it.
       */
      thumb.rotation.y = side * (0.85 - thumbCurl * 0.42 + thumbSpread * 0.16);
      thumb.rotation.x = -0.25 - thumbCurl * 0.30;
      thumb.userData.middle.rotation.x = -thumbCurl * 0.75;
      thumb.userData.distal.rotation.x = -thumbCurl * 0.60;
    } else {
      // The capsule tier's thumb is one mesh with a baked quarter turn.
      thumb.rotation.z = side * (0.9 - thumbCurl * 0.55);
      thumb.rotation.x = Math.PI / 2 + thumbCurl * 0.3;
    }
  }

  /**
   * Anchor the hands to the edges of the view, not to fixed metres.
   *
   * Placed at a constant offset they were correct on one aspect ratio and gone
   * on every other — a phone held upright has a very narrow horizontal field,
   * and hands set 19cm out sat entirely off the sides of the frame while being
   * perfectly present in the scene. Deriving the position from the frustum at
   * their own depth puts them in the same place on any screen.
   */
  _placeInFrustum() {
    /*
     * Far enough away that the elbow is not a wide-angle lens subject.
     *
     * At 0.46m the arm origin sat about 30cm from the near plane, and any pose
     * that pulled a hand *back* — every anticipation in every clip — swelled
     * the forearm until it filled a third of the frame. Pushing the whole
     * assembly out flattens that perspective without touching the composition:
     * the rest pose is expressed as fractions of the frustum, so the hands land
     * in the same place on screen and only the distortion changes.
     */
    const palmDepth = 0.56;
    const halfHeight = palmDepth * Math.tan((this.camera.fov * Math.PI) / 360);
    const halfWidth = halfHeight * this.camera.aspect;
    if (halfHeight === this._halfHeight && halfWidth === this._halfWidth) return;
    this._halfHeight = halfHeight;
    this._halfWidth = halfWidth;

    /*
     * Scale with the frustum, not just position within it.
     *
     * A phone held upright has a very narrow horizontal field — half a metre
     * out, the frame is under 20cm wide, and a hand modelled at real size fills
     * a third of the screen. Sized as a fraction of the frame instead, the same
     * hands read correctly upright, landscape and on a desktop window.
     */
    /*
     * The floor matters more than it used to.
     *
     * Measured on a real phone frame (aspect 0.46) this solved to 0.31 against
     * 1.10 on a desktop window — the same hands three and a half times smaller
     * on the device the build is actually played on. That was survivable while
     * a hand was a sphere whose only job was to be present. It is not
     * survivable now that the hands have to *read as gestures*: a fist and an
     * open palm are the same handful of pixels at 0.31.
     */
    const scale = Math.min(1.1, Math.max(0.42, halfWidth * 3.4));

    for (const arm of this.hands) {
      arm.scale.setScalar(scale);
      /*
       * Solve for the arm's origin from where the *palm* has to land, rather
       * than placing the origin and hoping.
       *
       * The arm is pitched down about 18 degrees, which walks the palm another
       * 13cm below wherever the origin sits — enough to put it a quarter of a
       * screen under the bottom edge while every check said visible, on layer,
       * and in the scene. Rotating the palm's own offset and subtracting it
       * puts the hand exactly where it was asked to be, whatever the pose.
       */
      _palmOffset.set(0, 0, PALM_Z * scale).applyEuler(arm.userData.baseRotation);
      /*
       * Brought in and up, because a gesture has to be visible to be a gesture.
       *
       * The palms used to solve to NDC (±0.66, -0.76) — technically on screen,
       * actually in the bottom corners with the lower part of the hand behind
       * the attribution bar. Fine for two blobs proving you have arms; useless
       * for a seal that brings the hands together, which was happening off the
       * bottom of the frame.
       */
      /*
       * 0.41, not a guess: measured off first-person reference footage of two
       * hands held up over a pavement. Segmenting skin from stone frame by
       * frame — the two do not overlap at all, skin runs r-g 45..55 at 29..45%
       * saturation against 3..5 and 2..7% — and keeping only the blobs that
       * touch the bottom edge (an arm reaches in from below; a warm paving slab
       * in the corner does not) puts the hands' centres at ndc x -0.31 and
       * +0.51 across 23 clean frames. Off-centre because the camera was, so the
       * symmetric figure is the mean magnitude, 0.41.
       *
       * The old 0.52 was half a hand further out on each side, which is what
       * pushed the seal's two hands apart at the moment they are supposed to
       * meet.
       */
      arm.userData.rest.set(
        arm.userData.side * halfWidth * 0.41 - _palmOffset.x,
        -halfHeight * 0.58 - _palmOffset.y,
        -palmDepth - _palmOffset.z
      );
    }
  }

  dispose() {
    this.camera.remove(this.group);
    for (const material of this.materials) material.dispose();
    /*
     * The geometry is not ours to free.
     *
     * It used to be — every arm built its own — and this walked the tree
     * disposing as it went. The geometry is shared between the two arms now,
     * and cached across every pair of hands that will ever be built, so the
     * same walk would hand the other arm a freed buffer. `HandAssets`
     * exports `disposeSharedGeometry` for a teardown that really means it.
     *
     * Textures belong to the materials, which dispose above.
     */
  }
}
