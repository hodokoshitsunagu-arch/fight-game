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
 * Two ways to run it:
 *
 *   start()      endless. Batches repeat forever at the roster's composition.
 *                This is free play, and it is what the sandbox has always been.
 *   startWave()  a finite list. Exactly `count` arrive, drawn from a roster the
 *                caller supplies, and when the last one falls `onCleared` fires
 *                and nothing further is queued.
 *
 * The finite mode is what a level is built out of: an encounter that can be
 * *finished* is the difference between a sandbox and a campaign. Everything
 * else — the stagger, the telegraph, the view cap, the rest between batches —
 * is shared, because those are the things that make it comfortable and a
 * campaign should not feel worse than the sandbox did.
 *
 * Still not the wave director: no escalation formula, no upgrades, no failure
 * state. Composition is a list the caller hands in, not a curve computed here.
 */

const PHASE = Object.freeze({
  RESTING: 'resting',
  ARRIVING: 'arriving',
  ENGAGED: 'engaged',
  CLEARED: 'cleared'
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

    /**
     * How many are still to arrive. `Infinity` is the endless sandbox; a finite
     * number is a wave that can be finished.
     */
    this.quota = Infinity;
    /** Overrides `settings.encounter.roster` for the current wave, if set. */
    this._roster = null;
    /** Set by the caller: the last of a finite wave has fallen. */
    this.onCleared = null;
  }

  get config() {
    return settings.encounter;
  }

  /** Begin. The first batch waits out a short rest so nothing lands on boot. */
  start() {
    this.quota = Infinity;
    this._roster = null;
    this._begin();
  }

  /**
   * Run a finite encounter.
   *
   * `count` is the whole wave, not the batch: it is still delivered in batches
   * of `batchSize` with the usual rest between them, so eight arrivals are two
   * groups with a breath in the middle rather than a wall of eight. That is the
   * same pacing free play has, and it is the reason a level does not need its
   * own pacing code.
   *
   * @param {{roster: Array, count: number}} wave
   */
  startWave({ roster, count }) {
    this.quota = Math.max(0, count);
    this._roster = roster?.length ? roster : null;
    this._begin();
  }

  _begin() {
    this.enabled = true;
    this.enemies.stopSpawning();
    this.enemies.clearEnemies({ resetKills: true });
    this.telegraph?.clear();
    this.pending.length = 0;
    this.batch = 0;
    this._enterRest(this.config.openingDelay);
  }

  /** The roster this wave draws from — the caller's if it supplied one. */
  get roster() {
    return this._roster ?? this.config.roster;
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

    // A finite wave's last batch is whatever is left of the quota, which is how
    // a two-enemy node and an eight-enemy node come out of the same code.
    const size = Math.min(this.config.batchSize, this.quota);
    for (let i = 0; i < size; i++) {
      const spot = this._chooseSpot(this._nextIndex++);
      const lead = this.telegraph?.mark(spot.x, spot.z) ?? 0;
      this.pending.push({
        x: spot.x,
        z: spot.z,
        at: i * this.config.arrivalStagger + lead,
        descriptor: this._chooseDescriptor(i)
      });
    }
    if (Number.isFinite(this.quota)) this.quota -= size;
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
    const roster = this.roster;
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

    // ENGAGED: wait for the field to clear. In free play that means another
    // rest; in a finite wave with nothing left to send, it means the encounter
    // is over. The gap between batches is the whole point — it is where the
    // pressure goes.
    if (alive !== 0) return;
    if (this.quota > 0) {
      this._enterRest();
      return;
    }

    // Latched before the callback, so a listener that starts the next wave
    // synchronously is not immediately overwritten by this frame.
    this.phase = PHASE.CLEARED;
    this.enabled = false;
    this.onCleared?.();
  }

  stop() {
    this.enabled = false;
    this.quota = Infinity;
    this._roster = null;
    this.pending.length = 0;
    this.telegraph?.clear();
    this.enemies.clearEnemies({ resetKills: true });
  }

  dispose() {
    this.stop();
  }
}
