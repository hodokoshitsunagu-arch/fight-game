import { settings } from '../config/settings.js';
import { LEVELS, flattenNodes, unlockedAt } from './campaign.js';

/**
 * CampaignDirector.js — turns a sandbox into a run.
 *
 * The whole feature is one state machine and a flat list of nodes:
 *
 *   INTRO      a card naming where you have arrived        (new location only)
 *   FIGHTING   the node's wave is out; wait for it to clear
 *   SEARCHING  the shard is up; wait for it to be tapped
 *   BEAT       a line of story, and a breath
 *   STEPPING   walk to the next connected panorama
 *   CROSSING   fade, card, jump to the next location
 *   DONE       the campaign is over
 *
 * Everything it drives already existed and is used through its public surface:
 * `DummyField.startWave`, `StreetViewBackdrop.stepRelative` / `moveTo` /
 * `availableDirections`. The director owns *ordering*, not behaviour — which
 * is why it can be unit-tested with none of them present.
 *
 * The one genuine constraint the world imposes: the ten locations are in ten
 * countries and Street View has no edges between them. So "the next connected
 * location" can only mean the next panorama along this street's link graph;
 * crossing to another country is a cut, and is presented as one.
 */

export const STATE = Object.freeze({
  IDLE: 'idle',
  INTRO: 'intro',
  FIGHTING: 'fighting',
  SEARCHING: 'searching',
  BEAT: 'beat',
  STEPPING: 'stepping',
  CROSSING: 'crossing',
  DONE: 'done'
});

const SAVE_KEY = 'relic.campaign.progress';

export class CampaignDirector {
  /**
   * Every collaborator is optional so the machine can be tested on its own.
   *
   * @param {{
   *   dummies?: object, shard?: object, streetView?: object,
   *   scenes?: Array, hud?: object, getFacing?: () => number
   * }} deps
   */
  constructor({
    dummies = null, shard = null, streetView = null, scenes = [],
    hud = null, getFacing = null, getCurrentSceneId = null
  } = {}) {
    this.dummies = dummies;
    this.shard = shard;
    this.streetView = streetView;
    this.scenes = scenes;
    this.hud = hud;
    this.getFacing = getFacing;
    /** Where the world currently is, so a resume does not pay for a move it
     *  does not need — every `moveTo` is a billed Street View request. */
    this.getCurrentSceneId = getCurrentSceneId;

    this.nodes = flattenNodes(LEVELS);
    this.index = 0;
    this.state = STATE.IDLE;
    this.timer = 0;
    this.shardsCollected = 0;

    /** Set by App: the campaign wants to be somewhere else. */
    this.onLocationChange = null;
    /** Set by App: the set of castable elements changed. */
    this.onUnlocks = null;

    if (this.dummies) this.dummies.onCleared = () => this._onCleared();
    if (this.shard) this.shard.onCollect = () => this._onCollected();
  }

  get node() {
    return this.nodes[this.index] ?? null;
  }

  get level() {
    return this.node?.level ?? null;
  }

  get scene() {
    const id = this.node?.location?.sceneId;
    return this.scenes.find((s) => s.id === id) ?? null;
  }

  /** Elements the player is allowed to cast right now. */
  get unlocked() {
    return unlockedAt(this.node?.levelIndex ?? 0);
  }

  get progress() {
    return { done: this.index, total: this.nodes.length };
  }

  /* ------------------------------------------------------------------ start */

  /**
   * @param {{resume?: boolean}} options
   */
  start({ resume = true } = {}) {
    const saved = resume ? this._load() : null;
    this.index = saved && saved.index < this.nodes.length ? saved.index : 0;
    this.shardsCollected = saved?.shards ?? 0;
    this._ensureLocation();
    this._enterNode({ arriving: true });
  }

  /**
   * Come back to the campaign after free roam.
   *
   * Free roam is entered by picking a place from the selector, which can leave
   * the player on a different continent from the node they were on — so
   * resuming has to put the world back before it puts the fight back.
   */
  resume() {
    this._ensureLocation();
    this._enterNode({ arriving: true });
  }

  /** Move the world to the current node's location, if it is not already there. */
  _ensureLocation() {
    const scene = this.scene;
    if (!scene) return;
    if (this.getCurrentSceneId?.() === scene.id) return;
    this.streetView?.moveTo?.(scene.lat, scene.lng, 120);
    this.onLocationChange?.(scene);
  }

  /**
   * Begin the node at `this.index`.
   *
   * @param {{arriving?: boolean}} options arriving at a new location shows its
   *   card first; walking one panorama further does not.
   */
  _enterNode({ arriving = false } = {}) {
    const node = this.node;
    if (!node) {
      this.state = STATE.DONE;
      this.hud?.showDone?.(this.shardsCollected);
      return;
    }

    this.onUnlocks?.(this.unlocked);
    this.hud?.setLevel?.(node.level, node.locationIndex, this.scene);
    this.hud?.setProgress?.(this.progress);

    if (arriving) {
      this.state = STATE.INTRO;
      this.timer = settings.campaign.introSeconds;
      this.hud?.showCard?.(this.scene?.zh ?? '', node.location.intro);
      return;
    }
    this._beginFight();
  }

