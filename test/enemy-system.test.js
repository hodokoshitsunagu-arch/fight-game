import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';

import { settings } from '../src/config/settings.js';
import { Enemy } from '../src/enemies/Enemy.js';
import { EnemyManager } from '../src/enemies/EnemyManager.js';
import { EnemyPool } from '../src/enemies/EnemyPool.js';
import { EnemySpawner } from '../src/enemies/EnemySpawner.js';
import { SpatialHashGrid } from '../src/enemies/SpatialHashGrid.js';
import { EventEmitter } from '../src/utils/EventEmitter.js';
import { CombatSystem } from '../src/gameplay/CombatSystem.js';
import { PlayerHitFeedback } from '../src/gameplay/PlayerHitFeedback.js';
import { SelfAbilitySystem } from '../src/gameplay/SelfAbilitySystem.js';

const mockAssets = {
  forwardYaw: 0,
  clips: {},
  createModel: () => new Group()
};

test('SpatialHashGrid returns only items inside the requested radius', () => {
  const grid = new SpatialHashGrid(2);
  const near = { position: new Vector3(1, 0, 1), isDead: false, root: { visible: true } };
  const edge = { position: new Vector3(3, 0, 4), isDead: false, root: { visible: true } };
  const far = { position: new Vector3(8, 0, 0), isDead: false, root: { visible: true } };
  grid.rebuild([near, edge, far]);
  assert.deepEqual(grid.queryRadius(new Vector3(), 5, []), [near, edge]);
});

test('Enemy clamps damage and emits death only once', () => {
  const events = new EventEmitter();
  const enemy = new Enemy(1, mockAssets, events);
  let deaths = 0;
  events.on('enemy:death', () => deaths++);
  enemy.spawn(new Vector3(), new Vector3(10, 0, 0));
  enemy.currentHP = enemy.maxHP = 50;
  assert.equal(enemy.applyDamage({ amount: 80, direction: new Vector3(1, 0, 0), force: 0 }), 50);
  assert.equal(enemy.currentHP, 0);
  assert.equal(enemy.isDead, true);
  assert.equal(enemy.applyDamage({ amount: 10 }), 0);
  assert.equal(deaths, 1);
  enemy.dispose();
});

test('Enemy attack emits once at the authored contact phase', () => {
  const events = new EventEmitter();
  const enemy = new Enemy(2, mockAssets, events);
  let contacts = 0;
  events.on('enemy:attack', () => contacts++);
  enemy.spawn(new Vector3(1, 0, 0), new Vector3());
  enemy.enterAttack();
  enemy.animation.normalizedTime = () => settings.enemy.attackContactPhase;
  enemy.update(0, true);
  enemy.update(0, true);
  assert.equal(contacts, 1);
  enemy.enterAttack(true);
  enemy.update(0, true);
  assert.equal(contacts, 2, 'a new swing gets one new contact');
  enemy.dispose();
});

test('PlayerHitFeedback merges crowd hits and rejects attacks outside melee range', () => {
  const character = {
    position: new Vector3(),
    reactions: 0,
    playHitReaction() {
      this.reactions++;
      return true;
    }
  };
  const feedback = new PlayerHitFeedback(character, { root: null });
  const attacker = {
    position: new Vector3(1, 0, 0),
    isDead: false,
    root: { visible: true }
  };

  assert.equal(feedback.tryHit(attacker), true);
  assert.equal(feedback.tryHit(attacker), false, 'the immunity window merges simultaneous hits');
  assert.equal(character.reactions, 1);
  feedback.update(settings.character.hitReactionInvulnerability + 0.01);
  attacker.position.set(settings.enemy.attackHitRange + 0.1, 0, 0);
  assert.equal(feedback.tryHit(attacker), false, 'a late whiff cannot hit the player');
  attacker.position.set(1, 0, 0);
  assert.equal(feedback.tryHit(attacker), true);
  assert.equal(character.reactions, 2);
  feedback.dispose();
});

test('SelfAbilitySystem repulses every queried enemy and emits virtual healing', () => {
  const particleRecords = [];
  const particleSystem = () => ({
    uniforms: {
      uGravity: { value: new Vector3() },
      uDrag: { value: 0 },
      uStretch: { value: 0 },
      uGlow: { value: 0 },
      uTurbulence: { value: 0 },
      uEndSize: { value: 0 }
    },
    setGradient() {},
    emit(count) { particleRecords.push(count); }
  });
  const victims = Array.from({ length: 4 }, (_, id) => ({
    id,
    position: new Vector3(id + 1, 0, id % 2),
    hits: [],
    applyDamage(hit) { this.hits.push({ ...hit, direction: hit.direction.clone() }); }
  }));
  const character = {
    position: new Vector3(),
    isReacting: true,
    castCalls: [],
    playCast(name, options) {
      this.castCalls.push({ name, options });
      return true;
    },
    castLunge() {}
  };
  const numbers = [];
  let hitStops = 0;
  const system = new SelfAbilitySystem(character, {
    querySphere(_position, radius, out) {
      assert.equal(radius, settings.selfAbilities.repulseRadius);
      out.length = 0;
      out.push(...victims);
      return out;
    }
  }, {
    particles: { get: particleSystem },
    bursts: { spawn() {} },
    decals: { spawn() {} },
    shake: { add() {} },
    flash: { trigger() {} },
    damageNumbers: { spawnPlayer(...args) { numbers.push(args); } },
    requestHitStop() { hitStops++; }
  });

  const repulse = system.cast('repulse');
  assert.equal(repulse.affected, victims.length);
  assert.equal(character.castCalls[0].options.interruptReaction, true);
  for (const victim of victims) {
    assert.equal(victim.hits.length, 1);
    assert.equal(victim.hits[0].amount, settings.selfAbilities.repulseDamage);
    assert.ok(victim.hits[0].direction.y > 0, 'repulse carries an upward launch component');
  }
  assert.ok(particleRecords.reduce((sum, count) => sum + count, 0) >= 200);
  assert.equal(hitStops, 0, 'small groups do not request hit stop');

  const heal = system.cast('heal');
  assert.equal(heal.amount, settings.selfAbilities.healAmount);
  assert.equal(character.castCalls[1].options.interruptReaction, true);
  assert.equal(numbers.length, 1);
  assert.equal(numbers[0][1], settings.selfAbilities.healAmount);
  assert.equal(numbers[0][3], 'heal');
  system.dispose();
});

