import { Color, Group, MathUtils, Vector3 } from 'three';
import { settings } from '../config/settings.js';
import { EnemyAnimation } from './EnemyAnimation.js';

export const EnemyState = Object.freeze({
  SPAWN: 'spawn',
  CHASE: 'chase',
  ATTACK: 'attack',
  HIT: 'hit',
  DEAD: 'dead'
});

const STATUS_COLORS = Object.freeze({
  ice: new Color('#4fc8ff'),
  shock: new Color('#adceff'),
  root: new Color('#72e695'),
  snare: new Color('#b88aff')
});
const WHITE = new Color(1, 1, 1);
const TYPE_COLORS = Object.freeze({
  normal: new Color(1, 1, 1),
  runner: new Color('#78f7ff'),
  tank: new Color('#665c70'),
  elite: new Color('#ff4fe1')
});
const _away = new Vector3();

export class Enemy {
  constructor(id, assets, events) {
    this.id = id;
    this.seed = Math.random();
    this.events = events;
    this.root = new Group();
    this.root.name = `Monster:${id}`;
    this.model = assets.createModel();
    this.modelBasePosition = this.model.position.clone();
    this.root.add(this.model);
    this.forwardYaw = assets.forwardYaw;
    this.animation = new EnemyAnimation(this.model, assets.clips);
    this.animation.onFinished = (name) => this._onAnimationFinished(name);

    this.position = this.root.position;
    this.aiVelocity = new Vector3();
    this.externalVelocity = new Vector3();
    this.target = null;
    this.targets = null;
    this.targetKind = 'relic';
    this.targetLockRemaining = 0;
    this.provokedRemaining = 0;
    this.archetype = 'normal';
    this.traits = [];
    this.attackDamagePlayer = 26;
    this.attackDamageRelic = 20;
    this.attackSpeed = 1;
    this.knockbackTaken = 1;
    this.shieldCharges = 0;
    this.state = EnemyState.SPAWN;
    this.maxHP = 100;
    this.currentHP = 100;
    this.moveSpeed = 1.35;
    this.hitRadius = 0.55;
    this.isDead = false;
    this.attackReady = false;
    this.attackHitEmitted = false;
    this.hitTimer = 0;
    this.statusTimer = 0;
    this.statusType = '';
    this.deathTimer = 0;
    this.deathDelay = 0;
    this.deathMode = 'normal';
    this.flashTimer = 0;
    this.recoil = 0;
    this.animationAccumulator = 0;
    this.renderFlash = 0;
    this.renderTint = new Color(1, 1, 1);
    this.baseTint = new Color(1, 1, 1);
    this.baseTintAmount = 0;
    this.renderTintAmount = 0;
    this.renderDissolve = 0;

    this.model.traverse((node) => {
      if (node.isSkinnedMesh) node.userData.enemy = this;
    });
    this.root.visible = false;
  }

