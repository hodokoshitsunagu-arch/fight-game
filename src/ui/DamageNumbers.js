import { Vector3 } from 'three';

const MAX_NUMBERS = 80;
const MERGE_WINDOW = 0.12;
const _world = new Vector3();

/** One transparent canvas for every floating number: no DOM node churn. */
export class DamageNumbers {
  constructor(camera) {
    this.camera = camera;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'damage-numbers';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.records = [];
    this.elapsed = 0;
    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });
  }

  resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
  };

  spawn(enemy, amount, color, killed = false) {
    const existing = this.records.find(
      (record) => record.enemyId === enemy.id && this.elapsed - record.createdAt <= MERGE_WINDOW
    );
    if (existing) {
      existing.amount += amount;
      existing.age = 0;
      existing.killed ||= killed;
      existing.life = existing.killed ? 1.28 : 1.0;
      existing.createdAt = this.elapsed;
      existing.position.copy(enemy.position).add(_world.set(0, 1.65, 0));
      return;
    }

    const record = this.records.length >= MAX_NUMBERS ? this.records.shift() : {};
    record.enemyId = enemy.id;
    record.amount = amount;
    record.color = color;
    record.kind = 'damage';
    record.player = false;
    record.killed = killed;
    record.age = 0;
    record.life = killed ? 1.28 : 1.0;
    record.createdAt = this.elapsed;
    record.offset = (Math.random() - 0.5) * 32;
    record.position ??= new Vector3();
    record.position.copy(enemy.position).add(_world.set(0, 1.65, 0));
    this.records.push(record);
  }

  /** Virtual player combat text; presentation only, with no HP dependency. */
  spawnPlayer(position, amount, color, kind = 'damage') {
    const record = this.records.length >= MAX_NUMBERS ? this.records.shift() : {};
    record.enemyId = `player:${kind}`;
    record.amount = amount;
    record.color = color;
    record.kind = kind;
    record.player = true;
    record.killed = false;
    record.age = 0;
    record.life = kind === 'heal' ? 1.45 : 1.12;
    record.createdAt = this.elapsed;
    record.offset = (Math.random() - 0.5) * 22;
    record.position ??= new Vector3();
    record.position.copy(position).add(_world.set(0, 2.05, 0));
    this.records.push(record);
  }

  update(dt) {
    this.elapsed += dt;
    const ctx = this.ctx;
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i];
      record.age += dt;
      if (record.age >= record.life) {
        this.records.splice(i, 1);
        continue;
      }
      const t = record.age / record.life;
      _world.copy(record.position).project(this.camera);
      if (_world.z < -1 || _world.z > 1) continue;
      const x = (_world.x * 0.5 + 0.5) * width + record.offset * Math.sin(t * Math.PI);
      const rise = record.player ? 96 : 82;
      const y = (-_world.y * 0.5 + 0.5) * height - rise * t - Math.sin(t * Math.PI) * 12;
      const popIn = Math.min(1, t / 0.12);
      const overshoot = 1 + Math.sin(popIn * Math.PI) * 0.38;
      const settle = 1 - Math.max(0, t - 0.28) * 0.16;
      const pop = Math.max(0.72, popIn * overshoot * settle);
      const alpha = Math.min(1, (1 - t) * 2.8);
      const baseSize = record.player ? (record.kind === 'heal' ? 42 : 36) : (record.killed ? 39 : 28);
      const size = baseSize * pop;
      const prefix = record.kind === 'heal' ? '+' : '-';
      const text = `${prefix}${Math.round(record.amount)}`;
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${size}px Inter, Segoe UI, sans-serif`;
      ctx.lineWidth = Math.max(4, size * 0.18);
      ctx.strokeStyle = 'rgba(3, 7, 12, 0.9)';
      ctx.shadowColor = record.color;
      ctx.shadowBlur = record.player || record.killed ? 18 : 10;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = record.color;
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;

      if (record.player && t < 0.72) {
        ctx.globalAlpha = alpha * 0.72;
        ctx.font = `800 ${Math.max(10, size * 0.27)}px Inter, Segoe UI, sans-serif`;
        ctx.fillStyle = record.kind === 'heal' ? '#d8ffe2' : '#ffd8dc';
        ctx.fillText(record.kind === 'heal' ? 'RECOVER' : 'HIT', x, y + size * 0.72);
      }
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.records.length = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
    this.records.length = 0;
  }
}