  _beginFight() {
    const node = this.node;
    this.state = STATE.FIGHTING;
    this.hud?.setHint?.(node.hint);
    this.hud?.setObjective?.({ remaining: node.count, shard: false });
    this.dummies?.startWave({ roster: node.roster, count: node.count });
  }

  /* ------------------------------------------------------- objective events */

  /** Every enemy in the node's wave has fallen. */
  _onCleared() {
    if (this.state !== STATE.FIGHTING) return;
    this.state = STATE.SEARCHING;
    this.hud?.setObjective?.({ remaining: 0, shard: true });
    this.hud?.setHint?.('找到遗物碎片，点击拾取。');
    this.shard?.place(this.getFacing?.() ?? 0);
  }

  /** The shard was tapped. */
  _onCollected() {
    if (this.state !== STATE.SEARCHING) return;
    this.shardsCollected++;
    this.state = STATE.BEAT;
    this.timer = settings.campaign.collectPause + settings.campaign.beatSeconds;
    this.hud?.setObjective?.({ remaining: 0, shard: false });
    this.hud?.showBeat?.(this.node.beat, this.shardsCollected);
  }

  /* ------------------------------------------------------------- advancing */

  /**
   * Walk to the next panorama along this street.
   *
   * Forward first, because that is where the player is looking and a step they
   * did not ask for should at least go the way they were facing. `step()`
   * refuses a link more than a quarter turn off, so the fallbacks walk the
   * directions the panorama actually offers rather than guessing.
   */
  _stepAlongStreet() {
    const sv = this.streetView;
    if (!sv) return false;
    if (sv.stepRelative?.(0)) return true;

    const available = sv.availableDirections?.() ?? {};
    for (const [name, degrees] of [['right', 90], ['left', -90], ['back', 180]]) {
      if (available[name] && sv.stepRelative?.(degrees)) return true;
    }
    return false;
  }

  _advance() {
    const finished = this.node;
    this.index++;
    this._save();

    if (!this.node) {
      this.state = STATE.DONE;
      this.hud?.showDone?.(this.shardsCollected);
      return;
    }

    if (finished.lastOfLocation) {
      // A different country: a cut, not a step.
      this.state = STATE.CROSSING;
      this.timer = settings.campaign.transitionSeconds;
      this.hud?.fade?.(true);
      return;
    }

    this.state = STATE.STEPPING;
    this.timer = 0.35;
    this._stepAlongStreet();
  }

  _crossTo() {
    const scene = this.scene;
    if (scene && this.streetView?.moveTo) this.streetView.moveTo(scene.lat, scene.lng, 120);
    this.onLocationChange?.(scene);
    this.hud?.fade?.(false);
    this._enterNode({ arriving: true });
  }

  /* ------------------------------------------------------------------ loop */

  update(dt) {
    this.shard?.update(dt);

    switch (this.state) {
      case STATE.INTRO:
        this.timer -= dt;
        if (this.timer <= 0) {
          this.hud?.hideCard?.();
          this._beginFight();
        }
        break;

      case STATE.FIGHTING:
        // The count is read rather than tracked: `DummyField` and the enemy
        // manager already own it, and a second copy would be a second thing
        // that can be wrong.
        this.hud?.setObjective?.({ remaining: this._remaining(), shard: false });
        break;

      case STATE.BEAT:
        this.timer -= dt;
        if (this.timer <= 0) this._advance();
        break;

      case STATE.STEPPING:
        this.timer -= dt;
        if (this.timer <= 0) this._enterNode({ arriving: false });
        break;

      case STATE.CROSSING:
        this.timer -= dt;
        if (this.timer <= 0) this._crossTo();
        break;

      default:
        break;
    }
  }

  /** Alive now, plus everything still queued to walk in. */
  _remaining() {
    const alive = this.dummies?.enemies?.aliveCount ?? 0;
    const queued = this.dummies?.pending?.length ?? 0;
    const unsent = Number.isFinite(this.dummies?.quota) ? this.dummies.quota : 0;
    return alive + queued + unsent;
  }

  /* ------------------------------------------------------------ persistence */

  _save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ index: this.index, shards: this.shardsCollected }));
    } catch {
      /* private browsing, quota, no storage — progress is a nicety */
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  reset() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* nothing to clear */
    }
    this.index = 0;
    this.shardsCollected = 0;
  }

  stop() {
    this.state = STATE.IDLE;
    this.dummies?.stop();
    this.shard?.clear();
  }

  dispose() {
    this.stop();
    if (this.dummies) this.dummies.onCleared = null;
    if (this.shard) this.shard.onCollect = null;
  }
}
