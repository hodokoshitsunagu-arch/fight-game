/**
 * DummyField.js — something for the spells to hit.
 *
 * The sandbox needs targets for two reasons: auto-aim has to have something to
 * choose, and effects read far better against a body than against empty floor —
 * impact flashes, knockback and scorch decals all only mean something when they
 * land on something.
 *
 * This is not the wave director. There are no waves, no escalation, no upgrades
 * and no failure state: a fixed population stands in a ring, and when one dies
 * another takes its place a moment later. It reuses `EnemyManager` wholesale
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
  constructor(enemies, { count = 8, radius = 12, respawnDelay = 1.5 } = {}) {
    this.enemies = enemies;
    this.count = count;
    this.radius = radius;
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

  _spawnAt(index) {
    // Golden-angle placement rather than an even ring: an even ring lines the
    // dummies up so a line cast either misses everything or hits a whole row,
    // which flatters the effect dishonestly.
    const angle = index * 2.399963;
    const distance = this.radius * (0.55 + 0.45 * ((index % 3) / 2));
    _position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
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
