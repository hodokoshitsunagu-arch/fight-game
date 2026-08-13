/**
 * Allocation-free 2D spatial hash for the flat combat arena.
 *
 * Buckets are rebuilt from the manager's dense enemy array. Queries accept an
 * output array owned by the caller so ability ticks and separation never make
 * garbage on the hot path.
 */
export class SpatialHashGrid {
  constructor(cellSize = 2) {
    this.cellSize = Math.max(0.25, cellSize);
    this.cells = new Map();
  }

  _coord(value) {
    return Math.floor(value / this.cellSize);
  }

  _key(x, z) {
    return `${x},${z}`;
  }

  clear() {
    for (const bucket of this.cells.values()) bucket.length = 0;
    this.cells.clear();
  }

  insert(item) {
    const x = this._coord(item.position.x);
    const z = this._coord(item.position.z);
    const key = this._key(x, z);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(item);
  }

  rebuild(items) {
    this.clear();
    for (const item of items) {
      if (!item.isDead && item.root.visible) this.insert(item);
    }
  }

  queryAABB(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const x0 = this._coord(minX);
    const z0 = this._coord(minZ);
    const x1 = this._coord(maxX);
    const z1 = this._coord(maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const bucket = this.cells.get(this._key(x, z));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }

  queryRadius(center, radius, out = []) {
    this.queryAABB(center.x - radius, center.z - radius, center.x + radius, center.z + radius, out);
    const r2 = radius * radius;
    let write = 0;
    for (let i = 0; i < out.length; i++) {
      const item = out[i];
      const dx = item.position.x - center.x;
      const dz = item.position.z - center.z;
      if (dx * dx + dz * dz <= r2) out[write++] = item;
    }
    out.length = write;
    return out;
  }
}
