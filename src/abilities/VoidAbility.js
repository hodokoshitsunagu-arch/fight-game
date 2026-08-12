import {
  AdditiveBlending,
  Color,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  TetrahedronGeometry,
  Vector3
} from 'three';
import { Ability, AbilityPhase } from './Ability.js';
import { settings } from '../config/settings.js';
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
import { headingOf } from './ShowcaseUtils.js';

const MAX_SHARDS = 48;
const DUMMY = new Object3D();
const POS = new Vector3();
const DIR = new Vector3();
const EMIT = {};

export class VoidAbility extends Ability {
  constructor(context) {
    super('void', context);
    this.records = Array.from({ length: MAX_SHARDS }, () => ({ along: 0, side: 0, height: 0, spin: 0 }));
    this.shardCount = 0;
  }

  createShaders() {
    this.riftMaterial = createShowcaseMaterial(ShowcaseMode.RIFT);
    this.rift = new Mesh(new PlaneGeometry(1, 1, 56, 12), this.riftMaterial);
    this.rift.layers.set(LAYER.VFX);
    this.rift.renderOrder = 11;

    this.groundMaterial = createShowcaseMaterial(ShowcaseMode.GROUND);
    this.ground = new Mesh(new PlaneGeometry(1, 1, 32, 2).rotateX(-Math.PI / 2), this.groundMaterial);
    this.ground.layers.set(LAYER.VFX);
    this.ground.renderOrder = 7;

    this.blade = new Mesh(
      new OctahedronGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xc78cff, transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    this.blade.layers.set(LAYER.VFX);
    this.blade.renderOrder = 15;

    this.shardGeometry = new TetrahedronGeometry(1, 0);
    this.shardMaterial = new MeshBasicMaterial({ color: 0xcdb1ff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.shards = new InstancedMesh(this.shardGeometry, this.shardMaterial, MAX_SHARDS);
    this.shards.layers.set(LAYER.VFX);
    this.shards.frustumCulled = false;

    this.distortionMaterial = createDistortionMaterial('rift');
    this.distortion = new Mesh(new PlaneGeometry(1, 1, 24, 8), this.distortionMaterial);
    this.distortion.layers.set(LAYER.DISTORTION);

    this.group.add(this.ground, this.rift, this.blade, this.shards, this.distortion);
  }

  createParticles() {
    this.motes = this.ctx.particles.get('void-attraction', {
      capacity: 1800,
      shape: ParticleShape.STREAK,
      additive: true,
      stretch: true,
      attract: true
    });
    this.mist = this.ctx.particles.get('void-mist', {
      capacity: 900,
      shape: ParticleShape.SMOKE,
      additive: false,
      curl: true
    });
    this.moteEmitter = new RateEmitter();
    this.mistEmitter = new RateEmitter();
  }

  get impactDuration() {
    return this.config.openTime + this.config.holdTime;
  }

  get fadeDuration() {
    return this.config.fadeTime;
  }

  get instanceCount() {
    return this.shardCount;
  }

  onSpawn() {
    this.moteEmitter.reset();
    this.mistEmitter.reset();
    this._seed = Math.random() * 20;
    for (let i = 0; i < MAX_SHARDS; i++) {
      const r = this.records[i];
      r.along = Math.random();
      r.side = (Math.random() - 0.5) * 2;
      r.height = Math.random();
      r.spin = Math.random() * Math.PI * 2;
    }
    this.rift.visible = true;
    this.ground.visible = true;
    this.blade.visible = true;
    this.distortion.visible = true;
    this._sync(0, 1);
  }

  _placeStrip(mesh, length, height = 0) {
    mesh.position.copy(this.origin).addScaledVector(this.direction, length * 0.5);
    mesh.position.y = height * 0.5 + 0.025;
    mesh.rotation.set(0, headingOf(this.direction) - Math.PI / 2, 0);
  }

  _sync(open, fade) {
    const c = this.config;
    this.shardCount = Math.min(MAX_SHARDS, qualityCount(c.shardCount, 'instances', 8));
    this.shards.count = this.shardCount;
    const grown = Math.max(0.001, this.phase === AbilityPhase.TRAVEL ? this.u : 1);
    const length = this.length * grown;
    const height = c.height * open;

    this._placeStrip(this.rift, length, height);
    this.rift.scale.set(length, Math.max(0.001, height), 1);
    this._placeStrip(this.distortion, length, height);
    this.distortion.scale.set(length, Math.max(0.001, height * 1.15), 1);

    this.ground.position.copy(this.origin).addScaledVector(this.direction, length * 0.5);
    this.ground.position.y = 0.018;
    this.ground.rotation.set(0, headingOf(this.direction) + Math.PI, 0);
    this.ground.scale.set(c.width * 8, length, 1);

    const u = this.riftMaterial.uniforms;
    u.uAge.value = this.age;
    u.uProgress.value = open;
    u.uOpacity.value = fade;
    u.uIntensity.value = settings.global.shaderIntensity;
    u.uParam0.value = c.noiseScale;
    u.uParam1.value = c.waviness;
    u.uColorA.value.copy(getColor(c.colorEdge));
    u.uColorB.value.copy(getColor(c.colorInner));
    u.uColorC.value.copy(getColor(c.colorCore));

    const gu = this.groundMaterial.uniforms;
    gu.uAge.value = this.age;
    gu.uOpacity.value = fade * 0.8;
    gu.uParam0.value = 9;
    gu.uParam1.value = c.flowSpeed;
    gu.uColorA.value.copy(getColor(c.colorEdge));
    gu.uColorB.value.copy(getColor(c.colorInner));
    gu.uColorC.value.copy(getColor(c.colorCore));

    const du = this.distortionMaterial.uniforms;
    du.uAge.value = this.age;
    du.uStrength.value = c.distortion;
    du.uOpacity.value = fade * open;
    du.uFrequency.value = c.noiseScale * 4;

    this.blade.position.copy(this.position).setY(c.height * 0.42);
    this.blade.scale.set(c.width * 4.2, c.height * 0.22, c.width * 1.3);
    this.blade.rotation.set(this.age * 5, headingOf(this.direction), this.age * 9);
    this.blade.material.color.copy(getColor(c.colorEdge));
    this.blade.material.opacity = fade;
    this.shardMaterial.color.copy(getColor(c.colorShard));
    this.shardMaterial.opacity = fade * 0.82;

    for (let i = 0; i < this.shardCount; i++) {
      const r = this.records[i];
      const pull = 1 - open * 0.78;
      POS.copy(this.origin)
        .addScaledVector(this.direction, r.along * this.length)
        .addScaledVector(this.side, r.side * c.edgeWidth * 4 * pull);
      POS.y = 0.18 + r.height * c.height * open;
      const size = c.shardSize * (0.45 + r.height) * fade;
      DUMMY.position.copy(POS);
      DUMMY.rotation.set(r.spin + this.age * c.shardSpin, r.spin * 1.7, this.age * c.shardSpin * 0.7);
      DUMMY.scale.set(size * 0.35, size * 1.8, size * 0.7);
      DUMMY.updateMatrix();
      this.shards.setMatrixAt(i, DUMMY.matrix);
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }

  _particles(dt, scale) {
    const c = this.config;
    const time = frame.uTime.value;
    const centre = POS.copy(this.origin).addScaledVector(this.direction, this.length * 0.5).setY(c.height * 0.45);
    const motes = this.moteEmitter.tick(dt, c.moteRate * scale);
    if (motes > 0) {
      EMIT.position = DIR.copy(centre).addScaledVector(this.side, (Math.random() - 0.5) * c.height * 2);
      EMIT.position.y += (Math.random() - 0.5) * c.height;
      EMIT.anchor = centre;
      EMIT.direction = this.direction;
      EMIT.speed = c.moteSpeed;
      EMIT.speedVariance = 0.7;
      EMIT.spread = 1;
      EMIT.radius = this.length * 0.22;
      EMIT.size = c.moteSize;
      EMIT.sizeVariance = 0.6;
      EMIT.life = c.moteLifetime;
      EMIT.lifeVariance = 0.35;
      EMIT.spin = 0;
      EMIT.time = time;
      this.motes.emit(motes, EMIT);
    }
    const mist = this.mistEmitter.tick(dt, c.mistRate * scale);
    if (mist > 0) {
      EMIT.position = POS.copy(this.origin).addScaledVector(this.direction, Math.random() * this.length).setY(0.15);
      EMIT.anchor = null;
      EMIT.direction = DIR.set(0, 0.4, 0);
      EMIT.speed = 0.45;
      EMIT.speedVariance = 0.8;
      EMIT.spread = 0.9;
      EMIT.radius = c.edgeWidth;
      EMIT.size = c.mistSize;
      EMIT.sizeVariance = 0.5;
      EMIT.life = c.mistLifetime;
      EMIT.lifeVariance = 0.4;
      EMIT.spin = 0.3;
      EMIT.time = time;
      this.mist.emit(mist, EMIT);
    }
    this.motes.uniforms.uAttraction.value = 9;
    this.motes.uniforms.uOpacity.value = scale;
    this.motes.uniforms.uGlow.value = 1.4;
    this.motes.setGradient(getColor(c.colorEdge), getColor(c.colorInner), getColor(c.colorShard), getColor(c.colorCore));
    this.mist.setGradient(getColor(c.colorMist), getColor(c.colorInner), getColor(c.colorCore), new Color(0, 0, 0));
    this.mist.uniforms.uOpacity.value = 0.22 * scale;
  }

  onTravel(dt) {
    const open = Math.min(1, this.age / Math.max(0.05, this.config.openTime));
    this._sync(open, 1);
    this._particles(dt, 0.65);
  }

  onImpact() {
    const c = this.config;
    this.blade.visible = false;
    this.position.copy(this.origin).addScaledVector(this.direction, this.length * 0.5).setY(c.height * 0.45);
    this.ctx.bursts.spawn(BurstMode.AIR, this.position, {
      radius: 0.35,
      endRadius: 4.2,
      life: 0.48,
      intensity: 1.35,
      opacity: 0.58,
      colorA: getColor(c.colorEdge),
      colorB: getColor(c.colorInner),
      colorC: getColor(c.colorCore),
      squash: 0.35
    });
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, this.position, {
      radius: Math.min(4.5, this.length * 0.3),
      life: 0.75,
      intensity: 1.2,
      colorA: getColor(c.colorEdge),
      colorB: getColor(c.colorInner),
      growth: 0.35
    });
    this.ctx.shake.add(c.impactShake, 2.7, 28);
    this.ctx.flash.trigger(getColor(c.colorInner), c.impactFlash, 0.001);
    this.lightBoost = 8;
  }

  onFade(dt, t) {
    const c = this.config;
    const open = t <= 1 ? Math.min(1, this.impactTime / Math.max(0.05, c.openTime)) : Math.max(0, 2 - t);
    const fade = t <= 1 ? 1 : Math.max(0, 2 - t);
    this._sync(open, fade);
    this._particles(dt, fade);
    this.ctx.shake.rumble(0.025 * fade, dt);
  }

  onDestroy() {
    this.rift.visible = false;
    this.ground.visible = false;
    this.blade.visible = false;
    this.distortion.visible = false;
    this.shards.count = 0;
  }

  dispose() {
    super.dispose();
    this.rift.geometry.dispose();
    this.riftMaterial.dispose();
    this.ground.geometry.dispose();
    this.groundMaterial.dispose();
    this.blade.geometry.dispose();
    this.blade.material.dispose();
    this.shardGeometry.dispose();
    this.shardMaterial.dispose();
    this.distortion.geometry.dispose();
    this.distortionMaterial.dispose();
  }
}
