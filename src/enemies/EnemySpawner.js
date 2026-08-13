import { Vector3 } from 'three';
import { settings } from '../config/settings.js';

export class EnemySpawner {
  constructor(manager) {
    this.manager = manager;
    this.accumulator = 0;
    this.queued = 0;
    this.position = new Vector3();
  }

  queue(count) {
    this.queued = Math.max(this.queued, Math.max(0, Math.floor(count)));
  }

  update(dt, playerPosition) {
    if (!settings.enemy.enabled) return;
    this.accumulator += dt * settings.enemy.spawnRate;
    let wanted = Math.floor(this.accumulator);
    this.accumulator -= wanted;
    if (this.queued > 0) {
      const burst = Math.min(settings.enemy.spawnBatch, this.queued);
      wanted += burst;
      this.queued -= burst;
    }
    wanted = Math.min(wanted, settings.enemy.spawnBatch);
    while (wanted-- > 0 && this.manager.aliveCount < settings.enemy.maxAlive) {
      this.manager.spawn(this.randomPosition(playerPosition));
    }
  }

  randomPosition(playerPosition) {
    const c = settings.enemy;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(
      c.minSpawnRadius * c.minSpawnRadius +
        Math.random() * (c.maxSpawnRadius * c.maxSpawnRadius - c.minSpawnRadius * c.minSpawnRadius)
    );
    return this.position.set(
      playerPosition.x + Math.cos(angle) * radius,
      0,
      playerPosition.z + Math.sin(angle) * radius
    );
  }

  reset() {
    this.accumulator = 0;
    this.queued = 0;
  }
}