  spawn(position, targets, descriptor = {}) {
    const c = settings.enemy;
    const archetype = settings.enemyTypes[descriptor.archetype] ? descriptor.archetype : 'normal';
    const type = settings.enemyTypes[archetype];
    const wave = Math.max(1, descriptor.wave ?? 1);
    const hpScale = Math.min(settings.wave.hpGrowthCap, 1 + (wave - 1) * settings.wave.hpGrowthPerWave);
    const damageScale = Math.min(settings.wave.damageGrowthCap, 1 + (wave - 1) * settings.wave.damageGrowthPerWave);
    this.position.copy(position);
    this.root.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.root.scale.setScalar(type.scale);
    this.model.position.copy(this.modelBasePosition);
    this.model.rotation.set(0, 0, 0);
    this.targets = targets;
    this.target = targets?.relic ?? null;
    this.targetKind = 'relic';
    this.targetLockRemaining = 0;
    this.provokedRemaining = 0;
    this.archetype = archetype;
    this.traits = Array.isArray(descriptor.traits) ? descriptor.traits.slice(0, 2) : [];
    this.maxHP = Math.max(1, Math.round(type.hp * hpScale));
    this.currentHP = this.maxHP;
    this.moveSpeed = c.moveSpeed * type.speedMultiplier * (0.9 + Math.random() * 0.2);
    this.hitRadius = c.hitRadius * type.scale;
    this.attackDamagePlayer = Math.round(type.playerDamage * damageScale);
    this.attackDamageRelic = Math.round(type.relicDamage * damageScale);
    this.attackSpeed = type.attackSpeed;
    this.knockbackTaken = type.knockbackTaken;
    if (this.traits.includes('heavy')) this.knockbackTaken *= settings.enemyTraits.heavy.knockbackTaken;
    this.shieldCharges = this.traits.includes('shielded') ? settings.enemyTraits.shielded.charges : 0;
    this.state = EnemyState.CHASE;
    this.isDead = false;
    this.attackReady = false;
    this.attackHitEmitted = false;
    this.hitTimer = 0;
    this.statusTimer = 0;
    this.statusType = '';
    this.deathTimer = 0;
    this.deathDelay = 0;
    this.deathMode = 'normal';
    this.flashTimer = 0;
    this.recoil = 0;
    this.renderFlash = 0;
    this.renderTint.copy(WHITE);
    this.baseTint.copy(TYPE_COLORS[archetype] ?? WHITE);
    this.baseTintAmount = archetype === 'normal' ? 0 : archetype === 'elite' ? 0.38 : 0.18;
    this.renderTint.copy(this.baseTint);
    this.renderTintAmount = this.baseTintAmount;
    this.renderDissolve = 0;
    this.aiVelocity.set(0, 0, 0);
    this.externalVelocity.set(0, 0, 0);
    this.animation.reset();
    this.animation.onFinished = (name) => this._onAnimationFinished(name);
    this.animation.play('walk', { randomPhase: true, timeScale: this.attackSpeed * (0.9 + Math.random() * 0.2) });
    this.root.visible = true;
    this.root.updateMatrixWorld(true);
    return this;
  }

  _onAnimationFinished(name) {
    if (name === 'attack' && !this.isDead) {
      this.attackReady = true;
    }
  }

