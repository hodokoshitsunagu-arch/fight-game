import {
  CapsuleGeometry,
  Vector3,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry
} from 'three';
import { settings } from '../config/settings.js';
import { LAYER } from '../core/Layers.js';

/**
 * FirstPersonHands.js — the two forearms an unarmed shooter shows you.
 *
 * Built rather than rigged. The character FBX has arms, but they are skinned to
 * one mesh with the rest of the body: there is no way to draw only the forearms
 * without authoring a separate model. Two capsules and a sphere each, parented
 * to the camera, get the read that matters — something of yours is in frame,
 * and it reacts.
 *
 * Everything is in camera space, so none of it needs the camera's world
 * transform and none of it lags a frame behind a moving view. The cost is that
 * they cannot be occluded by the world, which for hands held in front of your
 * own face is correct anyway.
 *
 * Three motions, because a still hand reads as a texture:
 *
 *   breathing   a slow rise and fall, always
 *   stride      a faster counter-swing while walking, left and right opposed
 *   cast        a push forward and back, triggered per spell
 */

const CAST_DURATION = 0.42;

/** Scratch for the palm-offset solve. */
const _palmOffset = new Vector3();

export class FirstPersonHands {
  constructor(camera) {
    this.camera = camera;
    this.group = new Group();
    this.group.name = 'FirstPersonHands';
    // Drawn with the effects rather than the world, so the scene's own fog and
    // shadow passes leave them alone.
    this.group.layers.set(LAYER.VFX);
    camera.add(this.group);

    const skin = new MeshStandardMaterial({
      color: 0xb98a68,
      roughness: 0.82,
      metalness: 0.0
    });
    const sleeve = new MeshStandardMaterial({
      color: 0x2a3340,
      roughness: 0.9,
      metalness: 0.0
    });
    this.materials = [skin, sleeve];

    this.hands = [-1, 1].map((side) => {
      const arm = new Group();

      const forearm = new Mesh(new CapsuleGeometry(0.052, 0.26, 4, 8), sleeve);
      forearm.rotation.x = Math.PI / 2;
      forearm.position.z = -0.16;
      arm.add(forearm);

      const wrist = new Mesh(new CapsuleGeometry(0.045, 0.1, 4, 8), skin);
      wrist.rotation.x = Math.PI / 2;
      wrist.position.z = -0.33;
      arm.add(wrist);

      const palm = new Mesh(new SphereGeometry(0.055, 10, 8), skin);
      palm.scale.set(1, 0.72, 1.25);
      palm.position.z = -0.4;
      arm.add(palm);

      arm.rotation.set(-0.32, side * 0.2, side * -0.13);
      arm.userData.side = side;
      arm.userData.rest = new Vector3();
      // The pose the rest position is solved against; the animation moves away
      // from it and back.
      arm.userData.baseRotation = arm.rotation.clone();

      this.group.add(arm);
      return arm;
    });

    this._time = 0;
    this._cast = 0;
    this._stride = 0;
    this.setVisible(false);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  /** A spell went out — push the hands forward and let them settle back. */
  punch() {
    this._cast = CAST_DURATION;
  }

  /**
   * @param {number} dt
   * @param {number} speed 0 standing, 1 running — drives the stride swing
   */
  update(dt, speed = 0) {
    if (!this.group.visible) return;
    this._placeInFrustum();

    this._time += dt;
    this._stride += dt * (2.2 + speed * 6);
    if (this._cast > 0) this._cast = Math.max(0, this._cast - dt);

    const bob = settings.camera.handBob;
    // Eased so the push leaves fast and returns slowly, which is what a throw
    // feels like; a symmetric curve reads as a twitch.
    const cast = this._cast > 0 ? Math.sin((this._cast / CAST_DURATION) * Math.PI) ** 0.6 : 0;

    for (const arm of this.hands) {
      const side = arm.userData.side;
      const rest = arm.userData.rest;

      const breathe = Math.sin(this._time * 1.6 + side) * 0.008;
      const stride = Math.sin(this._stride + (side > 0 ? Math.PI : 0)) * 0.02 * speed;

      arm.position.set(
        rest.x + stride * 0.5,
        rest.y + (breathe + stride) * bob,
        rest.z - cast * 0.16
      );
      arm.rotation.x = -0.32 - cast * 0.45 + stride * 0.6;
      arm.rotation.z = side * -0.13 + cast * side * 0.1;
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
    const palmDepth = 0.46;
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
    const scale = Math.min(1.1, Math.max(0.3, halfWidth * 3.4));

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
      _palmOffset.set(0, 0, -0.4 * scale).applyEuler(arm.userData.baseRotation);
      arm.userData.rest.set(
        arm.userData.side * halfWidth * 0.66 - _palmOffset.x,
        -halfHeight * 0.78 - _palmOffset.y,
        -palmDepth - _palmOffset.z
      );
    }
  }

  dispose() {
    this.camera.remove(this.group);
    for (const material of this.materials) material.dispose();
    for (const arm of this.hands) {
      for (const child of arm.children) child.geometry.dispose();
    }
  }
}
