import { Frustum, Matrix4, Vector3 } from 'three';
import { settings } from '../config/settings.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { EnemyAssets } from './EnemyAssets.js';
import { EnemyPool } from './EnemyPool.js';
import { EnemySpawner } from './EnemySpawner.js';
import { SpatialHashGrid } from './SpatialHashGrid.js';

const _line = new Vector3();
const _from = new Vector3();
const _closest = new Vector3();

export class EnemyManager extends EventEmitter {
  constructor(scene, camera, environment) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.environment = environment;
    this.assets = null;
    this.pool = null;
    this.spawner = new EnemySpawner(this);
    this.grid = new SpatialHashGrid(2.2);
    this.active = [];
    this.target = null;
    this.kills = 0;
    this.aiAccumulator = 0;
    this.frameIndex = 0;
    this.queryScratch = [];
    this.neighbourScratch = [];
    this.frustum = new Frustum();
    this.projectionView = new Matrix4();
    this.compileEnemy = null;
  }

  async load(assets, onProgress) {
    onProgress?.('Loading Monster model and animations…');
    this.assets = await EnemyAssets.load(assets, this.environment);
    this.pool = new EnemyPool(this.scene, this.assets, this);
    this.pool.prewarm(Math.min(settings.enemy.prewarm, settings.enemy.maxAlive));
    this.spawner.queue(settings.enemy.initialHorde);
  }

  /** Temporarily expose one pooled model so compileAsync sees Monster shaders. */
  setCompileVisible(visible) {
    if (!this.pool) return;
    this.compileEnemy ??= this.pool.free[this.pool.free.length - 1] ?? null;
    if (this.compileEnemy) this.compileEnemy.root.visible = visible;
  }

  setTarget(position) {
    this.target = position;
  }

  spawn(position) {
    if (!this.pool || !this.target || this.aliveCount >= settings.enemy.maxAlive) return null;
    const enemy = this.pool.acquire().spawn(position, this.target);
    this.active.push(enemy);
    return enemy;
  }

  spawnHorde(count = 50) {
    this.spawner.queue(count);
  }

  clearEnemies({ resetKills = false } = {}) {
    for (const enemy of this.active) this.pool?.release(enemy);
    this.active.length = 0;
    this.grid.clear();
    this.spawner.reset();
    if (resetKills) this.kills = 0;
  }

  get aliveCount() {
    let total = 0;
    for (const enemy of this.active) if (!enemy.isDead) total++;
    return total;
  }

  update(dt, realDt = dt) {
    if (!this.pool || !this.target) return;
    this.frameIndex++;
    this.spawner.update(dt, this.target);
    this.grid.rebuild(this.active);

    this.aiAccumulator += dt;
    const aiStep = 1 / Math.max(1, settings.enemy.aiRate);
    if (this.aiAccumulator >= aiStep) {
      const step = Math.min(this.aiAccumulator, aiStep * 2);
      this.aiAccumulator = 0;
      for (const enemy of this.active) {
        if (enemy.isDead) continue;
        this.grid.queryRadius(enemy.position, settings.enemy.separationRadius, this.neighbourScratch);
        enemy.tickAI(this.target, this.neighbourScratch, step);
      }
    }

    this.projectionView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const enemy = this.active[i];
      const d2 = enemy.position.distanceToSquared(this.target);
      const stride = d2 < 18 * 18 ? 1 : d2 < 34 * 34 ? 2 : 4;
      const visible = this.frustum.containsPoint(enemy.position);
      enemy.update(dt, visible && this.frameIndex % stride === enemy.id % stride);
      if (enemy.recyclable) {
        this.active.splice(i, 1);
        this.pool.release(enemy);
      }
    }
  }

  querySphere(center, radius, out = []) {
    const broadRadius = Math.max(0, radius) + settings.enemy.hitRadius;
    this.grid.queryRadius(center, broadRadius, out);
    let write = 0;
    for (let i = 0; i < out.length; i++) {
      const enemy = out[i];
      const total = radius + enemy.hitRadius;
      const dx = enemy.position.x - center.x;
      const dz = enemy.position.z - center.z;
      if (!enemy.isDead && dx * dx + dz * dz <= total * total) out[write++] = enemy;
    }
    out.length = write;
    return out;
  }

  queryLine(start, end, startRadius, endRadius = startRadius, out = []) {
    const maxRadius = Math.max(startRadius, endRadius) + settings.enemy.hitRadius;
    const minX = Math.min(start.x, end.x) - maxRadius;
    const maxX = Math.max(start.x, end.x) + maxRadius;
    const minZ = Math.min(start.z, end.z) - maxRadius;
    const maxZ = Math.max(start.z, end.z) + maxRadius;
    this.grid.queryAABB(minX, minZ, maxX, maxZ, out);

    _line.subVectors(end, start).setY(0);
    const length2 = Math.max(1e-8, _line.lengthSq());
    let write = 0;
    for (let i = 0; i < out.length; i++) {
      const enemy = out[i];
      if (enemy.isDead) continue;
      _from.subVectors(enemy.position, start).setY(0);
      const t = Math.max(0, Math.min(1, _from.dot(_line) / length2));
      _closest.copy(start).addScaledVector(_line, t);
      const radius = startRadius + (endRadius - startRadius) * t + enemy.hitRadius;
      const dx = enemy.position.x - _closest.x;
      const dz = enemy.position.z - _closest.z;
      if (dx * dx + dz * dz <= radius * radius) out[write++] = enemy;
    }
    out.length = write;
    return out;
  }

  countDeath() {
    this.kills++;
  }

  dispose() {
    this.clearEnemies();
    this.pool?.dispose();
    this.pool = null;
    this.assets?.dispose();
    this.assets = null;
    this.clear();
  }
}
