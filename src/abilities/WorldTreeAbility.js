import {
  CylinderGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
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
import { saturate, Easing } from '../utils/math.js';
import { setSegment } from './ShowcaseUtils.js';

const MAX_ROOTS = 24;
const ROOT_STEPS = 5;
const MAX_ROOT_SEGMENTS = MAX_ROOTS * ROOT_STEPS;
const MAX_BRANCHES = 72;
const MAX_LEAVES = 240;
const DUMMY = new Object3D();
const START = new Vector3();
const END = new Vector3();
const CENTRE = new Vector3();
const POS = new Vector3();
const DIR = new Vector3();
const UP = new Vector3(0, 1, 0);
const EMIT = {};

export class WorldTreeAbility extends Ability {
  constructor(context) {
    super('worldtree', context);
    this.rootRecords = Array.from({ length: MAX_ROOTS }, () => ({ angle: 0, bend: 0, reach: 0 }));
    this.branchRecords = Array.from({ length: MAX_BRANCHES }, () => ({ height: 0, angle: 0, length: 0, lift: 0, twist: 0 }));
    this.leafRecords = Array.from({ length: MAX_LEAVES }, () => ({ branch: 0, along: 0, angle: 0, size: 0, lift: 0 }));
    this.rootCount = 0;
    this.branchCount = 0;
    this.leafCount = 0;
  }

  createShaders() {
    this.woodMaterial = createShowcaseMaterial(ShowcaseMode.SAP, { additive: false, depthWrite: true });
    this.rootMaterial = createShowcaseMaterial(ShowcaseMode.SAP, { additive: false, depthWrite: true });
    this.branchGeometry = new CylinderGeometry(1, 1, 1, 7, 1, false);
    this.branches = new InstancedMesh(this.branchGeometry, this.woodMaterial, MAX_BRANCHES + 1);
    this.branches.layers.set(LAYER.VFX);
    this.branches.frustumCulled = false;

    this.roots = new InstancedMesh(this.branchGeometry, this.rootMaterial, MAX_ROOT_SEGMENTS);
    this.roots.layers.set(LAYER.VFX);
    this.roots.frustumCulled = false;

    this.leafGeometry = new OctahedronGeometry(1, 0);
    this.leafMaterial = createShowcaseMaterial(ShowcaseMode.FIREBIRD);
    this.leaves = new InstancedMesh(this.leafGeometry, this.leafMaterial, MAX_LEAVES);
    this.leaves.layers.set(LAYER.VFX);
    this.leaves.frustumCulled = false;

    this.groundMaterial = createShowcaseMaterial(ShowcaseMode.GROUND);
    this.ground = new Mesh(new PlaneGeometry(1, 1, 64, 8).rotateX(-Math.PI / 2), this.groundMaterial);
    this.ground.layers.set(LAYER.VFX);
    this.ground.renderOrder = 7;

    this.seed = new Mesh(
      new SphereGeometry(1, 14, 10),
      new MeshBasicMaterial({ color: 0xd9ff9b, transparent: true, opacity: 1, depthWrite: false, toneMapped: false })
    );
    this.seed.layers.set(LAYER.VFX);
    this.seed.renderOrder = 15;

    this.distortionMaterial = createDistortionMaterial('radial');
    this.distortion = new Mesh(new SphereGeometry(1, 16, 12), this.distortionMaterial);
    this.distortion.layers.set(LAYER.DISTORTION);

    this.group.add(this.ground, this.roots, this.branches, this.leaves, this.seed, this.distortion);
  }

  createParticles() {
    this.pollen = this.ctx.particles.get('worldtree-pollen', {
      capacity: 2200,
      shape: ParticleShape.SOFT,
      additive: true,
      curl: true,
      swirl: true
    });
    this.leafParticles = this.ctx.particles.get('worldtree-leaves', {
      capacity: 1100,
      shape: ParticleShape.LEAF,
      additive: false,
      curl: true,
      lit: true
    });
    this.seeds = this.ctx.particles.get('worldtree-seeds', {
      capacity: 900,
      shape: ParticleShape.SOFT,
      additive: true,
      curl: true
    });
    this.pollenEmitter = new RateEmitter();
    this.leafEmitter = new RateEmitter();
    this.seedEmitter = new RateEmitter();
  }

  get impactDuration() {
    return this.config.growTime + this.config.holdTime;
  }

  get fadeDuration() {
    return this.config.fadeTime;
  }

  get instanceCount() {
    return this.roots.count + this.branches.count + this.leaves.count;
  }

  onSpawn() {
    const c = this.config;
    this.pollenEmitter.reset();
    this.leafEmitter.reset();
    this.seedEmitter.reset();
    this._bloomed = false;
    for (let i = 0; i < MAX_ROOTS; i++) {
      const r = this.rootRecords[i];
      r.angle = (i / MAX_ROOTS) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      r.bend = (Math.random() - 0.5) * 2;
      r.reach = 0.65 + Math.random() * 0.4;
    }
    for (let i = 0; i < MAX_BRANCHES; i++) {
      const b = this.branchRecords[i];
      b.height = 0.25 + Math.random() * 0.68;
      b.angle = i * 2.39996 + (Math.random() - 0.5) * 0.28;
      b.length = 0.45 + Math.random() * 0.55;
      b.lift = 0.25 + Math.random() * 0.55;
      b.twist = (Math.random() - 0.5) * 2;
    }
    for (let i = 0; i < MAX_LEAVES; i++) {
      const l = this.leafRecords[i];
      l.branch = i % MAX_BRANCHES;
      l.along = 0.55 + Math.random() * 0.48;
      l.angle = Math.random() * Math.PI * 2;
      l.size = 0.55 + Math.random() * 0.9;
      l.lift = (Math.random() - 0.5) * 0.45;
    }
    this.seed.visible = true;
    this.ground.visible = false;
    this.roots.count = 0;
    this.branches.count = 0;
    this.leaves.count = 0;
    this.distortion.visible = false;
    this._syncTravel();
  }

  _centre(out = CENTRE) {
    return this.pointAt(1, out).setY(0);
  }

  _syncTravel() {
    const c = this.config;
    this.position.y = 0.32 + Math.sin(this.u * Math.PI) * 0.85;
    this.seed.position.copy(this.position);
    this.seed.scale.set(0.18 + this.u * 0.12, 0.28 + this.u * 0.18, 0.18 + this.u * 0.12);
    this.seed.rotation.set(this.age * 3.4, this.age * 5.1, this.age * 2.2);
    this.seed.material.color.copy(getColor(c.colorGold));
  }

  _branchPoint(record, along, centre, out) {
    const c = this.config;
    const baseY = c.treeHeight * record.height;
    const radius = c.branchSpread * record.length * along;
    const angle = record.angle + record.twist * c.branchTwist * along * 0.3;
    return out.set(
      centre.x + Math.cos(angle) * radius,
      baseY + c.treeHeight * record.lift * along * (1 - along * 0.35),
      centre.z + Math.sin(angle) * radius
    );
  }

  _syncTree(growth, fade, dissolve) {
    const c = this.config;
    this.rootCount = Math.min(MAX_ROOTS, qualityCount(c.rootCount, 'instances', 6));
    this.branchCount = Math.min(MAX_BRANCHES, qualityCount(c.branchCount, 'instances', 14));
    this.leafCount = Math.min(MAX_LEAVES, qualityCount(c.leafCount, 'instances', 36));
    const centre = this._centre();
    const rootGrowth = saturate(growth * 1.7);
    const trunkGrowth = Easing.outQuint(saturate((growth - 0.12) / 0.58));
    const crownGrowth = Easing.outQuint(saturate((growth - 0.42) / 0.58));
    const crownFade = 1 - saturate(dissolve / 0.68);
    const woodFade = 1 - saturate((dissolve - 0.28) / 0.72);
    const rootFade = 1 - saturate((dissolve - 0.52) / 0.48);

    this.position.set(centre.x, c.treeHeight * 0.55, centre.z);
    this.ground.visible = rootGrowth > 0.001;
    this.ground.position.set(centre.x, 0.022, centre.z);
    this.ground.scale.setScalar(c.zoneRadius * 2 * rootGrowth);
    const gu = this.groundMaterial.uniforms;
    gu.uAge.value = this.age;
    gu.uOpacity.value = fade * c.groundGlow;
    gu.uIntensity.value = 1.05;
    gu.uParam0.value = this.rootCount;
    gu.uParam1.value = 1.7;
    gu.uColorA.value.copy(getColor(c.colorGold));
    gu.uColorB.value.copy(getColor(c.colorSap));
    gu.uColorC.value.copy(getColor(c.colorBark));

    let rootIndex = 0;
    for (let i = 0; i < this.rootCount; i++) {
      const r = this.rootRecords[i];
      for (let step = 0; step < ROOT_STEPS; step++) {
        const a0 = (step / ROOT_STEPS) * rootGrowth;
        const a1 = ((step + 1) / ROOT_STEPS) * rootGrowth;
        const reach = c.zoneRadius * c.rootReach * r.reach;
        const curve = r.bend * c.rootWander;
        const angle0 = r.angle + curve * a0 * a0;
        const angle1 = r.angle + curve * a1 * a1;
        START.set(centre.x + Math.cos(angle0) * reach * a0, 0.07 - a0 * 0.045, centre.z + Math.sin(angle0) * reach * a0);
        END.set(centre.x + Math.cos(angle1) * reach * a1, 0.07 - a1 * 0.045, centre.z + Math.sin(angle1) * reach * a1);
        this.roots.setMatrixAt(rootIndex++, setSegment(DUMMY, START, END, c.rootWidth * (1 - a0 * 0.72)));
      }
    }
    this.roots.count = rootIndex;
    this.roots.instanceMatrix.needsUpdate = true;

    let branchIndex = 0;
    START.set(centre.x, 0, centre.z);
    END.set(centre.x, c.treeHeight * trunkGrowth, centre.z);
    this.branches.setMatrixAt(branchIndex++, setSegment(DUMMY, START, END, c.trunkRadius * (0.35 + trunkGrowth * 0.65)));
    for (let i = 0; i < this.branchCount; i++) {
      const b = this.branchRecords[i];
      const localGrow = saturate(crownGrowth * 1.35 - (i / this.branchCount) * 0.32);
      START.set(centre.x, c.treeHeight * b.height * trunkGrowth, centre.z);
      this._branchPoint(b, localGrow, centre, END);
      const radius = c.trunkRadius * (0.12 + 0.25 * (1 - b.height));
      this.branches.setMatrixAt(branchIndex++, setSegment(DUMMY, START, END, Math.max(0.005, radius)));
    }
    this.branches.count = branchIndex;
    this.branches.instanceMatrix.needsUpdate = true;

    this.leaves.count = this.leafCount;
    for (let i = 0; i < this.leafCount; i++) {
      const l = this.leafRecords[i];
      const b = this.branchRecords[l.branch % Math.max(1, this.branchCount)];
      this._branchPoint(b, l.along * crownGrowth, centre, POS);
      POS.x += Math.cos(l.angle) * c.branchSpread * 0.18;
      POS.z += Math.sin(l.angle) * c.branchSpread * 0.18;
      POS.y += l.lift;
      DUMMY.position.copy(POS);
      DUMMY.rotation.set(l.angle, l.angle * 0.7 + this.age * 0.12, l.angle * 1.3);
      const size = c.leafSize * l.size * crownGrowth * crownFade * (1 - dissolve * (i % 7) / 14);
      DUMMY.scale.set(size * 0.5, size, size * 0.28);
      DUMMY.updateMatrix();
      this.leaves.setMatrixAt(i, DUMMY.matrix);
    }
    this.leaves.instanceMatrix.needsUpdate = true;

    for (const [material, opacity] of [[this.woodMaterial, woodFade], [this.rootMaterial, rootFade]]) {
      const u = material.uniforms;
      u.uAge.value = this.age;
      u.uOpacity.value = opacity;
      u.uIntensity.value = 1;
      u.uParam1.value = 1.8;
      u.uColorA.value.copy(getColor(c.colorSap));
      u.uColorB.value.copy(getColor(c.colorBark));
      u.uColorC.value.copy(getColor(c.colorBark));
    }
    const lu = this.leafMaterial.uniforms;
    lu.uAge.value = this.age;
    lu.uOpacity.value = crownFade;
    lu.uIntensity.value = c.leafGlow;
    lu.uParam0.value = c.branchSpread;
    lu.uParam1.value = 0.12;
    lu.uColorA.value.copy(getColor(c.colorBloom));
    lu.uColorB.value.copy(getColor(c.colorLeaf));
    lu.uColorC.value.copy(getColor(c.colorSap));

    this.distortion.visible = growth > 0.5 && fade > 0.05;
    this.distortion.position.set(centre.x, c.treeHeight * 0.52, centre.z);
    this.distortion.scale.set(c.branchSpread * crownGrowth, c.treeHeight * 0.55 * trunkGrowth, c.branchSpread * crownGrowth);
    this.distortionMaterial.uniforms.uAge.value = this.age;
    this.distortionMaterial.uniforms.uStrength.value = c.distortion;
    this.distortionMaterial.uniforms.uOpacity.value = fade * crownGrowth * 0.45;
  }

  _particles(dt, scale, dissolve) {
    const c = this.config;
    const centre = this._centre();
    const time = frame.uTime.value;
    const pollen = this.pollenEmitter.tick(dt, c.pollenRate * scale);
    if (pollen > 0) {
      EMIT.position = POS.set(centre.x, c.treeHeight * 0.72, centre.z);
      EMIT.anchor = EMIT.position;
      EMIT.direction = UP;
      EMIT.speed = c.pollenSpeed;
      EMIT.speedVariance = 0.7;
      EMIT.spread = 1;
      EMIT.radius = c.branchSpread * 0.85;
      EMIT.size = c.pollenSize;
      EMIT.sizeVariance = 0.6;
      EMIT.life = c.pollenLifetime;
      EMIT.lifeVariance = 0.45;
      EMIT.spin = 0;
      EMIT.time = time;
      this.pollen.emit(pollen, EMIT);
    }
    const seeds = this.seedEmitter.tick(dt, c.seedRate * scale * (0.35 + dissolve * 2.2));
    if (seeds > 0) {
      EMIT.position = POS.set(centre.x, c.treeHeight * 0.8, centre.z);
      EMIT.anchor = null;
      EMIT.direction = DIR.set(0, 0.4 + dissolve, 0);
      EMIT.speed = 0.8 + dissolve * 2;
      EMIT.speedVariance = 0.8;
      EMIT.spread = 1;
      EMIT.radius = c.branchSpread;
      EMIT.size = c.pollenSize * 1.5;
      EMIT.sizeVariance = 0.65;
      EMIT.life = c.seedLifetime;
      EMIT.lifeVariance = 0.45;
      EMIT.spin = 1.5;
      EMIT.time = time;
      this.seeds.emit(seeds, EMIT);
    }
    const leaves = this.leafEmitter.tick(dt, c.leafRate * scale * (0.2 + dissolve * 2.8));
    if (leaves > 0) {
      EMIT.position = POS.set(centre.x, c.treeHeight * 0.72, centre.z);
      EMIT.anchor = null;
      EMIT.direction = DIR.set(0, 0.3 + dissolve * 0.8, 0);
      EMIT.speed = 0.65 + dissolve * 1.4;
      EMIT.speedVariance = 0.8;
      EMIT.spread = 1;
      EMIT.radius = c.branchSpread * 0.9;
      EMIT.size = c.leafSize * 1.3;
      EMIT.sizeVariance = 0.55;
      EMIT.life = c.leafLifetime;
      EMIT.lifeVariance = 0.4;
      EMIT.spin = 2.6;
      EMIT.time = time;
      this.leafParticles.emit(leaves, EMIT);
    }
    this.pollen.setGradient(getColor(c.colorBloom), getColor(c.colorGold), getColor(c.colorSap), getColor(c.colorLeaf));
    this.pollen.uniforms.uSwirl.value = 0.45;
    this.pollen.uniforms.uGlow.value = 1.1;
    this.seeds.setGradient(getColor(c.colorBloom), getColor(c.colorGold), getColor(c.colorLeaf), getColor(c.colorSap));
    this.seeds.uniforms.uGlow.value = 1.25;
    this.leafParticles.setGradient(getColor(c.colorBloom), getColor(c.colorLeaf), getColor(c.colorSap), getColor(c.colorBark));
    this.leafParticles.uniforms.uOpacity.value = scale;
  }

  onTravel(dt) {
    this._syncTravel();
  }

  onImpact() {
    const c = this.config;
    const centre = this._centre();
    this.seed.visible = false;
    this.ctx.decals.spawn(DecalType.CRACK, centre, {
      radius: c.zoneRadius,
      life: c.growTime + c.holdTime + c.fadeTime,
      intensity: c.groundGlow,
      colorA: getColor(c.colorBark),
      colorB: getColor(c.colorSap)
    });
    this.ctx.bursts.spawn(BurstMode.AIR, POS.copy(centre).setY(0.25), {
      radius: 0.25,
      endRadius: c.zoneRadius * 0.75,
      life: 0.7,
      intensity: 0.95,
      opacity: 0.5,
      colorA: getColor(c.colorBloom),
      colorB: getColor(c.colorSap),
      colorC: getColor(c.colorLeaf),
      squash: 0.22
    });
    this.ctx.shake.add(c.impactShake, 2.1, 15);
    this.ctx.flash.trigger(getColor(c.colorBloom), c.impactFlash, 0.002);
    this.lightBoost = 7;
  }

  onFade(dt, t) {
    const c = this.config;
    const growth = t <= 1 ? saturate(this.impactTime / Math.max(0.05, c.growTime)) : 1;
    const dissolve = t <= 1 ? 0 : saturate(t - 1);
    const fade = t <= 1 ? 1 : Math.max(0, 2 - t);
    this._syncTree(growth, fade, dissolve);
    this._particles(dt, fade * (0.35 + growth), dissolve);
    if (growth > 0.8 && !this._bloomed) {
      this._bloomed = true;
      const centre = this._centre(POS).setY(c.treeHeight * 0.62);
      this.ctx.bursts.spawn(BurstMode.AIR, centre, {
        radius: 0.3,
        endRadius: c.branchSpread * 1.35,
        life: 0.9,
        intensity: 1.1,
        opacity: 0.42,
        colorA: getColor(c.colorBloom),
        colorB: getColor(c.colorGold),
        colorC: getColor(c.colorLeaf)
      });
      this.ctx.decals.spawn(DecalType.SHOCKWAVE, this._centre(CENTRE), {
        radius: c.zoneRadius,
        life: 1.1,
        intensity: 0.8,
        colorA: getColor(c.colorGold),
        colorB: getColor(c.colorSap),
        growth: 0.18
      });
    }
    this.ctx.shake.rumble(0.018 * (1 - dissolve), dt);
  }

  onDestroy() {
    this.seed.visible = false;
    this.ground.visible = false;
    this.distortion.visible = false;
    this.roots.count = 0;
    this.branches.count = 0;
    this.leaves.count = 0;
  }

  dispose() {
    super.dispose();
    this.branchGeometry.dispose();
    this.woodMaterial.dispose();
    this.rootMaterial.dispose();
    this.leafGeometry.dispose();
    this.leafMaterial.dispose();
    this.ground.geometry.dispose();
    this.groundMaterial.dispose();
    this.seed.geometry.dispose();
    this.seed.material.dispose();
    this.distortion.geometry.dispose();
    this.distortionMaterial.dispose();
  }
}
