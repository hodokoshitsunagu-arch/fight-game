import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

import { settings } from '../src/config/settings.js';
import { DummyField } from '../src/sandbox/DummyField.js';
import { TargetSelector } from '../src/voice/TargetSelector.js';
import { PerspectiveCamera } from 'three';

/** Stand-in for EnemyManager with just the surface DummyField touches. */
function makeEnemies() {
  const enemies = {
    active: [],
    stopped: 0,
    cleared: 0,
    stopSpawning() {
      this.stopped++;
    },
    clearEnemies() {
      this.cleared++;
      this.active.length = 0;
    },
    spawn(position) {
      const enemy = { position: position.clone(), isDead: false };
      this.active.push(enemy);
      return enemy;
    },
    get aliveCount() {
      return this.active.filter((e) => !e.isDead).length;
    }
  };
  return enemies;
}

/** Runs the field forward in small steps, as a frame loop would. */
function run(field, seconds, step = 0.1) {
  for (let t = 0; t < seconds; t += step) field.update(step);
}

test('nothing arrives the instant the scene loads', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.start();
  assert.equal(enemies.aliveCount, 0, 'the opening delay is respected');

  run(field, settings.encounter.openingDelay - 0.5);
  assert.equal(enemies.aliveCount, 0, 'still nothing');
});

test('a batch arrives staggered, not all at once', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.start();

  run(field, settings.encounter.openingDelay + 0.2);
  const firstWave = enemies.aliveCount;
  assert.ok(firstWave >= 1, 'the batch has started');
  assert.ok(firstWave < settings.encounter.batchSize,
    `${firstWave} of ${settings.encounter.batchSize} so far — arrivals are spread out`);

  run(field, settings.encounter.batchSize * settings.encounter.arrivalStagger + 3);
  assert.ok(enemies.aliveCount > firstWave, 'and the rest follow');
});

test('clearing a batch buys a gap before the next one', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.start();
  run(field, settings.encounter.openingDelay + 6);
  assert.ok(enemies.aliveCount > 0, 'a batch is out');

  // Clear the field, as a player would.
  enemies.active.length = 0;
  field.update(0.1);
  assert.equal(field.phase, 'resting', 'an empty field starts the rest');

  run(field, settings.encounter.restSeconds - 1);
  assert.equal(enemies.aliveCount, 0, 'the gap is real — nothing arrives during it');

  run(field, 2.5);
  assert.ok(enemies.aliveCount > 0, 'and then the next batch starts');
});

test('no more than the cap stand in front of the player', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.start();
  run(field, 40);

  const halfArc = settings.encounter.viewArc / 2;
  const inView = enemies.active.filter((e) => {
    const bearing = Math.atan2(e.position.x, e.position.z);
    return Math.abs(((bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) <= halfArc;
  }).length;

  assert.ok(inView <= settings.encounter.maxInView,
    `${inView} in view against a cap of ${settings.encounter.maxInView}`);
});

test('arrivals are spread in bearing and depth, some from behind', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.start();
  run(field, 40);

  const bearings = enemies.active.map((e) => Math.atan2(e.position.x, e.position.z));
  assert.equal(new Set(bearings.map((b) => b.toFixed(3))).size, bearings.length,
    'no two share a bearing');

  const distances = enemies.active.map((e) => Math.hypot(e.position.x, e.position.z));
  assert.ok(Math.min(...distances) >= settings.encounter.minDistance - 1,
    'all start beyond the near bound');
  assert.ok(Math.min(...distances) > settings.ice.range,
    'and beyond Frost Lance, so there is something to watch them do');
});

test('the roster decides who turns up, and it is not all one thing', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.start();
  // Several batches, so the repeating roster gets past its first entries.
  for (let i = 0; i < 6; i++) {
    run(field, 20);
    enemies.active.length = 0;
    run(field, settings.encounter.restSeconds + 1);
  }

  const seen = field.config.roster;
  assert.ok(seen.some((r) => r.behaviour === 'wanderer'), 'something that circles');
  assert.ok(seen.some((r) => r.behaviour === 'sentry'), 'something that waits to be hit');
  assert.ok(new Set(seen.map((r) => r.archetype)).size > 1, 'more than one archetype');
});

test('the telegraph marks the ground before anything uses it', () => {
  const marks = [];
  const telegraph = {
    mark: (x, z) => { marks.push({ x, z }); return 1.5; },
    update: () => {},
    clear: () => {}
  };
  const enemies = makeEnemies();
  const field = new DummyField(enemies, { telegraph });
  field.getFacing = () => 0;
  field.start();

  run(field, settings.encounter.openingDelay + 0.2);
  assert.equal(marks.length, settings.encounter.batchSize, 'every arrival is announced');
  // The lead the telegraph asks for delays the spawn, or the warning would
  // arrive with the thing it was warning about.
  assert.equal(enemies.aliveCount, 0, 'and nothing has arrived yet');

  run(field, 2);
  assert.ok(enemies.aliveCount > 0, 'then they come out of the marked spots');
});

test('stop clears the field and the pending arrivals', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies);
  field.getFacing = () => 0;
  field.start();
  run(field, settings.encounter.openingDelay + 1);
  field.stop();
  assert.equal(enemies.aliveCount, 0);
  assert.equal(field.pending.length, 0);
  run(field, 20);
  assert.equal(enemies.aliveCount, 0, 'and stays stopped');
});

test('yaw matches the AimController convention', () => {
  const selector = new TargetSelector({
    camera: new PerspectiveCamera(),
    enemies: { active: [{ position: new Vector3(5, 0, 0), isDead: false }] },
    character: { position: new Vector3() }
  });
  const solved = selector.solve('ice');
  // AimController: Math.atan2(direction.x, direction.z)
  assert.ok(Math.abs(solved.yaw - Math.atan2(solved.direction.x, solved.direction.z)) < 1e-9);
  assert.equal(Number.isFinite(solved.yaw), true, 'a scalar, not a vector');
});
