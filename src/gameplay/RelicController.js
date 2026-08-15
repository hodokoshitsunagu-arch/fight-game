import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  TorusGeometry,
  Vector3
} from 'three';
import { settings } from '../config/settings.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { BurstMode } from '../effects/BurstSphere.js';
import { ParticleShape } from '../particles/ParticleSystem.js';
import { RateEmitter } from '../particles/ParticleEngine.js';
import { frame } from '../core/FrameUniforms.js';

const CYAN = new Color('#4cecff');
const GOLD = new Color('#ffd46a');
const ORANGE = new Color('#ff7b38');
const RED = new Color('#ff244f');
const WHITE = new Color('#ffffff');

export class RelicController extends EventEmitter {
  constructor(scene, { bursts = null, shake = null, flash = null, particles = null } = {}) {
    super();
    this.scene = scene;
    this.bursts = bursts;
    this.shake = shake;
    this.flash = flash;
    this.particles = particles;
    this.root = new Group();
    this.root.name = 'RelicCore';
    this.position = this.root.position;
    this.position.set(0, 0, 0);
    this.maxHP = settings.relic.maxHP;
    this.currentHP = this.maxHP;
    this.isDestroyed = false;
    this.elapsed = 0;
    this.destroyElapsed = 0;
    this.warningMask = 0;
    this.leakEmitter = new RateEmitter();
    this.leakPosition = new Vector3();
    this.leakDirection = new Vector3(0, 1, 0);
    this.leakConfig = {
      position: this.leakPosition,
      radius: 0.75,
      direction: this.leakDirection,
      speed: 2.8,
      speedVariance: 0.8,
      spread: 1.2,
      size: 0.08,
      sizeVariance: 0.6,
      life: 0.72,
      lifeVariance: 0.4,
      tint: CYAN,
      time: 0
    };
    this.leakParticles = particles?.get('relic-energy-leak', {
      capacity: 700,
      shape: ParticleShape.STREAK,
      additive: true,
      stretch: true
    }) ?? null;
    if (this.leakParticles) {
      this.leakParticles.setGradient(WHITE, CYAN, ORANGE, RED);
      this.leakParticles.uniforms.uGravity.value.set(0, -1.2, 0);
      this.leakParticles.uniforms.uDrag.value = 1.5;
      this.leakParticles.uniforms.uGlow.value = 2.2;
      this.leakParticles.uniforms.uStretch.value = 0.7;
    }
    this._build();
    scene.add(this.root);
  }

