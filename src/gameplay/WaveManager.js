import { settings } from '../config/settings.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { WaveDirector } from './WaveDirector.js';

export const WaveState = Object.freeze({
  IDLE: 'Idle',
  PREPARING: 'Preparing',
  INTRO: 'WaveIntro',
  SPAWNING: 'Spawning',
  COMBAT: 'Combat',
  COMPLETE: 'WaveComplete',
  UPGRADE: 'UpgradeSelection',
  GAME_OVER: 'GameOver'
});

export class WaveManager extends EventEmitter {
  constructor(enemies, director = new WaveDirector()) {
    super();
    this.enemies = enemies;
    this.director = director;
    this.reset();
  }

  reset() {
    this.state = WaveState.IDLE;
    this.wave = 0;
    this.timer = 0;
    this.lastCountdown = -1;
    this.plan = null;
  }

  start() {
    this.wave = 1;
    this._prepare();
  }

  _setState(state, timer = 0) {
    this.state = state;
    this.timer = timer;
    this.emit('wave:state', { state, wave: this.wave, timer });
  }

  _prepare() {
    this.lastCountdown = -1;
    this._setState(WaveState.PREPARING, settings.game.prepareDuration);
    this.emit('wave:prepare', { wave: this.wave });
  }

  update(realDt) {
    if (this.state === WaveState.PREPARING) {
      this.timer = Math.max(0, this.timer - realDt);
      const countdown = Math.max(1, Math.ceil(this.timer));
      if (countdown !== this.lastCountdown) {
        this.lastCountdown = countdown;
        this.emit('wave:countdown', { wave: this.wave, countdown });
      }
      if (this.timer <= 0) {
        this._setState(WaveState.INTRO, settings.game.waveIntroDuration);
        this.emit('wave:intro', { wave: this.wave, milestone: this.wave % 10 === 0 });
      }
      return;
    }

    if (this.state === WaveState.INTRO) {
      this.timer = Math.max(0, this.timer - realDt);
      if (this.timer <= 0) {
        this.plan = this.director.generate(this.wave);
        this.enemies.queueWave(this.plan.descriptors, this.plan.maxAlive);
        this._setState(WaveState.SPAWNING);
        this.emit('wave:start', this.plan);
      }
      return;
    }

    if (this.state === WaveState.SPAWNING || this.state === WaveState.COMBAT) {
      if (this.enemies.pendingSpawnCount <= 0 && this.state === WaveState.SPAWNING) {
        this._setState(WaveState.COMBAT);
      }
      if (this.enemies.pendingSpawnCount <= 0 && this.enemies.aliveCount <= 0) {
        this._setState(WaveState.COMPLETE, settings.game.waveClearDuration);
        this.emit('wave:complete', { wave: this.wave });
      }
      return;
    }

    if (this.state === WaveState.COMPLETE) {
      this.timer = Math.max(0, this.timer - realDt);
      if (this.timer <= 0) {
        this.enemies.clearEnemies();
        this._setState(WaveState.UPGRADE);
        this.emit('wave:upgrade', { wave: this.wave });
      }
    }
  }

  completeUpgrade() {
    if (this.state !== WaveState.UPGRADE) return false;
    this.wave++;
    this._prepare();
    return true;
  }

  gameOver() {
    this.enemies.stopSpawning();
    this._setState(WaveState.GAME_OVER);
  }

  skip() {
    if (![WaveState.SPAWNING, WaveState.COMBAT].includes(this.state)) return false;
    this.enemies.stopSpawning();
    this.enemies.killAll({ debug: true });
    return true;
  }

  forceUpgrade() {
    if (this.state === WaveState.IDLE || this.state === WaveState.GAME_OVER) return false;
    this.enemies.stopSpawning();
    this.enemies.clearEnemies();
    this._setState(WaveState.UPGRADE);
    this.emit('wave:upgrade', { wave: this.wave, debug: true });
    return true;
  }
}
