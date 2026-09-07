/**
 * TargetSelector.js — where a spoken cast goes.
 *
 * Voice deliberately does not route through `AimController`. That controller
 * exists to arm an indicator and wait for a confirming click, and a spoken cast
 * has neither: the whole utterance is the input. So this resolves the same
 * three values the aim controller emits — origin, unit direction, distance —
 * straight from the world.
 *
 * Preference order: the nearest living dummy, then whatever the camera is
 * looking at. The camera fallback is what keeps an empty arena castable, which
 * matters more than it sounds — it is the state the sandbox boots into.
 *
 * Unlike the aim controller this never rejects a cast. A rejection needs a
 * player who can see why and correct it; a spoken cast that silently does
 * nothing just reads as the microphone being broken, so the line is clamped
 * into the ability's legal range instead.
 */

import { Vector3 } from 'three';
import { settings, castShapeOf, CastShape } from '../config/settings.js';

const _toTarget = new Vector3();
const _forward = new Vector3();
const _best = new Vector3();

export class TargetSelector {
  /**
   * @param {object} deps { camera, enemies, character }
   */
  constructor({ camera, enemies, character }) {
    this.camera = camera;
    this.enemies = enemies;
    this.character = character;

    this.origin = new Vector3();
    this.direction = new Vector3(0, 0, 1);
    this.distance = 0;
  }

  /**
   * Resolve a cast line for `element`.
   * @returns {{origin: Vector3, direction: Vector3, distance: number, target: object|null}}
   */
  solve(element) {
    const block = settings[element] ?? {};
    const range = block.range ?? 15;
    const minRange = block.minRange ?? 0;

    this.origin.copy(this.character?.position ?? _best.set(0, 0, 0));
    this.origin.y = 0;

    const target = this._nearestEnemy(range);

    if (target) {
      _toTarget.copy(target.position).setY(0).sub(this.origin);
      const length = _toTarget.length();
      if (length > 1e-4) {
        this.direction.copy(_toTarget).divideScalar(length);
        this.distance = length;
      } else {
        this._useCameraForward();
        this.distance = range;
      }
    } else {
      this._useCameraForward();
      this.distance = range * 0.75;
    }

    // A far cast measures its footprint from the end of the line, so pushing a
    // near target out to at least the zone radius keeps the circle off the
    // caster's own feet.
    if (castShapeOf(element) === CastShape.ZONE) {
      this.distance = Math.max(this.distance, block.zoneRadius ?? 0);
    }

    this.distance = Math.min(range, Math.max(minRange, this.distance));

    return {
      origin: this.origin,
      direction: this.direction,
      distance: this.distance,
      yaw: this.yaw,
      target: target ?? null
    };
  }

  /**
   * The cast heading as a yaw, matching `AimController.facing`.
   *
   * `CharacterController.setFacing` takes a scalar, not a vector — handing it a
   * Vector3 sets the rotation to NaN and the character disappears.
   */
  get yaw() {
    return Math.atan2(this.direction.x, this.direction.z);
  }

  /** Nearest living enemy within reach, or null. */
  _nearestEnemy(range) {
    const active = this.enemies?.active;
    if (!active?.length) return null;

    let best = null;
    let bestDistance = Infinity;
    // Search a little past the ability's range: a target just out of reach is
    // still the thing you meant, and clamping the line is kinder than casting
    // at the sky behind it.
    const reach = range * 1.6;

    for (const enemy of active) {
      if (enemy.isDead) continue;
      _toTarget.copy(enemy.position).setY(0).sub(this.origin);
      const distance = _toTarget.length();
      if (distance > reach || distance >= bestDistance) continue;
      bestDistance = distance;
      best = enemy;
    }
    return best;
  }

  /** Flatten the camera's look direction onto the ground plane. */
  _useCameraForward() {
    if (!this.camera) {
      this.direction.set(0, 0, 1);
      return;
    }
    this.camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1);
    this.direction.copy(_forward).normalize();
  }
}