test('vertical enemy impulses return to ground instead of leaving floating Zombies', () => {
  const enemy = new Enemy(3, mockAssets, new EventEmitter());
  enemy.spawn(new Vector3(), new Vector3(10, 0, 0));
  enemy.externalVelocity.set(4, 12, 0);
  for (let i = 0; i < 240; i++) enemy.update(1 / 60, true);
  assert.equal(enemy.position.y, 0);
  assert.equal(enemy.externalVelocity.y, 0);
  enemy.dispose();
});

test('EnemyPool resets and reuses the same enemy', () => {
  const pool = new EnemyPool(new Scene(), mockAssets, new EventEmitter());
  const target = new Vector3();
  const first = pool.acquire().spawn(new Vector3(2, 0, 3), target);
  pool.release(first);
  const second = pool.acquire().spawn(new Vector3(5, 0, 6), target);
  assert.equal(second, first);
  assert.deepEqual(second.position.toArray(), [5, 0, 6]);
  assert.equal(second.currentHP, settings.enemy.hp);
  pool.dispose();
});

test('EnemySpawner respects annulus radii and per-frame burst cap', () => {
  const spawned = [];
  const manager = {
    get aliveCount() { return spawned.length; },
    spawn(position) { spawned.push(position.clone()); }
  };
  const spawner = new EnemySpawner(manager);
  const previous = { ...settings.enemy };
  Object.assign(settings.enemy, { enabled: true, maxAlive: 500, spawnRate: 0, spawnBatch: 10, minSpawnRadius: 22, maxSpawnRadius: 34 });
  spawner.queue(50);
  spawner.update(1 / 60, new Vector3());
  assert.equal(spawned.length, 10);
  for (const position of spawned) {
    const radius = Math.hypot(position.x, position.z);
    assert.ok(radius >= 22 && radius <= 34);
  }
  Object.assign(settings.enemy, previous);
});

test('EnemyManager sphere and tapered line queries include hit radius', () => {
  const manager = new EnemyManager(new Scene(), new PerspectiveCamera(), { registerShadowCaster() {} });
  const make = (id, x, z) => ({
    id,
    position: new Vector3(x, 0, z),
    hitRadius: 0.55,
    isDead: false,
    root: { visible: true }
  });
  const a = make(1, 2, 0.9);
  const b = make(2, 8, 1.2);
  const c = make(3, 8, 4);
  manager.active.push(a, b, c);
  manager.grid.rebuild(manager.active);
  assert.deepEqual(manager.querySphere(new Vector3(2, 0, 0), 0.4, []), [a]);
  assert.deepEqual(
    manager.queryLine(new Vector3(), new Vector3(10, 0, 0), 0.25, 1.0, []).map((item) => item.id),
    [1, 2]
  );
});

test('CombatSystem emits at most one continuous-damage application per tick', () => {
  const enemyEvents = new EventEmitter();
  const victim = { applyDamage() { this.hits = (this.hits ?? 0) + 1; return 16; } };
  enemyEvents.queryLine = (_start, _end, _a, _b, out) => {
    out.length = 0;
    out.push(victim);
    return out;
  };
  enemyEvents.querySphere = (_center, _radius, out) => out;
  enemyEvents.countDeath = () => {};
  const system = {
    uniforms: { uGravity: { value: new Vector3() }, uDrag: { value: 0 } },
    emit() {}
  };
  const particles = { get: () => system };
  const combat = new CombatSystem(enemyEvents, particles);
  const ability = {
    element: 'beam',
    origin: new Vector3(),
    direction: new Vector3(1, 0, 0),
    length: 10,
    pointAt(s, out) { return out.copy(this.origin).addScaledVector(this.direction, this.length * s); }
  };
  combat.beginCast(ability);
  combat.onAbilityImpact(ability);
  combat.update(0.12);
  combat.updateAbility(ability);
  combat.updateAbility(ability);
  assert.equal(victim.hits, 1);
  combat.update(0.12);
  combat.updateAbility(ability);
  assert.equal(victim.hits, 2);
  combat.dispose();
});
