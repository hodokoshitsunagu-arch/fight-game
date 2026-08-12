import {
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3
} from 'three';
import { Ability } from './Ability.js';
import { frame } from '../core/FrameUniforms.js';
import { LAYER } from '../core/Layers.js';
import { ParticleShape } from '../particles/ParticleSystem.js';
import { RateEmitter } from '../particles/ParticleEngine.js';
import { BurstMode } from '../effects/BurstSphere.js';
import { DecalType } from '../effects/GroundDecals.js';
import { createDistortionMaterial } from '../materials/DistortionMaterial.js';
import { createShowcaseMaterial, ShowcaseMode } from '../materials/ShowcaseMaterial.js';
import { getColor } from '../utils/color.js';
import { qualityCount } from '../core/Quality.js';
import { saturate } from '../utils/math.js';

const MAX_ORBITS = 72;
const DUMMY = new Object3D();
const POS = new Vector3();
const CENTRE = new Vector3();
const DIR = new Vector3();
const EMIT = {};

export class SingularityAbility extends Ability {
  constructor(context) {
    super('singularity', context);
    this.records = Array.from({ length: MAX_ORBITS }, () => ({ angle: 0, radius: 0, height: 0, speed: 0, tilt: 0, size: 0 }));
    this.orbitCount = 0;
    this._exploded = false;
  }

