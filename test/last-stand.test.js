import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Scene, Vector3 } from 'three';

import { settings } from '../src/config/settings.js';
import { Enemy } from '../src/enemies/Enemy.js';
import { EventEmitter } from '../src/utils/EventEmitter.js';
import { PlayerHealth } from '../src/gameplay/PlayerHealth.js';
import { RelicController } from '../src/gameplay/RelicController.js';
import { ScoreManager } from '../src/gameplay/ScoreManager.js';
import { UpgradeManager } from '../src/gameplay/UpgradeManager.js';
import { WaveDirector } from '../src/gameplay/WaveDirector.js';
import { WaveManager, WaveState } from '../src/gameplay/WaveManager.js';
import { PerformanceQualityController } from '../src/core/PerformanceQualityController.js';

const mockAssets = { forwardYaw: 0, clips: {}, createModel: () => new Group() };

test('PlayerHealth downs, counts down and respawns beside the Relic', () => {
  const position = new Vector3(4, 0, 4);
  const player = new PlayerHealth(position);
  let downs = 0;
  let respawns = 0;
  player.on('player:down', () => downs++);
  player.on('player:respawn', () => respawns++);
  assert.equal(player.damage(player.maxHP), player.maxHP);
  assert.equal(player.isDowned, true);
  assert.equal(player.isTargetable, false);
  const respawn = new Vector3(2.4, 0, 0);
  player.update(settings.player.respawnDelay - 0.1, respawn);
  assert.equal(player.isDowned, true);
  player.update(0.2, respawn);
  assert.equal(player.isDowned, false);
  assert.equal(player.currentHP, Math.round(player.maxHP * settings.player.respawnHealthPercent));
  assert.deepEqual(position.toArray(), respawn.toArray());
  assert.equal(downs, 1);
  assert.equal(respawns, 1);
});

test('Relic clamps health, emits thresholds once and destroys once', () => {
  const relic = new RelicController(new Scene());
  const warnings = [];
  let destroyed = 0;
  relic.on('relic:warning', ({ level }) => warnings.push(level));
  relic.on('relic:destroyed', () => destroyed++);
  relic.damage(520);
  relic.heal(40);
  relic.damage(300);
  relic.damage(99999);
  relic.damage(10);
  assert.deepEqual(warnings, ['damaged', 'critical']);
  assert.equal(relic.currentHP, 0);
  assert.equal(relic.isDestroyed, true);
  assert.equal(destroyed, 1);
  relic.reset();
  assert.equal(relic.currentHP, settings.relic.maxHP);
  relic.dispose();
});

test('Enemy threat prefers a nearby living player and immediately falls back to the Relic', () => {
  const events = new EventEmitter();
  const enemy = new Enemy(10, mockAssets, events);
  let playerAlive = true;
  const player = { kind: 'player', position: new Vector3(2, 0, 0), radius: 0.65, isTargetable: () => playerAlive };
  const relic = { kind: 'relic', position: new Vector3(), radius: 1.65, isTargetable: () => true };
  enemy.spawn(new Vector3(8, 0, 0), { player, relic }, { archetype: 'runner', traits: [], wave: 3 });
  enemy.tickAI({ player, relic }, [], 1 / 15);
  assert.equal(enemy.targetKind, 'player');
  playerAlive = false;
  enemy.invalidateTarget('player');
  enemy.tickAI({ player, relic }, [], 1 / 15);
  assert.equal(enemy.targetKind, 'relic');
  enemy.dispose();
});

test('Enemy archetypes and Shielded trait are applied without a new material', () => {
  const events = new EventEmitter();
  const enemy = new Enemy(11, mockAssets, events);
  const target = { kind: 'relic', position: new Vector3(), radius: 1, isTargetable: () => true };
  enemy.spawn(new Vector3(5, 0, 0), { player: target, relic: target }, { archetype: 'tank', traits: ['shielded', 'heavy'], wave: 5 });
  assert.equal(enemy.archetype, 'tank');
  assert.equal(enemy.root.scale.x, settings.enemyTypes.tank.scale);
  assert.equal(enemy.maxHP > settings.enemyTypes.tank.hp, true);
  assert.equal(enemy.applyDamage({ amount: 100 }), 0, 'shield absorbs the first hit');
  assert.equal(enemy.applyDamage({ amount: 100 }), 100);
  enemy.dispose();
});

