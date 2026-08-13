import { Color, Vector3 } from 'three';
import { settings } from '../config/settings.js';
import { frame } from '../core/FrameUniforms.js';
import { BurstMode } from '../effects/BurstSphere.js';
import { DecalType } from '../effects/GroundDecals.js';
import { ParticleShape } from '../particles/ParticleSystem.js';
import { getColor } from '../utils/color.js';

const UP = new Vector3(0, 1, 0);
const REPULSE_A = new Color('#efffff');
const REPULSE_B = new Color('#61dfff');
const REPULSE_C = new Color('#6678ff');
const HEAL_A = new Color('#efffe5');
const HEAL_B = new Color('#71ff9c');
const HEAL_C = new Color('#15a96c');

/** Two immediate, caster-centred abilities sharing the existing pooled VFX services. */
export class SelfAbilitySystem {
  constructor(character, enemies, context) {
    this.character = character;
    this.enemies = enemies;
    this.ctx = context;
    this.hitScratch = [];
    this.healRemaining = 0;
    this.healAccumulator = 0;
    this.position = new Vector3();
    this.direction = new Vector3();

    this.repulseParticles = context.particles.get('self-repulse-streaks', {
      capacity: 900,
      shape: ParticleShape.STREAK,
      additive: true,
      stretch: true
    });
    this.repulseParticles.setGradient(REPULSE_A, REPULSE_B, REPULSE_C, REPULSE_C);
    this.repulseParticles.uniforms.uGravity.value.set(0, -5.5, 0);
    this.repulseParticles.uniforms.uDrag.value = 1.15;
    this.repulseParticles.uniforms.uStretch.value = 0.5;
    this.repulseParticles.uniforms.uGlow.value = 1.8;

    this.healParticles = context.particles.get('self-heal-motes', {
      capacity: 1200,
      shape: ParticleShape.SOFT,
      additive: true,
      curl: true
    });
    this.healParticles.setGradient(HEAL_A, HEAL_B, HEAL_C, HEAL_C);
    this.healParticles.uniforms.uGravity.value.set(0, 1.4, 0);
    this.healParticles.uniforms.uDrag.value = 1.4;
    this.healParticles.uniforms.uTurbulence.value = 0.85;
    this.healParticles.uniforms.uEndSize.value = 0.16;
    this.healParticles.uniforms.uGlow.value = 1.7;
  }

  cast(id) {
    if (id === 'repulse') return this._castRepulse();
    if (id === 'heal') return this._castHeal();
    return null;
  }

  _castRepulse() {
    if (!this.character.playCast('cast1', { interruptReaction: true })) return null;
    this.character.castLunge();
    const c = settings.selfAbilities;
    this.position.copy(this.character.position).setY(0);
    const hits = this.enemies.querySphere(this.position, c.repulseRadius, this.hitScratch);

    for (const enemy of hits) {
      this.direction.subVectors(enemy.position, this.position);
      this.direction.y = Math.max(1.4, this.direction.length() * 0.32);
      if (this.direction.lengthSq() < 1e-5) this.direction.set(Math.random() - 0.5, 0.65, Math.random() - 0.5);
      this.direction.normalize();
      enemy.applyDamage({
        amount: c.repulseDamage,
        element: 'repulse',
        position: this.position,
        direction: this.direction,
        force: c.repulseForce,
        damageType: 'impact',
        status: { type: 'shock', duration: 0.42, stagger: 0.42 },
        deathMode: 'flying'
      });
    }

    this._repulseVfx(c.repulseRadius);
    if (hits.length >= 8) this.ctx.requestHitStop?.(0.045);
    return { id: 'repulse', affected: hits.length };
  }

