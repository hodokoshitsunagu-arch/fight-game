import { Vector3 } from 'three';
import { settings } from '../config/settings.js';

export class EnemySpawner {
  constructor(manager) {
    this.manager = manager;
    this.timer = 0;
    this.queueItems = [];
    this.cursor = 0;
    this.position = new Vector3();
  }

  queue(count) {
    const total = Math.max(0, Math.floor(count));
    const items = Array.from({ length: total }, () => ({ archetype: 'normal', traits: [], wave: 1 }));
    this.queueDescriptors(items);
  }

  queueDescriptors(items) {
    this.queueItems = Array.isArray(items) ? items.slice() : [];
    this.cursor = 0;
    this.timer = 0;
  }

  get pendingCount() {
    return Math.max(0, this.queueItems.length - this.cursor);
  }

  update(dt, anchorPosition) {
    if (!settings.enemy.enabled) return;
    const maxAlive = this.manager.maxAliveLimit ?? settings.enemy.maxAlive;
    if (this.pendingCount <= 0 || this.manager.aliveCount >= maxAlive) return;
    const c = settings.wave;
    this.timer -= dt;
    if (this.timer > 0) return;

    const batch = c.spawnPerTickMin + Math.floor(Math.random() * (c.spawnPerTickMax - c.spawnPerTickMin + 1));
    let spawned = 0;
    while (
      spawned < Math.min(batch, c.maxSpawnPerFrame) &&
      this.cursor < this.queueItems.length &&
      this.manager.aliveCount < maxAlive
    ) {
      const descriptor = this.queueItems[this.cursor++];
      this.manager.spawn(this.randomPosition(anchorPosition), descriptor);
      spawned++;
    }
    this.timer = c.spawnIntervalMin + Math.random() * (c.spawnIntervalMax - c.spawnIntervalMin);
    if (this.cursor >= this.queueItems.length) this.queueItems.length = this.cursor;
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
    this.timer = 0;
    this.queueItems.length = 0;
    this.cursor = 0;
  }
}
