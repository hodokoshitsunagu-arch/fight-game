import {
  AdditiveBlending,
  Color,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector2,
  Vector3
} from 'three';
import { settings } from '../config/settings.js';
import { LAYER } from '../core/Layers.js';

/**
 * RelicShard.js — the thing you have to find and tap.
 *
 * It exists to be a second objective that is not combat. Clearing a node is
 * loud and fast; finding the shard is quiet and takes ten seconds of turning
 * around. That contrast is the pacing — the same reason `SpawnTelegraph` and
 * the rest between batches exist.
 *
 * It appears only after the last enemy falls. Hunting for it *during* a fight
 * would be a second thing demanding the screen while something walks at you,
 * which is exactly the pressure this build keeps taking out.
 *
 * Placement is a real constraint, not an arbitrary number. `lockPitch` holds
 * the view level, so the visible band is a horizontal slice: at 20 metres it
 * spans roughly ±8m vertically, but anything within about 4 metres of the
 * player has its ground below the frame entirely. The shard therefore hovers
 * near eye height at middle distance, where it is unambiguously on screen at
 * any aspect ratio — and at a random bearing, so it has to be looked for.
 *
 * Picking is deliberately forgiving. A ray against a 40cm object at 20 metres
 * is a few pixels wide; a thumb is forty. So a true ray hit is tried first and
 * a screen-space radius catches the near misses, which is the difference
 * between a puzzle and an annoyance.
 */

const _raycaster = new Raycaster();
const _ndc = new Vector2();
const _projected = new Vector3();

/** Pixels of slack around the shard's centre that still count as a tap. */
const TOUCH_RADIUS = 46;

export class RelicShard {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.collected = false;
    this._time = 0;
    this._fade = 0;

    /** Set by the director: the shard was tapped. */
    this.onCollect = null;

    const geometry = new IcosahedronGeometry(0.42, 0);
    this.material = new MeshBasicMaterial({
      color: new Color('#ffd67a'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.layers.set(LAYER.VFX);
    this.mesh.visible = false;
    // Small and far away: without this it vanishes the moment it leaves the
    // centre of the screen, which is precisely when it is being searched for.
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    /** A larger, dimmer shell so it reads as lit rather than as a flat dot. */
    this.halo = new Mesh(new IcosahedronGeometry(0.78, 1), this.material.clone());
    this.halo.material.opacity = 0;
    this.halo.layers.set(LAYER.VFX);
    this.halo.visible = false;
    this.halo.frustumCulled = false;
    scene.add(this.halo);
  }

  get config() {
    return settings.campaign;
  }

  /**
   * Put one out, somewhere the player is not already looking.
   *
   * @param {number} facing radians the camera is pointing
   */
  place(facing = 0) {
    const c = this.config;
    // Offset from the current view rather than absolute, so it is always a
    // turn away — never already centred, never directly behind.
    const away = c.shardMinBearing + Math.random() * (c.shardMaxBearing - c.shardMinBearing);
    const bearing = facing + (Math.random() < 0.5 ? away : -away);
    const distance = c.shardMinDistance + Math.random() * (c.shardMaxDistance - c.shardMinDistance);

    this.mesh.position.set(
      Math.sin(bearing) * distance,
      c.shardHeight,
      Math.cos(bearing) * distance
    );
    this.halo.position.copy(this.mesh.position);

    this.active = true;
    this.collected = false;
    this._fade = 0;
    this.mesh.visible = true;
    this.halo.visible = true;
  }

  /**
   * Test a tap against the shard.
   *
   * @returns {boolean} whether the tap was consumed
   */
  tryPick(event, camera, dom) {
    if (!this.active || this.collected) return false;

    const rect = dom.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    _ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    _raycaster.setFromCamera(_ndc, camera);
    // The shard is on the VFX layer; the raycaster defaults to layer 0 only.
    _raycaster.layers.enableAll();
    let hit = _raycaster.intersectObject(this.halo, false).length > 0;

    if (!hit) {
      // Near miss: project the shard and measure in pixels. A ray against
      // something this small at this range is thinner than a fingertip.
      _projected.copy(this.mesh.position).project(camera);
      if (_projected.z < 1) {
        const sx = (_projected.x * 0.5 + 0.5) * rect.width;
        const sy = (-_projected.y * 0.5 + 0.5) * rect.height;
        hit = Math.hypot(sx - x, sy - y) <= TOUCH_RADIUS;
      }
    }

    if (!hit) return false;
    this.collect();
    return true;
  }

  collect() {
    if (!this.active || this.collected) return;
    this.collected = true;
    this.onCollect?.();
  }

  /** Where it is on screen, or null when off screen — drives the HUD arrow. */
  screenBearing(facing) {
    if (!this.active || this.collected) return null;
    const bearing = Math.atan2(this.mesh.position.x, this.mesh.position.z);
    return ((bearing - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  }

  update(dt) {
    if (!this.mesh.visible) return;
    this._time += dt;

    // Fades in rather than popping, so it does not read as a spawn.
    const target = this.collected ? 0 : 1;
    this._fade += (target - this._fade) * Math.min(1, dt * (this.collected ? 7 : 3));

    const pulse = 0.72 + 0.28 * Math.sin(this._time * 2.4);
    this.material.opacity = this._fade * pulse;
    this.halo.material.opacity = this._fade * pulse * 0.22;

    this.mesh.rotation.y += dt * 0.8;
    this.mesh.rotation.x += dt * 0.35;
    this.halo.rotation.y -= dt * 0.5;

    const bob = Math.sin(this._time * 1.5) * 0.14;
    this.mesh.position.y = this.config.shardHeight + bob;
    this.halo.position.copy(this.mesh.position);

    // On collect it shrinks away; when it is gone, so is the object.
    if (this.collected) {
      const shrink = Math.max(0.001, this._fade);
      this.mesh.scale.setScalar(shrink);
      this.halo.scale.setScalar(shrink * (2 - shrink));
      if (this._fade < 0.02) this.clear();
    } else {
      this.mesh.scale.setScalar(1);
      this.halo.scale.setScalar(1);
    }
  }

  clear() {
    this.active = false;
    this.mesh.visible = false;
    this.halo.visible = false;
    this._fade = 0;
    this.mesh.scale.setScalar(1);
    this.halo.scale.setScalar(1);
  }

  dispose() {
    this.clear();
    this.scene.remove(this.mesh);
    this.scene.remove(this.halo);
    this.mesh.geometry.dispose();
    this.halo.geometry.dispose();
    this.material.dispose();
    this.halo.material.dispose();
  }
}
