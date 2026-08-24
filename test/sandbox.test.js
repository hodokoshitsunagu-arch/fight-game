import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

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

test('start fills the ring and takes the wave spawner out of the loop', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies, { count: 6 });
  field.start();
  assert.equal(enemies.aliveCount, 6);
  assert.equal(enemies.stopped, 1, 'wave spawning stopped');
});

test('dummies are not placed in a straight line', () => {
  const enemies = makeEnemies();
  new DummyField(enemies, { count: 8, radius: 12 }).start();
  const angles = enemies.active.map((e) => Math.atan2(e.position.z, e.position.x));
  assert.equal(new Set(angles.map((a) => a.toFixed(3))).size, 8, 'every dummy has its own bearing');
  const radii = enemies.active.map((e) => e.position.length());
  assert.ok(Math.max(...radii) - Math.min(...radii) > 1, 'and they sit at varied distances');
});

test('a killed dummy is replaced, after a beat', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies, { count: 4, respawnDelay: 1.5 });
  field.start();

  enemies.active[0].isDead = true;
  enemies.active.splice(0, 1);
  assert.equal(enemies.aliveCount, 3);

  field.update(0.1);
  assert.equal(enemies.aliveCount, 3, 'not instantly — the kill stays legible');

  field.update(2.0);
  assert.equal(enemies.aliveCount, 4, 'then topped back up');
});

test('a full ring never over-spawns', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies, { count: 5 });
  field.start();
  for (let i = 0; i < 100; i++) field.update(0.5);
  assert.equal(enemies.aliveCount, 5);
});

test('stop clears the arena', () => {
  const enemies = makeEnemies();
  const field = new DummyField(enemies, { count: 5 });
  field.start();
  field.stop();
  assert.equal(enemies.aliveCount, 0);
  field.update(10);
  assert.equal(enemies.aliveCount, 0, 'and stays cleared');
});

test('the dummy ring is reachable by the abilities that will be cast at it', () => {
  const enemies = makeEnemies();
  new DummyField(enemies, { count: 8, radius: 12 }).start();
  const selector = new TargetSelector({
    camera: new PerspectiveCamera(),
    enemies,
    character: { position: new Vector3() }
  });
  // Frost Lance has the shortest reach of the line casts; if the ring works for
  // it, the ring works.
  const solved = selector.solve('ice');
  assert.ok(solved.target, 'a dummy was found');
  assert.ok(solved.distance > 0);
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