  createShaders() {
    this.coreMaterial = createShowcaseMaterial(ShowcaseMode.DARK_CORE, { additive: false, depthWrite: true });
    this.core = new Mesh(new SphereGeometry(1, 32, 20), this.coreMaterial);
    this.core.layers.set(LAYER.VFX);
    this.core.renderOrder = 9;

    this.diskMaterial = createShowcaseMaterial(ShowcaseMode.DISK);
    this.diskA = new Mesh(new RingGeometry(0.12, 1, 96, 2), this.diskMaterial);
    this.diskB = new Mesh(new RingGeometry(0.22, 1, 96, 2), createShowcaseMaterial(ShowcaseMode.DISK));
    for (const disk of [this.diskA, this.diskB]) {
      disk.layers.set(LAYER.VFX);
      disk.renderOrder = 12;
    }

    this.ringMaterial = createShowcaseMaterial(ShowcaseMode.GROUND);
    this.ground = new Mesh(new RingGeometry(0.08, 1, 96, 8).rotateX(-Math.PI / 2), this.ringMaterial);
    this.ground.layers.set(LAYER.VFX);
    this.ground.renderOrder = 7;

    this.orbitGeometry = new OctahedronGeometry(1, 0);
    this.orbitMaterial = new MeshBasicMaterial({ color: 0xa66cff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.orbits = new InstancedMesh(this.orbitGeometry, this.orbitMaterial, MAX_ORBITS);
    this.orbits.layers.set(LAYER.VFX);
    this.orbits.frustumCulled = false;

    this.projectile = new Mesh(new SphereGeometry(1, 14, 10), createShowcaseMaterial(ShowcaseMode.DISK));
    this.projectile.layers.set(LAYER.VFX);
    this.projectile.renderOrder = 15;

    this.distortionMaterial = createDistortionMaterial('radial');
    this.distortion = new Mesh(new SphereGeometry(1, 24, 16), this.distortionMaterial);
    this.distortion.layers.set(LAYER.DISTORTION);

    this.group.add(this.ground, this.core, this.diskA, this.diskB, this.orbits, this.projectile, this.distortion);
  }

  createParticles() {
    this.motes = this.ctx.particles.get('singularity-motes', {
      capacity: 2600,
      shape: ParticleShape.STREAK,
      additive: true,
      stretch: true,
      swirl: true,
      attract: true
    });
    this.smoke = this.ctx.particles.get('singularity-smoke', {
      capacity: 1200,
      shape: ParticleShape.SMOKE,
      additive: false,
      swirl: true,
      attract: true,
      curl: true
    });
    this.moteEmitter = new RateEmitter();
    this.smokeEmitter = new RateEmitter();
  }

  get impactDuration() {
    return this.config.holdTime + this.config.collapseTime;
  }

  get fadeDuration() {
    return this.config.fadeTime;
  }

  get instanceCount() {
    return this.orbitCount;
  }

  onSpawn() {
    this.moteEmitter.reset();
    this.smokeEmitter.reset();
    this._exploded = false;
    for (let i = 0; i < MAX_ORBITS; i++) {
      const r = this.records[i];
      r.angle = Math.random() * Math.PI * 2;
      r.radius = 0.25 + Math.pow(Math.random(), 0.62) * 0.75;
      r.height = (Math.random() - 0.5) * 0.5;
      r.speed = 0.65 + Math.random() * 1.5;
      r.tilt = (Math.random() - 0.5) * 0.8;
      r.size = 0.45 + Math.random();
    }
    this.projectile.visible = true;
    this.core.visible = false;
    this.diskA.visible = false;
    this.diskB.visible = false;
    this.ground.visible = false;
    this.distortion.visible = false;
    this._syncTravel();
  }

  _centre(out = POS) {
    return this.pointAt(1, out).setY(this.config.coreHeight);
  }

  _syncTravel() {
    const c = this.config;
    this.position.y = 0.35 + Math.sin(this.u * Math.PI) * 1.15;
    this.projectile.position.copy(this.position);
    const size = c.coreRadius * (0.45 + this.u * 0.3);
    this.projectile.scale.setScalar(size);
    const u = this.projectile.material.uniforms;
    u.uAge.value = this.age;
    u.uOpacity.value = 1;
    u.uIntensity.value = 1.2;
    u.uParam0.value = 10;
    u.uParam1.value = c.diskSpeed;
    u.uColorA.value.copy(getColor(c.colorDiskA));
    u.uColorB.value.copy(getColor(c.colorDiskB));
    u.uColorC.value.copy(getColor(c.colorDiskC));
  }

  _syncField(t, fade) {
    const c = this.config;
    this.orbitCount = Math.min(MAX_ORBITS, qualityCount(c.orbitCount, 'instances', 12));
    this.orbits.count = this.orbitCount;
    const centre = this._centre(CENTRE);
    const collapseStart = c.holdTime / Math.max(0.01, c.holdTime + c.collapseTime);
    const collapse = t <= collapseStart ? 0 : saturate((t - collapseStart) / Math.max(0.001, 1 - collapseStart));
    const open = Math.sin(Math.min(1, this.impactTime / 0.42) * Math.PI * 0.5);
    const scale = open * (1 - collapse * 0.92) * fade;

    this.position.copy(centre);
    this.core.position.copy(centre);
    this.core.scale.setScalar(Math.max(0.001, c.coreRadius * scale));
    this.core.visible = scale > 0.005;
    const cu = this.coreMaterial.uniforms;
    cu.uAge.value = this.age;
    cu.uOpacity.value = fade;
    cu.uIntensity.value = 1;
    cu.uColorA.value.copy(getColor(c.colorDiskA));
    cu.uColorB.value.copy(getColor(c.colorDiskC));
    cu.uColorC.value.copy(getColor(c.colorCore));

    for (const [index, disk] of [this.diskA, this.diskB].entries()) {
      disk.visible = scale > 0.005;
      disk.position.copy(centre);
      disk.rotation.set(Math.PI / 2 + (index ? -c.diskTilt : c.diskTilt), this.age * (index ? -0.17 : 0.12), index ? -0.28 : 0.1);
      disk.scale.setScalar(c.diskRadius * scale * (index ? 0.78 : 1));
      const u = disk.material.uniforms;
      u.uAge.value = this.age;
      u.uOpacity.value = fade * (index ? 0.65 : 0.95);
      u.uIntensity.value = 1.25;
      u.uParam0.value = index ? 7 : 11;
      u.uParam1.value = c.diskSpeed * (index ? -0.75 : 1);
      u.uParam2.value = c.diskWidth * (index ? 0.72 : 1);
      u.uColorA.value.copy(getColor(c.colorDiskA));
      u.uColorB.value.copy(getColor(c.colorDiskB));
      u.uColorC.value.copy(getColor(c.colorDiskC));
    }

    this.ground.visible = scale > 0.005;
    this.ground.position.set(centre.x, 0.025, centre.z);
    this.ground.scale.setScalar(c.zoneRadius * scale);
    const gu = this.ringMaterial.uniforms;
    gu.uAge.value = this.age;
    gu.uOpacity.value = fade * 0.75;
    gu.uIntensity.value = 1;
    gu.uParam0.value = 14;
    gu.uParam1.value = -c.diskSpeed * 0.25;
    gu.uColorA.value.copy(getColor(c.colorDiskA));
    gu.uColorB.value.copy(getColor(c.colorDiskB));
    gu.uColorC.value.copy(getColor(c.colorCore));

    this.distortion.visible = scale > 0.005;
    this.distortion.position.copy(centre);
    this.distortion.scale.setScalar(c.diskRadius * 0.82 * scale);
    const du = this.distortionMaterial.uniforms;
    du.uAge.value = this.age;
    du.uStrength.value = c.distortion * (1 + collapse * 1.8);
    du.uOpacity.value = fade;

    this.orbitMaterial.color.copy(getColor(c.colorDiskB));
    this.orbitMaterial.opacity = fade * 0.86;
    for (let i = 0; i < this.orbitCount; i++) {
      const r = this.records[i];
      const a = r.angle + this.age * c.orbitSpeed * r.speed;
      const radius = c.diskRadius * r.radius * (1 - collapse * 0.86);
      DUMMY.position.set(
        centre.x + Math.cos(a) * radius,
        centre.y + Math.sin(a * 1.7 + r.tilt) * radius * 0.16 + r.height,
        centre.z + Math.sin(a) * radius
      );
      DUMMY.rotation.set(a * 1.4, a * 0.7, a * 2.1);
      const size = c.debrisSize * r.size * scale;
      DUMMY.scale.set(size, size * 0.55, size * 1.7);
      DUMMY.updateMatrix();
      this.orbits.setMatrixAt(i, DUMMY.matrix);
    }
    this.orbits.instanceMatrix.needsUpdate = true;

    if (collapse > 0.78 && !this._exploded) {
      this._exploded = true;
      this._explode(centre);
    }
  }

  _particles(dt, scale) {
    const c = this.config;
    const centre = this._centre(CENTRE);
    const time = frame.uTime.value;
    const motes = this.moteEmitter.tick(dt, c.moteRate * scale);
    if (motes > 0) {
      const a = Math.random() * Math.PI * 2;
      const radius = c.diskRadius * (0.7 + Math.random() * 0.6);
      EMIT.position = POS.set(centre.x + Math.cos(a) * radius, centre.y + (Math.random() - 0.5) * 1.8, centre.z + Math.sin(a) * radius);
      EMIT.anchor = centre;
      EMIT.direction = DIR.set(-Math.sin(a), 0.05, Math.cos(a));
      EMIT.speed = c.moteSpeed;
      EMIT.speedVariance = 0.7;
      EMIT.spread = 0.3;
      EMIT.radius = 0.25;
      EMIT.size = c.moteSize;
      EMIT.sizeVariance = 0.6;
      EMIT.life = c.moteLifetime;
      EMIT.lifeVariance = 0.35;
      EMIT.spin = 0;
      EMIT.time = time;
      this.motes.emit(motes, EMIT);
    }
    const smoke = this.smokeEmitter.tick(dt, c.smokeRate * scale);
    if (smoke > 0) {
      const a = Math.random() * Math.PI * 2;
      const radius = c.zoneRadius * (0.75 + Math.random() * 0.4);
      EMIT.position = POS.set(centre.x + Math.cos(a) * radius, 0.12, centre.z + Math.sin(a) * radius);
      EMIT.anchor = centre;
      EMIT.direction = DIR.set(-Math.sin(a), 0.22, Math.cos(a));
      EMIT.speed = 0.7;
      EMIT.speedVariance = 0.7;
      EMIT.spread = 0.45;
      EMIT.radius = 0.3;
      EMIT.size = c.smokeSize;
      EMIT.sizeVariance = 0.55;
      EMIT.life = c.smokeLifetime;
      EMIT.lifeVariance = 0.4;
      EMIT.spin = 0.4;
      EMIT.time = time;
      this.smoke.emit(smoke, EMIT);
    }
    this.motes.setGradient(getColor(c.colorDiskA), getColor(c.colorDiskB), getColor(c.colorMote), getColor(c.colorCore));
    this.motes.uniforms.uSwirl.value = c.orbitSpeed;
    this.motes.uniforms.uAttraction.value = 5.5;
    this.motes.uniforms.uGlow.value = 1.45;
    this.smoke.setGradient(getColor(c.colorDiskC), getColor(c.colorDiskB), getColor(c.colorCore), getColor(c.colorCore));
    this.smoke.uniforms.uSwirl.value = c.orbitSpeed * 0.6;
    this.smoke.uniforms.uAttraction.value = 2.2;
    this.smoke.uniforms.uOpacity.value = 0.24 * scale;
  }

  _explode(centre) {
    const c = this.config;
    this.ctx.bursts.spawn(BurstMode.STORM, centre, {
      radius: 0.25,
      endRadius: c.zoneRadius * 1.35,
      life: 0.72,
      intensity: 1.8,
      opacity: 0.78,
      colorA: getColor(c.colorDiskA),
      colorB: getColor(c.colorDiskB),
      colorC: getColor(c.colorDiskC),
      squash: 0.48
    });
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, centre, {
      radius: c.zoneRadius * 1.25,
      life: 0.85,
      intensity: 1.6,
      colorA: getColor(c.colorDiskA),
      colorB: getColor(c.colorDiskB),
      growth: 0.35
    });
    this.ctx.shake.add(c.impactShake, 1.5, 15);
    this.ctx.flash.trigger(getColor(c.colorDiskA), c.impactFlash, 0.0005);
    this.lightBoost = 14;
  }

  onTravel(dt) {
    this._syncTravel();
    this._particles(dt, 0.25);
  }

  onImpact() {
    this.projectile.visible = false;
    this._centre(this.position);
    this.ctx.shake.add(0.22, 3.5, 30);
  }

  onFade(dt, t) {
    const fade = t <= 1 ? 1 : Math.max(0, 2 - t);
    this._syncField(t <= 1 ? t : 1, fade);
    this._particles(dt, fade * (this._exploded ? 1.7 : 1));
    if (!this._exploded) this.ctx.shake.rumble(0.035 * fade, dt);
  }

  onDestroy() {
    for (const mesh of [this.projectile, this.core, this.diskA, this.diskB, this.ground, this.distortion]) mesh.visible = false;
    this.orbits.count = 0;
  }

  dispose() {
    super.dispose();
    this.core.geometry.dispose();
    this.coreMaterial.dispose();
    this.diskA.geometry.dispose();
    this.diskMaterial.dispose();
    this.diskB.geometry.dispose();
    this.diskB.material.dispose();
    this.ground.geometry.dispose();
    this.ringMaterial.dispose();
    this.orbitGeometry.dispose();
    this.orbitMaterial.dispose();
    this.projectile.geometry.dispose();
    this.projectile.material.dispose();
    this.distortion.geometry.dispose();
    this.distortionMaterial.dispose();
  }
}
