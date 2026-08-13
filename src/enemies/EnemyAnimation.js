import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';

const LOOPING = new Set(['walk']);

/** Small action controller kept separate from gameplay state. */
export class EnemyAnimation {
  constructor(model, clips) {
    this.mixer = new AnimationMixer(model);
    this.actions = new Map();
    this.current = null;
    this.currentName = '';
    this.onFinished = null;

    for (const [name, clip] of Object.entries(clips)) {
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.setLoop(LOOPING.has(name) ? LoopRepeat : LoopOnce, LOOPING.has(name) ? Infinity : 1);
      action.clampWhenFinished = !LOOPING.has(name);
      this.actions.set(name, action);
    }
    this.mixer.addEventListener('finished', this._handleFinished);
  }

  _handleFinished = (event) => {
    if (event.action !== this.current) return;
    this.onFinished?.(this.currentName);
  };

  play(name, { blend = 0.12, timeScale = 1, restart = false, randomPhase = false } = {}) {
    const next = this.actions.get(name);
    if (!next) return null;
    if (next === this.current && !restart) {
      next.setEffectiveTimeScale(timeScale);
      return next;
    }

    const previous = this.current;
    this.current = next;
    this.currentName = name;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(timeScale);
    if (randomPhase && next.getClip().duration > 0) next.time = Math.random() * next.getClip().duration;
    next.play();
    if (previous && previous !== next) next.crossFadeFrom(previous, blend, false);
    return next;
  }

  duration(name) {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  normalizedTime(name = this.currentName) {
    const action = this.actions.get(name);
    if (!action) return 0;
    return Math.min(1, action.time / Math.max(0.001, action.getClip().duration));
  }

  update(dt) {
    if (dt > 0) this.mixer.update(dt);
  }

  reset() {
    this.mixer.stopAllAction();
    this.current = null;
    this.currentName = '';
    this.onFinished = null;
  }

  dispose() {
    this.mixer.removeEventListener('finished', this._handleFinished);
    this.mixer.stopAllAction();
    this.actions.clear();
  }
}
