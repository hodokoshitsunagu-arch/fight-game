import { Color, Vector3 } from 'three';
import { settings, ELEMENT_META, SELF_ABILITY_META } from '../config/settings.js';
import { ParticleShape } from '../particles/ParticleSystem.js';
import { ABILITY_PROFILES } from './abilityProfiles.js';

const _end = new Vector3();
const _direction = new Vector3();
const _position = new Vector3();
const _up = new Vector3(0, 1, 0);
const _emit = {
  position: _position,
  direction: _up,
  radius: 0.16,
  speed: 2.8,
  speedVariance: 0.65,
  spread: 1,
  size: 0.08,
  sizeVariance: 0.5,
  life: 0.42,
  lifeVariance: 0.35,
  spin: 5,
  tint: new Color(),
  time: 0
};

export class CombatSystem {
  constructor(enemies, particles, options = {}) {
    this.enemies = enemies;
    this.particles = particles;
    this.damageNumbers = options.damageNumbers ?? null;
    this.requestHitStop = options.requestHitStop ?? null;
    this.elapsed = 0;
    this.nextCastId = 1;
    this.hitScratch = [];
    this.hitStopCooldown = 0;
    this.impactParticles = particles.get('enemy.hit', {
      capacity: 1800,
      shape: ParticleShape.CHIP,
      additive: true,
      stretch: true,
      softFade: 0.3
    });
    this.impactParticles.uniforms.uGravity.value.set(0, -3, 0);
    this.impactParticles.uniforms.uDrag.value = 1.3;

    this._offHit = enemies.on('enemy:hit', (event) => this._onEnemyHit(event));
    this._offDeath = enemies.on('enemy:death', () => enemies.countDeath());
  }

  beginCast(ability) {
    ability.gameplay = {
      castId: this.nextCastId++,
      tick: -1,
      impacted: false,
      startedAt: this.elapsed
    };
  }

  updateAbility(ability) {
    const profile = ABILITY_PROFILES[ability.element];
    const state = ability.gameplay;
    if (!profile || !state || !profile.mode.startsWith('tick-') || !state.impacted) return;
    const age = Math.max(0, this.elapsed - (state.impactAt ?? state.startedAt));
    const tick = Math.floor(age / profile.interval);
    if (tick === state.tick || age > profile.duration) return;
    state.tick = tick;
    this._apply(ability, profile, tick);
  }

  onAbilityImpact(ability) {
    const profile = ABILITY_PROFILES[ability.element];
    const state = ability.gameplay;
    if (!profile || !state || state.impacted) return;
    state.impacted = true;
    state.impactAt = this.elapsed;
    state.tick = -1;
    if (profile.mode.startsWith('impact-')) this._apply(ability, profile, 0);
  }

  endCast(ability) {
    ability.gameplay = null;
  }

  _configValue(ability, profile, directKey, indirectKey, fallback = 0) {
    if (profile[directKey] !== undefined) return profile[directKey];
    const key = profile[indirectKey];
    return key ? (settings[ability.element]?.[key] ?? fallback) : fallback;
  }

  _apply(ability, profile, tick) {
    const state = ability.gameplay;
    if (!state) return;
    const sphere = profile.mode.endsWith('sphere');
    ability.pointAt(1, _end).setY(0);
    let hits;
    if (sphere) {
      const radius = this._configValue(ability, profile, 'radius', 'radiusKey', 1);
      hits = this.enemies.querySphere(_end, radius, this.hitScratch);
    } else {
      const startRadius = this._configValue(ability, profile, 'startRadius', 'startRadiusKey', 0.5);
      const endRadius = this._configValue(ability, profile, 'endRadius', 'endRadiusKey', startRadius);
      hits = this.enemies.queryLine(ability.origin, _end, startRadius, endRadius, this.hitScratch);
    }

    for (const enemy of hits) {
      if (profile.radial) {
        _direction.subVectors(enemy.position, _end).setY(0);
        if (_direction.lengthSq() < 1e-6) _direction.copy(ability.direction);
        else _direction.normalize();
      } else {
        _direction.copy(ability.direction).setY(0).normalize();
      }
      enemy.applyDamage({
        amount: profile.damage,
        castId: state.castId,
        tick,
        element: ability.element,
        position: _end,
        direction: _direction,
        force: profile.force ?? 0,
        damageType: profile.damageType,
        status: profile.status,
        deathMode: profile.deathMode
      });
    }

    if (profile.hitStop && hits.length >= 8 && this.hitStopCooldown <= 0) {
      this.hitStopCooldown = 0.25;
      this.requestHitStop?.(0.045);
    }
  }

  _onEnemyHit({ enemy, amount, hit, killed }) {
    const accent = ELEMENT_META[hit.element]?.accent ?? SELF_ABILITY_META[hit.element]?.accent ?? '#ffffff';
    this.damageNumbers?.spawn(enemy, amount, accent, killed);

    _position.copy(enemy.position).addScaledVector(_up, 1.1);
    _emit.time = this.elapsed;
    _emit.tint.set(accent);
    this.impactParticles.emit(killed ? 10 : 5, _emit);
  }

  update(dt) {
    this.elapsed += dt;
    this.hitStopCooldown = Math.max(0, this.hitStopCooldown - dt);
  }

  dispose() {
    this._offHit?.();
    this._offDeath?.();
  }
}