  setFacing(x, z, snap = false) {
    if (x * x + z * z < 1e-8) return;
    const wanted = Math.atan2(x, z) - this.forwardYaw;
    if (snap) {
      this.root.rotation.y = wanted;
      return;
    }
    const delta = MathUtils.euclideanModulo(wanted - this.root.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    this.root.rotation.y += delta * 0.18;
  }

  enterAttack(restart = false) {
    if (this.isDead || (this.state === EnemyState.ATTACK && !restart)) return;
    this.state = EnemyState.ATTACK;
    this.aiVelocity.set(0, 0, 0);
    this.attackReady = false;
    this.attackHitEmitted = false;
    this.animation.play('attack', { restart: true, timeScale: 1.15 * this.attackSpeed, blend: 0.16 });
  }

  enterChase() {
    if (this.isDead) return;
    this.state = EnemyState.CHASE;
    this.attackReady = false;
    this.animation.play('walk', { timeScale: 0.95 * this.attackSpeed, blend: 0.16 });
  }

  applyDamage(hit) {
    if (this.isDead || !this.root.visible) return 0;
    if (this.shieldCharges > 0 && !hit.ignoreShield) {
      this.shieldCharges--;
      this.flashTimer = Math.max(this.flashTimer, 0.18);
      this.renderTint.set('#d8f5ff');
      this.renderTintAmount = 0.8;
      this.events?.emit('enemy:shield', { enemy: this, hit });
      return 0;
    }
    const amount = Math.max(0, Math.min(this.currentHP, Number(hit.amount) || 0));
    if (amount <= 0) return 0;

    this.currentHP -= amount;
    this.flashTimer = Math.max(this.flashTimer, settings.enemy.hitFlashDuration);
    this.renderFlash = 1;
    this.hitTimer = Math.max(this.hitTimer, hit.status?.stagger ?? 0.12);
    this.recoil = Math.min(1, this.recoil + 0.75);

    if (hit.status?.duration > 0) {
      this.statusTimer = Math.max(this.statusTimer, hit.status.duration);
      this.statusType = hit.status.type ?? '';
      this.renderTint.copy(STATUS_COLORS[this.statusType] ?? WHITE);
      this.renderTintAmount = 0.48;
    }

    if (hit.direction && hit.force) {
      this.externalVelocity.addScaledVector(
        hit.direction,
        hit.force * settings.enemy.knockbackMultiplier * this.knockbackTaken
      );
    }

    if (hit.canProvoke !== false) this.provokedRemaining = settings.threat.provokeDuration;

    const killed = this.currentHP <= 0;
    this.events?.emit('enemy:hit', { enemy: this, amount, hit, killed });
    if (killed) this.die(hit);
    else if (this.state !== EnemyState.ATTACK || this.hitTimer > 0.2) this.state = EnemyState.HIT;
    return amount;
  }

  die(hit = {}) {
    if (this.isDead) return false;
    this.isDead = true;
    this.state = EnemyState.DEAD;
    this.aiVelocity.set(0, 0, 0);
    const deathStatus = this.statusType;
    this.statusTimer = 0;
    this.deathTimer = 0;
    this.deathDelay = Math.random() * 0.08;
    this.deathMode = hit.deathMode === 'flying' ? 'flying' : 'normal';
    this.animation.play(this.deathMode === 'flying' ? 'flyingDeath' : 'death', {
      restart: true,
      blend: 0.08,
      timeScale: 1.05
    });
    this.events?.emit('enemy:death', { enemy: this, hit, statusType: deathStatus });
    return true;
  }

  invalidateTarget(kind) {
    if (this.targetKind === kind) this.targetLockRemaining = 0;
  }

  _selectTarget(targets) {
    const player = targets?.player;
    const relic = targets?.relic;
    const currentValid = this.target?.isTargetable?.() !== false;
    if (currentValid && this.targetLockRemaining > 0) return this.target;

    let best = relic?.isTargetable?.() !== false ? relic : null;
    let bestScore = -Infinity;
    if (best) {
      const dx = best.position.x - this.position.x;
      const dz = best.position.z - this.position.z;
      bestScore = settings.threat.relicBase + (settings.enemyTypes[this.archetype]?.relicBias ?? 0)
        - Math.sqrt(dx * dx + dz * dz) * settings.threat.relicDistancePenalty;
    }
    if (player?.isTargetable?.() !== false) {
      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const range = this.provokedRemaining > 0 ? settings.threat.provokedAggroRange : settings.threat.playerAggroRange;
      if (distance <= range) {
        const score = settings.threat.playerBase
          + (this.provokedRemaining > 0 ? settings.threat.provokeBonus : 0)
          - distance * settings.threat.playerDistancePenalty;
        if (score > bestScore) {
          best = player;
          bestScore = score;
        }
      }
    }
    if (best && best !== this.target) {
      this.target = best;
      this.targetKind = best.kind;
      this.targetLockRemaining = settings.threat.targetLockDuration;
    }
    return best;
  }

  tickAI(targets, neighbours, step = 0) {
    if (this.isDead) return;
    this.targets = targets;
    this.targetLockRemaining = Math.max(0, this.targetLockRemaining - step);
    this.provokedRemaining = Math.max(0, this.provokedRemaining - step);
    const target = this._selectTarget(targets);
    if (!target) return;
    _away.subVectors(target.position, this.position).setY(0);
    const distance = _away.length();
    const targetRadius = target.radius ?? 0;
    if (distance > 1e-5) _away.multiplyScalar(1 / distance);

    if (this.state === EnemyState.ATTACK) {
      this.setFacing(_away.x, _away.z);
      if (distance > settings.enemy.attackExit + targetRadius || this.attackReady) {
        if (distance <= settings.enemy.attackExit + targetRadius) this.enterAttack(true);
        else this.enterChase();
      }
      return;
    }

    if (distance <= settings.enemy.attackRange + targetRadius && this.hitTimer <= 0 && this.statusTimer <= 0) {
      this.enterAttack();
      this.setFacing(_away.x, _away.z);
      return;
    }

    let slow = 1;
    if (this.statusType === 'ice') slow = 0;
    else if (this.statusType === 'root') slow = 0;
    else if (this.statusType === 'snare') slow = 0.22;
    if (this.hitTimer > 0) slow *= 0.25;
    if (
      this.traits.includes('berserk') &&
      this.currentHP / Math.max(1, this.maxHP) < settings.enemyTraits.berserk.threshold
    ) slow *= settings.enemyTraits.berserk.speedMultiplier;

    this.aiVelocity.copy(_away).multiplyScalar(this.moveSpeed * slow);
    const separationRadius = settings.enemy.separationRadius;
    const r2 = separationRadius * separationRadius;
    for (const other of neighbours) {
      if (other === this || other.isDead) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= 1e-6 || d2 >= r2) continue;
      const strength = (1 - Math.sqrt(d2) / separationRadius) * this.moveSpeed * 0.8 / Math.sqrt(d2);
      this.aiVelocity.x += dx * strength;
      this.aiVelocity.z += dz * strength;
    }
    this.setFacing(this.aiVelocity.x, this.aiVelocity.z);
    if (this.state !== EnemyState.HIT || this.hitTimer <= 0) this.enterChase();
  }

