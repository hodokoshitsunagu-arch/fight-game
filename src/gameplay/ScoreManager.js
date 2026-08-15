import { settings } from '../config/settings.js';
import { EventEmitter } from '../utils/EventEmitter.js';

const EMPTY_BEST = Object.freeze({ bestWave: 0, bestScore: 0, bestKills: 0, bestTime: 0 });

export class ScoreManager extends EventEmitter {
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
    this.best = this._load();
    this.reset();
  }

  _load() {
    try {
      const value = JSON.parse(this.storage?.getItem(settings.score.storageKey) ?? 'null');
      return value && typeof value === 'object' ? { ...EMPTY_BEST, ...value } : { ...EMPTY_BEST };
    } catch {
      return { ...EMPTY_BEST };
    }
  }

  _save() {
    try {
      this.storage?.setItem(settings.score.storageKey, JSON.stringify(this.best));
    } catch {
      // Private browsing and embedded browsers may reject storage. Gameplay continues.
    }
  }

  reset() {
    this.score = 0;
    this.kills = 0;
    this.time = 0;
    this.wave = 0;
  }

  update(dt, active) {
    if (active) this.time += dt;
  }

  enemyKilled(enemy) {
    const value = settings.enemyTypes[enemy.archetype]?.score ?? settings.enemyTypes.normal.score;
    this.kills++;
    this.score += value;
    this.emit('score:changed', this.snapshot());
  }

  waveCleared(wave) {
    this.wave = Math.max(this.wave, wave);
    this.score += wave * settings.score.waveClearMultiplier;
    this.emit('score:changed', this.snapshot());
  }

  finalize(wave) {
    this.wave = Math.max(this.wave, wave);
    this.best.bestWave = Math.max(this.best.bestWave, this.wave);
    this.best.bestScore = Math.max(this.best.bestScore, this.score);
    this.best.bestKills = Math.max(this.best.bestKills, this.kills);
    this.best.bestTime = Math.max(this.best.bestTime, this.time);
    this._save();
    return this.snapshot();
  }

  snapshot() {
    return { wave: this.wave, score: this.score, kills: this.kills, time: this.time, ...this.best };
  }
}
