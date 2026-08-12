import {
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
  Vector3
} from 'three';
import { Ability } from './Ability.js';
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
import { saturate } from '../utils/math.js';
import { headingOf } from './ShowcaseUtils.js';

const POS = new Vector3();
const DIR = new Vector3();
const UP = new Vector3(0, 1, 0);
const EMIT = {};

export class PhoenixAbility extends Ability {
  constructor(context) {
    super('phoenix', context);
    this._released = false;
  }

  createShaders() {
    this.birdMaterial = createShowcaseMaterial(ShowcaseMode.FIREBIRD);
    this.tailMaterial = createShowcaseMaterial(ShowcaseMode.FIREBIRD);
    this.birdMaterial.uniforms.uParam0.value = 3;
    this.birdMaterial.uniforms.uParam1.value = 0.45;

    this.leftWing = new Mesh(createWingGeometry(1), this.birdMaterial);
    this.rightWing = new Mesh(createWingGeometry(-1), this.birdMaterial);

    this.body = new Mesh(new ConeGeometry(0.45, 2.2, 12, 4), this.birdMaterial);
    this.body.geometry.rotateX(Math.PI / 2);
    this.head = new Mesh(new SphereGeometry(0.38, 16, 10), this.birdMaterial);
    this.tail = [];
    for (let i = 0; i < 5; i++) {
      const tail = new Mesh(new PlaneGeometry(1, 1, 16, 2), this.tailMaterial);
      tail.geometry.translate(0, -0.5, 0);
      this.tail.push(tail);
    }

    for (const mesh of [this.leftWing, this.rightWing, this.body, this.head, ...this.tail]) {
      mesh.layers.set(LAYER.VFX);
      mesh.renderOrder = 13;
      this.group.add(mesh);
    }

    this.charge = new Mesh(
      new SphereGeometry(1, 18, 12),
      new MeshBasicMaterial({ color: 0xffdd71, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
    );
    this.charge.layers.set(LAYER.VFX);
    this.charge.renderOrder = 15;
    this.group.add(this.charge);

    this.distortionMaterial = createDistortionMaterial('flow');
    this.distortion = new Mesh(new SphereGeometry(1, 16, 10), this.distortionMaterial);
    this.distortion.layers.set(LAYER.DISTORTION);
    this.group.add(this.distortion);
  }

  createParticles() {
    this.embers = this.ctx.particles.get('phoenix-embers', {
      capacity: 2200,
      shape: ParticleShape.STREAK,
      additive: true,
      stretch: true,
      curl: true
    });
    this.feathers = this.ctx.particles.get('phoenix-feathers', {
      capacity: 900,
      shape: ParticleShape.FEATHER,
      additive: true,
      curl: true,
      lit: true
    });
    this.smoke = this.ctx.particles.get('phoenix-smoke', {
      capacity: 900,
      shape: ParticleShape.SMOKE,
      additive: false,
      curl: true
    });
    this.emberEmitter = new RateEmitter();
    this.featherEmitter = new RateEmitter();
    this.smokeEmitter = new RateEmitter();
  }

  advance(dt) {
    const c = this.config;
    if (this.age < c.charge) return false;
    const speed = c.speed * settings.global.speed;
    this.front += speed * dt;
    const previous = this.u;
    this.u = saturate(this.front / this.length);
    this.pointAt(this.u, this.position);
    return this.u >= 1 && previous < 1;
  }

  get impactDuration() {
    return 1.15;
  }

  get fadeDuration() {
    return 1.25;
  }

  onSpawn() {
    this.emberEmitter.reset();
    this.featherEmitter.reset();
    this.smokeEmitter.reset();
    this._released = false;
    this._sync(1, 0);
  }

  _sync(fade, impact) {
    const c = this.config;
    const charged = saturate(this.age / Math.max(0.01, c.charge));
    const flying = this.age >= c.charge;
    const centre = flying ? this.position : POS.copy(this.origin).addScaledVector(this.direction, 0.65);
    centre.y = c.flightHeight + Math.sin(this.u * Math.PI) * 0.65 * (flying ? 1 : 0);
    this.group.position.set(centre.x, 0, centre.z);
    this.group.rotation.y = headingOf(this.direction);
    this.group.updateMatrix();

    this.charge.visible = !flying;
    this.charge.position.set(0, c.flightHeight, 0.35);
    this.charge.scale.setScalar(0.15 + charged * 0.55);
    this.charge.material.color.copy(getColor(c.colorCore));
    this.charge.material.opacity = fade * (0.4 + charged * 0.5);

    for (const mesh of [this.leftWing, this.rightWing, this.body, this.head, ...this.tail]) mesh.visible = flying;
    if (flying) {
      const flap = Math.sin((this.age - c.charge) * c.flapSpeed) * c.flapAmount;
      this.body.position.set(0, c.flightHeight, 0);
      this.body.scale.set(c.bodyWidth, c.bodyWidth, c.bodyLength / 2.2);
      this.head.position.set(0, c.flightHeight + 0.08, c.bodyLength * 0.62);
      this.head.scale.setScalar(c.bodyWidth * 0.82);
      this.leftWing.position.set(0, c.flightHeight + 0.08, 0.12);
      this.rightWing.position.copy(this.leftWing.position);
      this.leftWing.rotation.set(-0.06, 0.08, flap);
      this.rightWing.rotation.set(-0.06, -0.08, -flap);
      this.leftWing.scale.set(c.wingSpan * 0.5, 1, c.wingDepth);
      this.rightWing.scale.copy(this.leftWing.scale);
      for (let i = 0; i < this.tail.length; i++) {
        const tail = this.tail[i];
        const x = (i - 2) * c.tailWidth * 1.45;
        tail.position.set(x, c.flightHeight - 0.08, -c.bodyLength * 0.65);
        tail.rotation.set(Math.PI / 2.8, 0, (i - 2) * 0.09 + Math.sin(this.age * 5 + i) * 0.06);
        tail.scale.set(c.tailWidth * (1.2 - Math.abs(i - 2) * 0.1), c.tailLength * (1 - Math.abs(i - 2) * 0.09), 1);
      }
    }

    const u = this.birdMaterial.uniforms;
    u.uAge.value = this.age;
    u.uProgress.value = this.u;
    u.uOpacity.value = fade;
    u.uIntensity.value = 1.15 + impact * 0.8;
    u.uParam0.value = c.wingSpan * 0.5;
    u.uParam1.value = c.flapAmount;
    u.uColorA.value.copy(getColor(c.colorCore));
    u.uColorB.value.copy(getColor(c.colorWing));
    u.uColorC.value.copy(getColor(c.colorEdge));

    const tu = this.tailMaterial.uniforms;
    tu.uAge.value = this.age;
    tu.uProgress.value = this.u;
    tu.uOpacity.value = fade * c.trailOpacity;
    tu.uIntensity.value = 1.15 + impact * 0.8;
    tu.uParam0.value = c.tailLength;
    tu.uParam1.value = c.flapAmount;
    tu.uColorA.value.copy(getColor(c.colorCore));
    tu.uColorB.value.copy(getColor(c.colorEdge));
    tu.uColorC.value.copy(getColor(c.colorTail));

    this.distortion.position.set(0, c.flightHeight, -c.tailLength * 0.35);
    this.distortion.visible = true;
    this.distortion.scale.set(c.wingSpan * 0.48, 1.3, c.tailLength * 0.65);
    this.distortionMaterial.uniforms.uAge.value = this.age;
    this.distortionMaterial.uniforms.uStrength.value = c.distortion;
    this.distortionMaterial.uniforms.uOpacity.value = flying ? fade * 0.72 : charged * 0.35;
    this.distortionMaterial.uniforms.uDirection.value.copy(new Vector2(0, -1));
  }

  _particles(dt, scale, impact = false) {
    const c = this.config;
    const time = frame.uTime.value;
    const world = POS.copy(this.group.position).setY(c.flightHeight);
    const emberCount = this.emberEmitter.tick(dt, c.emberRate * scale);
    if (emberCount > 0) {
      EMIT.position = world;
      EMIT.direction = DIR.copy(this.direction).multiplyScalar(-1).addScaledVector(UP, impact ? 0.8 : 0.15).normalize();
      EMIT.speed = c.emberSpeed * (impact ? 2.2 : 1);
      EMIT.speedVariance = 0.75;
      EMIT.spread = impact ? 1 : 0.65;
      EMIT.radius = impact ? c.impactRadius * 0.35 : c.wingSpan * 0.25;
      EMIT.anchor = null;
      EMIT.size = c.emberSize;
      EMIT.sizeVariance = 0.65;
      EMIT.life = c.emberLifetime;
      EMIT.lifeVariance = 0.4;
      EMIT.spin = 2;
      EMIT.time = time;
      this.embers.emit(emberCount, EMIT);
    }
    const featherCount = this.featherEmitter.tick(dt, c.featherRate * scale);
    if (featherCount > 0) {
      EMIT.position = world;
      EMIT.direction = DIR.set(0, impact ? 1 : -0.2, 0.1);
      EMIT.speed = c.emberSpeed * 0.55;
      EMIT.speedVariance = 0.6;
      EMIT.spread = 1;
      EMIT.radius = impact ? c.impactRadius * 0.7 : c.wingSpan * 0.35;
      EMIT.size = c.featherSize;
      EMIT.sizeVariance = 0.5;
      EMIT.life = c.featherLifetime;
      EMIT.lifeVariance = 0.35;
      EMIT.spin = 3.5;
      EMIT.time = time;
      this.feathers.emit(featherCount, EMIT);
    }
    const smokeCount = this.smokeEmitter.tick(dt, c.smokeRate * scale);
    if (smokeCount > 0) {
      EMIT.position = world;
      EMIT.direction = DIR.copy(this.direction).multiplyScalar(-1).addScaledVector(UP, impact ? 0.7 : 0.18).normalize();
      EMIT.speed = c.emberSpeed * (impact ? 1.2 : 0.4);
      EMIT.speedVariance = 0.7;
      EMIT.spread = impact ? 1 : 0.55;
      EMIT.radius = impact ? c.impactRadius * 0.28 : c.bodyWidth * 1.4;
      EMIT.anchor = null;
      EMIT.size = c.smokeSize;
      EMIT.sizeVariance = 0.55;
      EMIT.life = c.smokeLifetime;
      EMIT.lifeVariance = 0.4;
      EMIT.spin = 0.35;
      EMIT.time = time;
      this.smoke.emit(smokeCount, EMIT);
    }
    this.embers.setGradient(getColor(c.colorCore), getColor(c.colorWing), getColor(c.colorEdge), getColor(c.colorTail));
    this.embers.uniforms.uGlow.value = 1.5;
    this.feathers.setGradient(getColor(c.colorCore), getColor(c.colorWing), getColor(c.colorEdge), getColor(c.colorTail));
    this.feathers.uniforms.uGlow.value = 1.25;
    this.smoke.setGradient(getColor(c.colorEdge), getColor(c.colorTail), getColor(c.colorSmoke), getColor(c.colorSmoke));
    this.smoke.uniforms.uOpacity.value = c.trailOpacity * 0.3 * scale;
  }

  onTravel(dt) {
    if (!this._released && this.age >= this.config.charge) {
      this._released = true;
      const c = this.config;
      const world = POS.copy(this.group.position).setY(c.flightHeight);
      EMIT.position = world;
      EMIT.direction = DIR.copy(this.direction).multiplyScalar(-0.25).addScaledVector(UP, 0.75).normalize();
      EMIT.speed = c.emberSpeed * 0.8;
      EMIT.speedVariance = 0.7;
      EMIT.spread = 1;
      EMIT.radius = c.wingSpan * 0.32;
      EMIT.anchor = null;
      EMIT.size = c.featherSize;
      EMIT.sizeVariance = 0.55;
      EMIT.life = c.featherLifetime;
      EMIT.lifeVariance = 0.35;
      EMIT.spin = 4.2;
      EMIT.time = frame.uTime.value;
      this.feathers.emit(c.featherCount, EMIT);
      this.ctx.flash.trigger(getColor(c.colorCore), 0.2, 0.002);
    }
    this._sync(1, 0);
    this._particles(dt, this.age < this.config.charge ? 0.45 : 1);
  }

  onImpact() {
    const c = this.config;
    const hit = POS.copy(this.position).setY(0.35);
    this.ctx.bursts.spawn(BurstMode.FIRE, hit, {
      radius: 0.5,
      endRadius: c.impactRadius,
      life: 0.82,
      intensity: 1.5,
      opacity: 0.9,
      colorA: getColor(c.colorCore),
      colorB: getColor(c.colorWing),
      colorC: getColor(c.colorEdge),
      squash: 0.48
    });
    this.ctx.decals.spawn(DecalType.SCORCH, hit, {
      radius: c.impactRadius * 0.72,
      life: 4.2,
      intensity: 1.1,
      colorA: getColor(c.colorSmoke),
      colorB: getColor(c.colorEdge)
    });
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, hit, {
      radius: c.impactRadius,
      life: 0.9,
      intensity: 1.35,
      colorA: getColor(c.colorCore),
      colorB: getColor(c.colorWing),
      growth: 0.25
    });
    this.ctx.shake.add(c.impactShake, 1.9, 19);
    this.ctx.flash.trigger(getColor(c.colorCore), c.impactFlash, 0.0008);
    this.lightBoost = 11;
  }

  onFade(dt, t) {
    const fade = t <= 1 ? 1 - t * 0.25 : Math.max(0, 2 - t);
    this._sync(fade, t <= 1 ? 1 - t : 0);
    this._particles(dt, fade * 1.35, true);
  }

  onDestroy() {
    this.group.position.set(0, 0, 0);
    for (const mesh of [this.leftWing, this.rightWing, this.body, this.head, ...this.tail, this.charge, this.distortion]) mesh.visible = false;
  }

  dispose() {
    super.dispose();
    for (const mesh of [this.leftWing, this.rightWing, this.body, this.head, ...this.tail]) mesh.geometry.dispose();
    this.birdMaterial.dispose();
    this.tailMaterial.dispose();
    this.charge.geometry.dispose();
    this.charge.material.dispose();
    this.distortion.geometry.dispose();
    this.distortionMaterial.dispose();
  }
}

/** A swept, tapered wing in the local XZ plane. Its silhouette stays avian even without particles or bloom. */
function createWingGeometry(side) {
  const geometry = new BufferGeometry();
  const points = [
    [0, 0, 0.34],
    [0.2 * side, 0, 0.52],
    [0.62 * side, 0, 0.25],
    [1 * side, 0, -0.08],
    [0.74 * side, 0, -0.46],
    [0.34 * side, 0, -0.62],
    [0.08 * side, 0, -0.4]
  ];
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(points.map(([x, , z]) => [Math.abs(x), z + 0.62]).flat(), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 6, 2, 3, 4, 2, 4, 5, 2, 5, 6]);
  geometry.computeVertexNormals();
  return geometry;
}
