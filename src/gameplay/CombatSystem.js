import { Color, Vector3 } from 'three';
import { settings, ELEMENT_META, SELF_ABILITY_META } from '../config/settings.js';
import { ParticleShape } from '../particles/ParticleSystem.js';
import { DecalType } from '../effects/GroundDecals.js';
import { ABILITY_PROFILES } from './abilityProfiles.js';

const _end = new Vector3();
const _direction = new Vector3();
const _position = new Vector3();
const _up = new Vector3(0, 1, 0);
const _status = { type: '', duration: 0, stagger: 0 };
const BURN_A = new Color('#ffdd78');
const BURN_B = new Color('#ff4e18');
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
    this.decals = options.decals ?? null;
    this.elapsed = 0;
    this.nextCastId = 1;
    this.hitScratch = [];
    this.hitStopCooldown = 0;
    this.upgrades = null;
    this.burningZones = [];
    this.chainScratch = [];
    this.deathScratch = [];
    this.zoneScratch = [];
    this.queryCost = 0;
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
    this._offDeath = enemies.on('enemy:death', (event) => this._onEnemyDeath(event));
  }

  setUpgradeManager(upgrades) {
    this.upgrades = upgrades;
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
    const queryStart = performance.now();
    const state = ability.gameplay;
    if (!state) return;
    const sphere = profile.mode.endsWith('sphere');
    ability.pointAt(1, _end).setY(0);
    let hits;
    const radiusMultiplier = this.upgrades?.radiusMultiplier ?? 1;
    if (sphere) {
      const radius = this._configValue(ability, profile, 'radius', 'radiusKey', 1)
        * (profile.radius !== undefined ? radiusMultiplier : 1);
      hits = this.enemies.querySphere(_end, radius, this.hitScratch);
    } else {
      const startRadius = this._configValue(ability, profile, 'startRadius', 'startRadiusKey', 0.5)
        * (profile.startRadius !== undefined ? radiusMultiplier : 1);
      const endRadius = this._configValue(ability, profile, 'endRadius', 'endRadiusKey', startRadius)
        * (profile.endRadius !== undefined ? radiusMultiplier : 1);
      hits = this.enemies.queryLine(ability.origin, _end, startRadius, endRadius, this.hitScratch);
    }

    const damageMultiplier = this.upgrades?.damageMultiplier ?? 1;
    const statusMultiplier = this.upgrades?.statusMultiplier ?? 1;
    if (profile.status) {
      _status.type = profile.status.type ?? '';
      _status.duration = (profile.status.duration ?? 0) * statusMultiplier;
      _status.stagger = profile.status.stagger ?? 0;
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
        amount: profile.damage * damageMultiplier,
        castId: state.castId,
        tick,
        element: ability.element,
        position: _end,
        direction: _direction,
        force: profile.force ?? 0,
        damageType: profile.damageType,
        status: profile.status ? _status : null,
        deathMode: profile.deathMode
      });
    }

    if (ability.element === 'thunder' && this.upgrades?.has('thunder-chain')) {
      this._applyThunderChain(hits, state, profile, damageMultiplier);
    }

    if (ability.element === 'meteor' && tick === 0 && this.upgrades?.has('burning-ground')) {
      this.burningZones.push({ position: _end.clone(), age: 0, tick: -1 });
      if (this.burningZones.length > 6) this.burningZones.shift();
      this.decals?.spawn(DecalType.SCORCH, _end, {
        radius: settings.upgrades.burningRadius,
        life: settings.upgrades.burningDuration,
        intensity: 1.8,
        colorA: BURN_A,
        colorB: BURN_B
      });
    }
    const cost = performance.now() - queryStart;
    this.queryCost += (cost - this.queryCost) * 0.16;

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

  _applyThunderChain(primaryHits, state, profile, damageMultiplier) {
    let chained = 0;
    const max = settings.upgrades.thunderChainCount;
    for (const source of primaryHits) {
      if (chained >= max) break;
      const candidates = this.enemies.querySphere(source.position, settings.upgrades.thunderChainRange, this.chainScratch);
      for (const enemy of candidates) {
        if (chained >= max) break;
        if (enemy === source || primaryHits.includes(enemy)) continue;
        _direction.subVectors(enemy.position, source.position).setY(0);
        if (_direction.lengthSq() < 1e-6) _direction.set(1, 0, 0);
        else _direction.normalize();
        enemy.applyDamage({
          amount: profile.damage * settings.upgrades.thunderChainDamage * damageMultiplier,
          castId: state.castId,
          tick: 100 + chained,
          element: 'thunder',
          direction: _direction,
          force: profile.force ?? 0,
          damageType: 'shock',
          status: profile.status
        });
        chained++;
      }
    }
  }

  _onEnemyDeath({ enemy, hit, statusType }) {
    this.enemies.countDeath();
    if (!this.upgrades?.has('ice-shatter') || statusType !== 'ice' || hit?.fromShatter) return;
    const victims = this.enemies.querySphere(enemy.position, settings.upgrades.shatterRadius, this.deathScratch);
    for (const victim of victims) {
      if (victim === enemy) continue;
      _direction.subVectors(victim.position, enemy.position).setY(0);
      if (_direction.lengthSq() < 1e-6) _direction.set(1, 0, 0);
      else _direction.normalize();
      victim.applyDamage({
        amount: settings.upgrades.shatterDamage * (this.upgrades.damageMultiplier ?? 1),
        element: 'ice',
        direction: _direction,
        force: 2.5,
        damageType: 'ice',
        fromShatter: true,
        canProvoke: false
      });
    }
  }

  update(dt) {
    this.elapsed += dt;
    this.hitStopCooldown = Math.max(0, this.hitStopCooldown - dt);
    for (let i = this.burningZones.length - 1; i >= 0; i--) {
      const zone = this.burningZones[i];
      zone.age += dt;
      if (zone.age >= settings.upgrades.burningDuration) {
        this.burningZones.splice(i, 1);
        continue;
      }
      const tick = Math.floor(zone.age / settings.upgrades.burningInterval);
      if (tick === zone.tick) continue;
      zone.tick = tick;
      const victims = this.enemies.querySphere(zone.position, settings.upgrades.burningRadius, this.zoneScratch);
      for (const enemy of victims) {
        _direction.subVectors(enemy.position, zone.position).setY(0);
        if (_direction.lengthSq() < 1e-6) _direction.set(1, 0, 0);
        else _direction.normalize();
        enemy.applyDamage({
          amount: settings.upgrades.burningDamage * (this.upgrades?.damageMultiplier ?? 1),
          element: 'meteor', direction: _direction, force: 0.25,
          damageType: 'fire', canProvoke: false
        });
      }
    }
  }

  reset() {
    this.burningZones.length = 0;
    this.hitScratch.length = 0;
    this.chainScratch.length = 0;
    this.deathScratch.length = 0;
    this.zoneScratch.length = 0;
    this.nextCastId = 1;
    this.queryCost = 0;
  }

  dispose() {
    this.reset();
    this._offHit?.();
    this._offDeath?.();
  }
}