  update(dt, animationStep) {
    if (!this.root.visible) return;
    const animationScale = this.statusType === 'ice' || this.statusType === 'root'
      ? 0
      : this.statusType === 'snare'
        ? 0.28
        : 1;
    this.animationAccumulator += dt * animationScale;
    if (animationStep || this.isDead || this.state === EnemyState.ATTACK || this.state === EnemyState.HIT) {
      this.animation.update(this.animationAccumulator);
      this.animationAccumulator = 0;
    }

    // Emit once as the fist reaches its authored contact phase, not when the
    // lengthy attack animation finishes. Player-side range and immunity checks
    // decide whether this swing actually produces feedback.
    if (
      this.state === EnemyState.ATTACK &&
      !this.attackHitEmitted &&
      this.animation.normalizedTime('attack') >= settings.enemy.attackContactPhase
    ) {
      this.attackHitEmitted = true;
      this.events?.emit('enemy:attack', {
        enemy: this,
        targetKind: this.targetKind,
        damage: this.targetKind === 'player' ? this.attackDamagePlayer : this.attackDamageRelic
      });
    }

    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (this.hitTimer > 0) this.hitTimer = Math.max(0, this.hitTimer - dt);
    if (this.statusTimer > 0) this.statusTimer = Math.max(0, this.statusTimer - dt);
    else this.statusType = '';
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.renderFlash = Math.min(1, this.flashTimer / Math.max(0.001, settings.enemy.hitFlashDuration));
    this.renderTint.copy(STATUS_COLORS[this.statusType] ?? this.baseTint);
    this.renderTintAmount = this.statusType
      ? Math.min(0.48, this.statusTimer * 0.45)
      : this.baseTintAmount;

    const impulseDamping = Math.exp(-settings.enemy.impulseDamping * dt);
    /*
     * Grounded mode drops the vertical entirely rather than letting it arc.
     *
     * Enemies walk at y = 0 already; knockback is the only thing that lifts
     * them. Over a photographed street a body hanging in the air has nothing to
     * explain it — no shadow that agrees, no scenery at that height — so the
     * push keeps its horizontal shove and loses its lift.
     */
    if (settings.enemy.stayGrounded) {
      this.externalVelocity.y = 0;
      this.position.y = 0;
    } else if (this.position.y > 0 || this.externalVelocity.y > 0) {
      this.externalVelocity.y -= 18 * dt;
    }
    this.position.addScaledVector(this.externalVelocity, dt);
    this.externalVelocity.multiplyScalar(impulseDamping);
    if (this.position.y < 0) {
      this.position.y = 0;
      this.externalVelocity.y = 0;
    }

    if (this.isDead) {
      this.deathTimer += dt;
      const fadeStart = Math.min(settings.enemy.corpseDuration * 0.7, 1.4);
      this.renderDissolve = MathUtils.clamp(
        (this.deathTimer - fadeStart) / Math.max(0.1, settings.enemy.corpseDuration - fadeStart),
        0,
        1
      );
      return;
    }

    this.position.addScaledVector(this.aiVelocity, dt);
    this.model.position.z = this.modelBasePosition.z - this.recoil * 0.08;
    this.model.rotation.x = this.recoil * 0.08;
  }

  get recyclable() {
    return this.isDead && this.deathTimer >= settings.enemy.corpseDuration + this.deathDelay;
  }

  reset() {
    this.root.visible = false;
    this.target = null;
    this.targets = null;
    this.targetKind = 'relic';
    this.traits.length = 0;
    this.state = EnemyState.SPAWN;
    this.isDead = false;
    this.attackHitEmitted = false;
    this.animation.reset();
    this.aiVelocity.set(0, 0, 0);
    this.externalVelocity.set(0, 0, 0);
    this.renderDissolve = 0;
  }

  dispose() {
    this.animation.dispose();
    this.root.parent?.remove(this.root);
  }
}
