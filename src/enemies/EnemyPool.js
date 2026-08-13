import { Enemy } from './Enemy.js';

export class EnemyPool {
  constructor(scene, assets, events) {
    this.scene = scene;
    this.assets = assets;
    this.events = events;
    this.free = [];
    this.all = [];
    this.nextId = 1;
  }

  create() {
    const enemy = new Enemy(this.nextId++, this.assets, this.events);
    this.scene.add(enemy.root);
    this.all.push(enemy);
    return enemy;
  }

  prewarm(count) {
    while (this.all.length < count) this.free.push(this.create());
  }

  acquire() {
    return this.free.pop() ?? this.create();
  }

  release(enemy) {
    if (!enemy || this.free.includes(enemy)) return;
    enemy.reset();
    this.free.push(enemy);
  }

  dispose() {
    for (const enemy of this.all) enemy.dispose();
    this.free.length = 0;
    this.all.length = 0;
  }
}
