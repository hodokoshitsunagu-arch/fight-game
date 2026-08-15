import { Vector3 } from 'three';
import { settings } from '../config/settings.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { PlayerHealth } from './PlayerHealth.js';
import { ScoreManager } from './ScoreManager.js';
import { UpgradeManager } from './UpgradeManager.js';
import { WaveManager, WaveState } from './WaveManager.js';

export class GameSession extends EventEmitter {
  constructor({ enemies, relic, character, playerHitFeedback, callbacks = {} }) {
    super();
    this.enemies = enemies;
    this.relic = relic;
    this.character = character;
    this.playerHitFeedback = playerHitFeedback;
    this.callbacks = callbacks;
    this.player = new PlayerHealth(character.position);
    this.score = new ScoreManager();
    this.upgrades = new UpgradeManager({ player: this.player, relic });
    this.wave = new WaveManager(enemies);
    this.gameOverElapsed = 0;
    this.gameOverShown = false;
    this.respawnPoint = new Vector3();
    this.startPoint = new Vector3(0, 0, 4.2);

    this.playerTarget = {
      kind: 'player', position: character.position, radius: 0.65,
      isTargetable: () => this.player.isTargetable
    };
    this.relicTarget = {
      kind: 'relic', position: relic.position, radius: settings.relic.hitRadius,
      isTargetable: () => !relic.isDestroyed
    };
    enemies.setTargets(this.playerTarget, this.relicTarget);
    this._bindEvents();
  }

  _bindEvents() {
    this._offs = [
      this.enemies.on('enemy:attack', (event) => this._onEnemyAttack(event)),
      this.enemies.on('enemy:spawn', ({ enemy }) => {
        if (enemy.archetype === 'elite') this.emit('elite:spawn', { enemy });
      }),
      this.enemies.on('enemy:death', ({ enemy }) => this.score.enemyKilled(enemy)),
      this.player.on('player:damage', (event) => this.emit('player:damage', event)),
      this.player.on('player:heal', (event) => this.emit('player:heal', event)),
      this.player.on('player:down', (event) => {
        this.callbacks.cancelControl?.();
        this.enemies.invalidateTarget('player');
        this.emit('player:down', event);
      }),
      this.player.on('player:respawn', (event) => {
        this.playerHitFeedback.grantImmunity(event.invulnerability);
        this.emit('player:respawn', event);
      }),
      this.relic.on('relic:damage', (event) => this.emit('relic:damage', event)),
      this.relic.on('relic:heal', (event) => this.emit('relic:heal', event)),
      this.relic.on('relic:warning', (event) => this.emit('relic:warning', event)),
      this.relic.on('relic:destroyed', (event) => this._onRelicDestroyed(event)),
      this.wave.on('wave:state', (event) => this.emit('wave:state', event)),
      this.wave.on('wave:prepare', (event) => this.emit('wave:prepare', event)),
      this.wave.on('wave:countdown', (event) => this.emit('wave:countdown', event)),
      this.wave.on('wave:intro', (event) => this.emit('wave:intro', event)),
      this.wave.on('wave:start', (event) => this.emit('wave:start', event)),
      this.wave.on('wave:complete', (event) => {
        this.score.waveCleared(event.wave);
        if (this.player.isDowned) {
          this._setRespawnPoint();
          this.player.respawn(this.respawnPoint);
        }
        this.emit('wave:complete', event);
      }),
      this.wave.on('wave:upgrade', (event) => {
        this.callbacks.waveCleanup?.();
        const offers = this.upgrades.draw(3);
        this.emit('wave:upgrade', { ...event, offers });
      }),
      this.upgrades.on('upgrade:selected', (event) => this.emit('upgrade:selected', event))
    ];
  }

  get state() {
    return this.wave.state;
  }

  get canControl() {
    return !this.player.isDowned && ![WaveState.IDLE, WaveState.UPGRADE, WaveState.GAME_OVER].includes(this.state);
  }

  get simulationScale() {
    if (this.state === WaveState.IDLE || this.state === WaveState.UPGRADE) return 0;
    if (this.state === WaveState.GAME_OVER) {
      return this.gameOverElapsed < settings.game.defeatSlowMotionDuration ? settings.game.defeatTimeScale : 0;
    }
    return 1;
  }

  get isRunning() {
    return ![WaveState.IDLE, WaveState.UPGRADE, WaveState.GAME_OVER].includes(this.state);
  }

  _setRespawnPoint() {
    this.respawnPoint.copy(this.relic.position);
    this.respawnPoint.x += settings.player.respawnOffsetX;
    this.respawnPoint.z += settings.player.respawnOffsetZ;
  }

  start() {
    this.callbacks.resetRuntime?.();
    this.score.reset();
    this.upgrades.reset();
    this.relic.reset();
    this.player.reset(this.startPoint);
    this.playerHitFeedback.reset();
    this.gameOverElapsed = 0;
    this.gameOverShown = false;
    this.wave.reset();
    this.wave.start();
    this.emit('game:start', { wave: 1 });
  }

  update(realDt) {
    if (this.state === WaveState.GAME_OVER) {
      this.gameOverElapsed += realDt;
      if (!this.gameOverShown && this.gameOverElapsed >= settings.game.defeatRevealDelay) {
        this.gameOverShown = true;
        this.emit('game:over', this.score.finalize(this.wave.wave));
      }
      return;
    }

    this.wave.update(realDt);
    if (this.isRunning) {
      this.score.update(realDt, true);
      if (this.player.isDowned) {
        this._setRespawnPoint();
        this.player.update(realDt, this.respawnPoint);
      } else {
        this.player.update(realDt, null);
      }
    }
  }

  _onEnemyAttack({ enemy, targetKind, damage }) {
    if (this.state === WaveState.GAME_OVER) return;
    if (targetKind === 'relic') {
      const dx = enemy.position.x - this.relic.position.x;
      const dz = enemy.position.z - this.relic.position.z;
      const range = settings.enemy.attackHitRange + settings.relic.hitRadius;
      if (dx * dx + dz * dz <= range * range) this.relic.damage(damage, enemy);
      return;
    }
    if (!this.player.isTargetable) return;
    if (this.playerHitFeedback.tryHit(enemy, damage)) this.player.damage(damage, enemy);
  }

  _onRelicDestroyed(event) {
    if (this.state === WaveState.GAME_OVER) return;
    this.callbacks.cancelControl?.();
    this.wave.gameOver();
    this.gameOverElapsed = 0;
    this.emit('relic:lost', event);
  }

  selectUpgrade(id) {
    if (this.state !== WaveState.UPGRADE) return null;
    const result = this.upgrades.apply(id);
    if (!result) return null;
    this.relic.heal(this.relic.maxHP * settings.game.relicRecoveryPercent);
    this.wave.completeUpgrade();
    return result;
  }

  healPlayer(amount) {
    return this.player.heal(amount * this.upgrades.healMultiplier);
  }

  healRelicFromLink() {
    if (!this.upgrades.has('relic-link')) return 0;
    return this.relic.heal(this.relic.maxHP * settings.upgrades.relicLinkPercent);
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs.length = 0;
    this.player.clear();
    this.wave.clear();
    this.upgrades.clear();
    this.score.clear();
    this.clear();
  }
}
