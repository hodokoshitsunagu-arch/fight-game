/**
 * DummyField.js — something for the spells to hit.
 *
 * The sandbox needs targets for two reasons: auto-aim has to have something to
 * choose, and effects read far better against a body than against empty floor —
 * impact flashes, knockback and scorch decals all only mean something when they
 * land on something.
 *
 * This is not the wave director. There are no waves, no escalation, no upgrades
 * and no failure state: a fixed population walks in from the distance, and when
 * one dies another sets off a moment later. It reuses `EnemyManager` wholesale
 * rather than inventing a target type, so dummies react, stagger and die with
 * the same feedback the real game has.
 */

import { Vector3 } from 'three';

const _position = new Vector3();

export class DummyField {
  /**
   * @param {import('../enemies/EnemyManager.js').EnemyManager} enemies
   * @param {object} options
   */
  constructor(enemies, {
    count = 8,
    minDistance = 34,
    maxDistance = 70,
    spread = 0.9,
    respawnDelay = 1.5
  } = {}) {
    this.enemies = enemies;
    this.count = count;
    /** Metres. Far enough to read as a silhouette before it reads as a threat. */
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    /** How wide of the view they arrive, in radians either side. */
    this.spread = spread;
    /** Set by App: the direction the player is looking, radians. */
    this.getFacing = null;
    this.respawnDelay = respawnDelay;
    this.respawnTimer = 0;
    // Monotonic, so replacements keep walking around the golden-angle ring
    // instead of piling back into the slots that just emptied.
    this._nextIndex = 0;
    this.enabled = false;
  }

  /** Fill the ring. */
  start() {
    this.enabled = true;
    this.enemies.stopSpawning();
    this.enemies.clearEnemies({ resetKills: true });
    this._nextIndex = 0;
    for (let i = 0; i < this.count; i++) this._spawnAt(this._nextIndex++);
  }

  /**
   * Spawn one, far out and roughly ahead.
   *
   * The ring this used to place was right for a third-person camera looking
   * down at a stage: everything visible at once, nothing behind you. In first
   * person it put half the dummies out of frame and the other half already on
   * top of you, with nothing to watch them do.
   *
   * So they arrive from a distance, biased toward wherever the view is pointing
   * — far enough to be a silhouette first, spread wide enough that they do not
   * queue up in a line. A quarter still come from behind, because a horde that
   * only ever appears in front is a shooting gallery.
   */
  _spawnAt(index) {
    const facing = this.getFacing?.() ?? 0;
    // Golden angle again, but as a spread around the view rather than around
    // the player: consecutive spawns never share a bearing.
    const wander = ((index * 2.399963) % (Math.PI * 2)) - Math.PI;
    const behind = index % 4 === 3;
    const bearing = facing + (behind ? Math.PI + wander * 0.35 : wander * this.spread);

    const distance = this.minDistance + ((index * 37) % 100) / 100 * (this.maxDistance - this.minDistance);
    _position.set(Math.sin(bearing) * distance, 0, Math.cos(bearing) * distance);
    this.enemies.spawn(_position);
  }

  update(dt) {
    if (!this.enabled) return;

    if (this.enemies.aliveCount >= this.count) {
      this.respawnTimer = 0;
      return;
    }

    // Arm on the frame the gap appears rather than filling it, so a kill has a
    // moment to read before its replacement walks in.
    if (this.respawnTimer <= 0) {
      this.respawnTimer = this.respawnDelay;
      return;
    }

    this.respawnTimer -= dt;
    if (this.respawnTimer > 0) return;
    this.respawnTimer = 0;
    this._spawnAt(this._nextIndex++);
  }

  stop() {
    this.enabled = false;
    this.enemies.clearEnemies({ resetKills: true });
  }

  dispose() {
    this.stop();
  }
}
