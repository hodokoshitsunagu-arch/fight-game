import {
  AdditiveBlending,
  DoubleSide,
  Mesh,
  RingGeometry,
  MeshBasicMaterial
} from 'three';
import { settings } from '../config/settings.js';
import { LAYER } from '../core/Layers.js';

/**
 * SpawnTelegraph.js — a ring on the ground, a moment before something uses it.
 *
 * The cheapest way to take pressure out of an encounter without weakening
 * anything in it. The same enemy, at the same distance, arriving at the same
 * speed, feels entirely different depending on whether you saw it coming — so
 * the fix is information, not numbers.
 *
 * Rings are pooled and flat on the ground rather than billboarded, because a
 * marker that always faces you reads as UI and a marker lying on the pavement
 * reads as part of the place.
 */

const POOL_SIZE = 12;

export class SpawnTelegraph {
  constructor(scene) {
    this.scene = scene;
    this.active = [];

    this.material = new MeshBasicMaterial({
      color: 0xff7a4a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending
    });

    this.pool = Array.from({ length: POOL_SIZE }, () => {
      /*
       * Sized for the distance it is seen from, not for a body.
       *
       * Arrivals are 34 to 70 metres out and the view is locked level, so a
       * ring the width of the thing standing in it is a few pixels near the
       * horizon — invisible exactly where the warning matters. A marker has to
       * be legible at the range it is read at.
       */
      const ring = new Mesh(new RingGeometry(2.1, 3.0, 36), this.material.clone());
      ring.rotation.x = -Math.PI / 2;
      // Just above the ground so it never z-fights the floor it lies on.
      ring.position.y = 0.02;
      ring.layers.set(LAYER.VFX);
      ring.visible = false;
      ring.frustumCulled = false;
      scene.add(ring);
      return ring;
    });
  }

  /**
   * Mark a spot, and report how long until it is used.
   *
   * @returns {number} seconds the caller should wait before spawning there
   */
  mark(x, z) {
    const lead = settings.enemyBehaviour.telegraphSeconds;
    const ring = this.pool.find((r) => !r.visible);
    // Out of rings means the batch is larger than the pool; the spawn still
    // happens, it just arrives unannounced rather than being dropped.
    if (!ring) return lead;

    ring.position.set(x, 0.02, z);
    ring.visible = true;
    this.active.push({ ring, elapsed: 0, lead });
    return lead;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i];
      entry.elapsed += dt;
      const t = entry.elapsed / entry.lead;

      if (t >= 1) {
        entry.ring.visible = false;
        this.active.splice(i, 1);
        continue;
      }

      // Grows and brightens toward the moment of arrival, so the urgency is in
      // the animation rather than in a number nobody reads.
      const scale = 0.55 + t * 0.75;
      entry.ring.scale.setScalar(scale);
      // Pulses, and the pulse tightens as the time runs out.
      const pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 6);
      entry.ring.material.opacity = (0.4 + t * 0.55) * pulse;
    }
  }

  clear() {
    for (const entry of this.active) entry.ring.visible = false;
    this.active.length = 0;
  }

  dispose() {
    this.clear();
    for (const ring of this.pool) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
    }
    this.material.dispose();
  }
}