  _build() {
    this.baseMaterial = new MeshStandardMaterial({
      color: '#111827', roughness: 0.68, metalness: 0.55,
      emissive: '#10243a', emissiveIntensity: 0.45
    });
    this.coreMaterial = new MeshStandardMaterial({
      color: '#baf8ff', emissive: CYAN, emissiveIntensity: 3.2,
      roughness: 0.18, metalness: 0.05
    });
    this.ringMaterial = new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.72 });

    this.base = new Mesh(new CylinderGeometry(1.8, 2.15, 0.65, 12), this.baseMaterial);
    this.base.position.y = 0.33;
    this.core = new Mesh(new OctahedronGeometry(0.82, 1), this.coreMaterial);
    this.core.position.y = 2;
    this.rings = [];
    for (let i = 0; i < 2; i++) {
      const ring = new Mesh(new TorusGeometry(1.25 + i * 0.35, 0.035, 6, 48), this.ringMaterial);
      ring.position.y = 1.95;
      ring.rotation.x = Math.PI * (0.5 + i * 0.28);
      this.rings.push(ring);
      this.root.add(ring);
    }
    this.root.add(this.base, this.core);
    this.root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
      }
    });
  }

  get healthPercent() {
    return this.maxHP > 0 ? this.currentHP / this.maxHP : 0;
  }

  damage(amount, source = null) {
    if (this.isDestroyed) return 0;
    const applied = Math.max(0, Math.min(this.currentHP, Number(amount) || 0));
    if (applied <= 0) return 0;
    const previous = this.healthPercent;
    this.currentHP -= applied;
    const percent = this.healthPercent;
    this.emit('relic:damage', { amount: applied, source, currentHP: this.currentHP, percent });
    if (!(this.warningMask & 1) && previous > settings.relic.damageWarningPercent && percent <= settings.relic.damageWarningPercent) {
      this.warningMask |= 1;
      this.emit('relic:warning', { level: 'damaged', percent });
    }
    if (!(this.warningMask & 2) && previous > settings.relic.criticalWarningPercent && percent <= settings.relic.criticalWarningPercent) {
      this.warningMask |= 2;
      this.emit('relic:warning', { level: 'critical', percent });
    }
    if (this.currentHP <= 0) this.destroy(source);
    return applied;
  }

  heal(amount) {
    if (this.isDestroyed) return 0;
    const applied = Math.max(0, Math.min(this.maxHP - this.currentHP, Number(amount) || 0));
    if (applied <= 0) return 0;
    this.currentHP += applied;
    this.emit('relic:heal', { amount: applied, currentHP: this.currentHP, percent: this.healthPercent });
    return applied;
  }

  destroy(source = null) {
    if (this.isDestroyed) return false;
    this.isDestroyed = true;
    this.currentHP = 0;
    this.destroyElapsed = 0;
    this.bursts?.spawn(BurstMode.STORM, this.core.getWorldPosition(this.position.clone()), {
      radius: 0.8, endRadius: 9, life: 1.2, intensity: 3.5,
      colorA: WHITE, colorB: RED, colorC: ORANGE
    });
    this.flash?.trigger(WHITE, 0.75, 0.035);
    this.shake?.add(0.65, 7.5, 24);
    this._emitLeak(180, RED);
    this.emit('relic:destroyed', { source });
    return true;
  }

  update(dt) {
    this.elapsed += dt;
    if (this.isDestroyed) this.destroyElapsed += dt;
    const hp = this.healthPercent;
    let color = CYAN;
    let speed = 2.2;
    let intensity = 3.2;
    if (hp < 0.2) { color = RED; speed = 10; intensity = 5.2; }
    else if (hp < 0.4) { color = ORANGE; speed = 6; intensity = 4.4; }
    else if (hp < 0.7) { color = GOLD; speed = 3.8; intensity = 3.8; }
    const pulse = 1 + Math.sin(this.elapsed * speed) * (hp < 0.2 ? 0.14 : 0.055);
    this.core.scale.setScalar(this.isDestroyed ? Math.max(0.01, 1 - this.destroyElapsed * 0.7) : pulse);
    this.core.rotation.y += dt * (hp < 0.2 ? 2.2 : 0.7);
    this.coreMaterial.emissive.copy(color);
    this.coreMaterial.emissiveIntensity = this.isDestroyed ? 0 : intensity * pulse;
    this.ringMaterial.color.copy(color);
    this.ringMaterial.opacity = this.isDestroyed ? 0 : 0.48 + 0.26 * Math.abs(Math.sin(this.elapsed * speed));
    this.rings[0].rotation.z += dt * 0.65;
    this.rings[1].rotation.y -= dt * 0.52;
    if (!this.isDestroyed && hp < 0.7) {
      const rate = hp < 0.2 ? 52 : hp < 0.4 ? 22 : 8;
      this._emitLeak(this.leakEmitter.tick(dt, rate), color);
    }
  }

  _emitLeak(count, tint) {
    if (!this.leakParticles || count <= 0) return;
    this.leakPosition.copy(this.position).setY(1.9);
    this.leakConfig.tint = tint;
    this.leakConfig.time = frame.uTime.value;
    this.leakParticles.emit(count, this.leakConfig);
  }

  reset() {
    this.maxHP = settings.relic.maxHP;
    this.currentHP = this.maxHP;
    this.isDestroyed = false;
    this.elapsed = 0;
    this.destroyElapsed = 0;
    this.warningMask = 0;
    this.leakEmitter.reset();
    this.root.visible = true;
    this.core.scale.setScalar(1);
    this.emit('relic:reset', { currentHP: this.currentHP });
  }

  dispose() {
    this.root.traverse((node) => node.geometry?.dispose?.());
    this.baseMaterial.dispose();
    this.coreMaterial.dispose();
    this.ringMaterial.dispose();
    this.root.parent?.remove(this.root);
    this.clear();
  }
}