test('WaveDirector is deterministic, budget bounded and unlocks encounter types', () => {
  const director = new WaveDirector();
  const wave1 = director.generate(1);
  const wave10a = director.generate(10);
  const wave10b = director.generate(10);
  assert.equal(wave1.descriptors.every((item) => item.archetype === 'normal'), true);
  assert.equal(wave10a.milestone, true);
  assert.equal(wave10a.maxAlive, settings.wave.milestoneMaxAlive);
  assert.deepEqual(wave10a.descriptors, wave10b.descriptors);
  assert.equal(wave10a.descriptors.some((item) => item.archetype === 'elite'), true);
  const spent = wave10a.descriptors.reduce((sum, item) => sum + settings.enemyTypes[item.archetype].cost, 0);
  assert.ok(spent <= wave10a.budget + 0.001);
  assert.ok(spent >= wave10a.budget - 1.5);
});

test('WaveManager follows countdown, spawn, clear and upgrade states without UI callbacks', () => {
  const enemies = {
    pendingSpawnCount: 0,
    aliveCount: 0,
    queueWave(items, maxAlive) { this.items = items; this.maxAlive = maxAlive; this.pendingSpawnCount = items.length; },
    clearEnemies() { this.aliveCount = 0; },
    stopSpawning() { this.pendingSpawnCount = 0; },
    killAll() { this.aliveCount = 0; }
  };
  const wave = new WaveManager(enemies);
  wave.start();
  assert.equal(wave.state, WaveState.PREPARING);
  wave.update(settings.game.prepareDuration + 0.1);
  assert.equal(wave.state, WaveState.INTRO);
  wave.update(settings.game.waveIntroDuration + 0.1);
  assert.equal(wave.state, WaveState.SPAWNING);
  enemies.pendingSpawnCount = 0;
  enemies.aliveCount = 1;
  wave.update(0.1);
  assert.equal(wave.state, WaveState.COMBAT);
  enemies.aliveCount = 0;
  wave.update(0.1);
  assert.equal(wave.state, WaveState.COMPLETE);
  wave.update(settings.game.waveClearDuration + 0.1);
  assert.equal(wave.state, WaveState.UPGRADE);
  wave.completeUpgrade();
  assert.equal(wave.wave, 2);
  assert.equal(wave.state, WaveState.PREPARING);
});

test('UpgradeManager applies ranked modifiers and behavior cards and resets cleanly', () => {
  const player = { maxHP: 300, heal() {} };
  const relic = { maxHP: 1000, heal() {} };
  const upgrades = new UpgradeManager({ player, relic });
  const baseRadius = settings.meteor.shockRadius;
  upgrades.currentOffers = [{ id: 'power', title: 'Power' }, { id: 'burning-ground', title: 'Burn' }];
  upgrades.apply('power');
  upgrades.currentOffers = [{ id: 'burning-ground', title: 'Burn' }];
  upgrades.apply('burning-ground');
  upgrades.currentOffers = [{ id: 'radius', title: 'Radius' }];
  upgrades.apply('radius');
  assert.equal(upgrades.damageMultiplier, 1 + settings.upgrades.damagePerRank);
  assert.equal(upgrades.has('burning-ground'), true);
  assert.equal(settings.meteor.shockRadius, baseRadius * (1 + settings.upgrades.radiusPerRank));
  upgrades.reset();
  assert.equal(upgrades.damageMultiplier, 1);
  assert.equal(upgrades.has('burning-ground'), false);
  assert.equal(settings.meteor.shockRadius, baseRadius);
  assert.equal(upgrades.draw(3).length, 3);
});

test('ScoreManager awards archetype and wave score and persists best records safely', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const score = new ScoreManager(storage);
  score.enemyKilled({ archetype: 'runner' });
  score.waveCleared(3);
  score.update(12.5, true);
  const result = score.finalize(3);
  assert.equal(result.kills, 1);
  assert.equal(result.score, settings.enemyTypes.runner.score + 3 * settings.score.waveClearMultiplier);
  assert.equal(result.bestWave, 3);
  const restored = new ScoreManager(storage);
  assert.equal(restored.best.bestScore, result.score);
});

test('PerformanceQualityController only reduces visual quality after sustained low FPS', () => {
  const previousQuality = settings.global.quality;
  const previousAuto = settings.performance.autoQuality;
  settings.global.quality = 'high';
  settings.performance.autoQuality = true;
  let changed = '';
  const controller = new PerformanceQualityController((quality) => { changed = quality; });
  for (let i = 0; i < 6; i++) controller.update(1, true);
  assert.equal(changed, 'medium');
  assert.equal(settings.global.quality, 'medium');
  settings.global.quality = previousQuality;
  settings.performance.autoQuality = previousAuto;
});
