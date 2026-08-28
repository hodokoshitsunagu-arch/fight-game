import { Vector3 } from 'three';
import { settings } from '../config/settings.js';

const _position = new Vector3();

/**
 * DummyField.js — something to fight, paced so it stays comfortable.
 *
 * This used to maintain a population: eight alive, one replaced a second and a
 * half after each kill. That is a treadmill. There is never a moment when the
 * field is clear, so there is never a moment to breathe, and the pressure is
 * constant however weak each individual is.
 *
 * It runs in batches now. A batch walks in, you clear it, and then nothing
 * happens for a few seconds before the next one starts. The gap is the feature —
 * it is what makes the same enemies at the same strength feel unhurried, because
 * you can see the end of the thing you are in.
 *
 * Two other things take pressure out without weakening anything:
 *
 *   the telegraph  a ring marks the ground before anything walks out of it
 *   the view cap   a limit on how many stand where you are looking, kept
 *                  separate from the limit on the rest — something behind you
 *                  cannot be aimed at or avoided, so it contributes pressure
 *                  without contributing anything to do
 *
 * Still not the wave director: no escalation, no upgrades, no failure state.
 * Batches repeat at whatever composition the roster asks for.
 */

const PHASE = Object.freeze({
  RESTING: 'resting',
  ARRIVING: 'arriving',
  ENGAGED: 'engaged'
});

export class DummyField {
  /**
   * @param {import('../enemies/EnemyManager.js').EnemyManager} enemies
   * @param {{telegraph?: import('./SpawnTelegraph.js').SpawnTelegraph}} options
   */
  constructor(enemies, { telegraph = null } = {}) {
    this.enemies = enemies;
    this.telegraph = telegraph;

    /** Set by App: the direction the player is looking, radians. */
    this.getFacing = null;

    this.phase = PHASE.RESTING;
    this.timer = 0;
    this.batch = 0;
    this.pending = [];
    this._nextIndex = 0;
    this.enabled = false;
  }

  get config() {
    return settings.encounter;
  }

  /** Begin. The first batch waits out a short rest so nothing lands on boot. */
  start() {
    this.enabled = true;
    this.enemies.stopSpawning();
    this.enemies.clearEnemies({ resetKills: true });
    this.telegraph?.clear();
    this.pending.length = 0;
    this.batch = 0;
    this._enterRest(this.config.openingDelay);
  }

  _enterRest(seconds = this.config.restSeconds) {
    this.phase = PHASE.RESTING;
    this.timer = seconds;
  }

  /**
   * Queue a batch, each arrival telegraphed and staggered.
   *
   * Staggered rather than simultaneous: five bodies appearing on one frame is a
   * wall, and the same five spread over two seconds is a group walking towards
   * you.
   */
  _beginBatch() {
    this.batch++;
    this.phase = PHASE.ARRIVING;
    this.pending.length = 0;

    for (let i = 0; i < this.config.batchSize; i++) {
      const spot = this._chooseSpot(this._nextIndex++);
      const lead = this.telegraph?.mark(spot.x, spot.z) ?? 0;
      this.pending.push({
        x: spot.x,
        z: spot.z,
        at: i * this.config.arrivalStagger + lead,
        descriptor: this._chooseDescriptor(i)
      });
    }
    this.timer = 0;
  }

  /**
   * Where one arrival comes from.
   *
   * Golden angle around the view rather than around the player, so consecutive
   * spawns never share a bearing, with a minority from behind — a group that
   * only ever appears in front is a shooting gallery.
   */
  _chooseSpot(index) {
    const c = this.config;
    const facing = this.getFacing?.() ?? 0;
    const wander = ((index * 2.399963) % (Math.PI * 2)) - Math.PI;
    const behind = index % c.behindEvery === c.behindEvery - 1;
    const bearing = facing + (behind ? Math.PI + wander * 0.35 : wander * c.spread);
    const distance = c.minDistance + ((index * 37) % 100) / 100 * (c.maxDistance - c.minDistance);
    return { x: Math.sin(bearing) * distance, z: Math.cos(bearing) * distance };
  }

  /**
   * What kind of thing arrives.
   *
   * A plain list that repeats, not a difficulty formula. A level teaches one
   * thing at a time, and that is a property of the list — so the roster is the
   * thing to edit when designing an encounter, and nothing here needs changing.
   */
  _chooseDescriptor(indexInBatch) {
    const roster = this.config.roster;
    const entry = roster[(this.batch - 1 + indexInBatch) % roster.length];
    return {
      archetype: entry.archetype,
      behaviour: entry.behaviour,
      traits: entry.traits ?? []
    };
  }

  /** Signed angle between a bearing and where the player is looking. */
  _offsetFromView(x, z) {
    const facing = this.getFacing?.() ?? 0;
    const bearing = Math.atan2(x, z);
    return Math.abs(((bearing - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  }

  /**
   * How many stand where the player is looking.
   *
   * Counted apart from the rest because the two are not equivalent. Something
   * behind you cannot be aimed at, cannot be avoided and mostly cannot be seen;
   * capping the two separately is what lets five enemies feel like three.
   */
  _countInView() {
    const halfArc = this.config.viewArc / 2;
    let inView = 0;
    for (const enemy of this.enemies.active) {
      if (enemy.isDead) continue;
      if (this._offsetFromView(enemy.position.x, enemy.position.z) <= halfArc) inView++;
    }
    return inView;
  }

  update(dt) {
    if (!this.enabled) return;
    this.telegraph?.update(dt);

    const alive = this.enemies.aliveCount;

    if (this.phase === PHASE.RESTING) {
      this.timer -= dt;
      if (this.timer <= 0) this._beginBatch();
      return;
    }

    if (this.phase === PHASE.ARRIVING) {
      this.timer += dt;
      const halfArc = this.config.viewArc / 2;
      let inView = this._countInView();

      for (let i = this.pending.length - 1; i >= 0; i--) {
        const arrival = this.pending[i];
        if (this.timer < arrival.at) continue;

        // Held back rather than dropped: the cap is about how much is on screen
        // at once, not about how much the batch contains.
        const wouldBeInView = this._offsetFromView(arrival.x, arrival.z) <= halfArc;
        if (wouldBeInView && inView >= this.config.maxInView) continue;
        if (!wouldBeInView && alive - inView >= this.config.maxOutOfView) continue;

        _position.set(arrival.x, 0, arrival.z);
        this.enemies.spawn(_position, arrival.descriptor);
        if (wouldBeInView) inView++;
        this.pending.splice(i, 1);
      }

      if (!this.pending.length) this.phase = PHASE.ENGAGED;
      return;
    }

    // ENGAGED: wait for the field to clear, then rest. The gap between batches
    // is the whole point — it is where the pressure goes.
    if (alive === 0) this._enterRest();
  }

  stop() {
    this.enabled = false;
    this.pending.length = 0;
    this.telegraph?.clear();
    this.enemies.clearEnemies({ resetKills: true });
  }

  dispose() {
    this.stop();
  }
}