  _repulseVfx(radius) {
    this.position.y = 0.45;
    this.ctx.bursts.spawn(BurstMode.AIR, this.position, {
      radius: 0.35,
      endRadius: radius,
      life: 0.58,
      intensity: 2.2,
      opacity: 1,
      fresnel: 2.4,
      displace: 0.32,
      colorA: REPULSE_A,
      colorB: REPULSE_B,
      colorC: REPULSE_C,
      squash: 0.28
    });
    this.ctx.bursts.spawn(BurstMode.STORM, this.position, {
      radius: 0.25,
      endRadius: radius * 0.68,
      life: 0.72,
      intensity: 1.65,
      opacity: 0.8,
      colorA: REPULSE_A,
      colorB: REPULSE_B,
      colorC: REPULSE_C,
      squash: 0.42
    });
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, this.position, {
      radius,
      life: 0.75,
      width: 0.075,
      intensity: 2,
      colorA: REPULSE_B,
      colorB: REPULSE_A,
      growth: 0.18
    });

    for (let i = 0; i < 20; i++) {
      const angle = i / 20 * Math.PI * 2;
      this.direction.set(Math.cos(angle), 0.14 + Math.random() * 0.2, Math.sin(angle));
      this.repulseParticles.emit(10, {
        position: this.position,
        radius: 0.45,
        direction: this.direction,
        speed: radius * 1.25,
        speedVariance: 0.25,
        spread: 0.18,
        size: 0.15,
        sizeVariance: 0.6,
        life: 0.72,
        lifeVariance: 0.3,
        time: frame.uTime.value
      });
    }
    this.ctx.flash.trigger(REPULSE_A, 0.32, 0.0015);
    this.ctx.shake.add(0.62, 2.6, 24);
  }

  _castHeal() {
    if (!this.character.playCast('cast3', { interruptReaction: true })) return null;
    const c = settings.selfAbilities;
    this.healRemaining = c.healDuration;
    this.healAccumulator = 0;
    this.position.copy(this.character.position).setY(0.8);

    this.ctx.bursts.spawn(BurstMode.AIR, this.position, {
      radius: 0.22,
      endRadius: 4.2,
      life: 1.05,
      intensity: 1.75,
      opacity: 0.82,
      fresnel: 2.1,
      colorA: HEAL_A,
      colorB: HEAL_B,
      colorC: HEAL_C,
      squash: 0.65
    });
    this.ctx.decals.spawn(DecalType.RIPPLE, this.position, {
      radius: 4.4,
      life: 1.35,
      width: 0.065,
      intensity: 1.8,
      colorA: HEAL_C,
      colorB: HEAL_A
    });
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, this.position, {
      radius: 3.8,
      life: 0.85,
      intensity: 1.35,
      colorA: HEAL_B,
      colorB: HEAL_A
    });
    this.ctx.damageNumbers?.spawnPlayer(this.character.position, c.healAmount, '#70ff9b', 'heal');
    this.ctx.flash.trigger(HEAL_B, 0.2, 0.006);
    this.ctx.shake.add(0.12, 3.4, 12);
    this._emitHeal(120);
    return { id: 'heal', amount: c.healAmount };
  }

  _emitHeal(count) {
    this.position.copy(this.character.position).addScaledVector(UP, 0.35);
    this.healParticles.emit(count, {
      position: this.position,
      radius: 1.35,
      direction: UP,
      speed: 2.8,
      speedVariance: 0.55,
      spread: 0.45,
      size: 0.18,
      sizeVariance: 0.75,
      life: 1.35,
      lifeVariance: 0.45,
      spin: 2.4,
      tint: getColor('#b8ffd0'),
      time: frame.uTime.value
    });
  }

  update(dt) {
    if (this.healRemaining <= 0 || dt <= 0) return;
    this.healRemaining = Math.max(0, this.healRemaining - dt);
    this.healAccumulator += dt * 150;
    const count = Math.floor(this.healAccumulator);
    this.healAccumulator -= count;
    this._emitHeal(Math.min(18, count));
  }

  clear() {
    this.healRemaining = 0;
    this.healAccumulator = 0;
  }

  dispose() {
    this.clear();
    this.hitScratch.length = 0;
  }
}
