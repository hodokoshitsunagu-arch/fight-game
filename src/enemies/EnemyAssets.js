import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshStandardMaterial,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LAYER } from '../core/Layers.js';
import { disposeObject } from '../utils/dispose.js';
import { patchOnBeforeCompile, prependChunk, replaceChunk } from '../utils/shaderPatch.js';

const FILES = Object.freeze({
  walk: './models/Zombie Walking .fbx',
  attack: './models/Zombie Punching.fbx',
  death: './models/Zombie Death.fbx',
  flyingDeath: './models/Flying Back Death.fbx'
});
const TARGET_HEIGHT = 1.95;
const _size = new Vector3();
const _center = new Vector3();

function flattenedClip(source, name, flattenXZ) {
  const clip = source?.animations?.[0]?.clone();
  if (!clip) throw new Error(`[EnemyAssets] ${name} FBX has no animation clip`);
  clip.name = name;
  if (flattenXZ) {
    for (const track of clip.tracks) {
      if (!/Hips\.position$/i.test(track.name)) continue;
      const values = track.values;
      const x = values[0];
      const z = values[2];
      for (let i = 0; i < values.length; i += 3) {
        values[i] = x;
        values[i + 2] = z;
      }
    }
  }
  return clip;
}

function groupGeometry(source, group) {
  const geometry = new BufferGeometry();
  const sourceIndices = source.index
    ? source.index.array.slice(group.start, group.start + group.count)
    : Uint32Array.from({ length: group.count }, (_, i) => group.start + i);
  const remap = new Map();
  const unique = [];
  const index = new Uint32Array(sourceIndices.length);
  for (let i = 0; i < sourceIndices.length; i++) {
    const oldIndex = sourceIndices[i];
    let newIndex = remap.get(oldIndex);
    if (newIndex === undefined) {
      newIndex = unique.length;
      remap.set(oldIndex, newIndex);
      unique.push(oldIndex);
    }
    index[i] = newIndex;
  }

  for (const [name, attribute] of Object.entries(source.attributes)) {
    const ArrayType = attribute.array.constructor;
    const array = new ArrayType(unique.length * attribute.itemSize);
    for (let i = 0; i < unique.length; i++) {
      const from = unique[i] * attribute.itemSize;
      const to = i * attribute.itemSize;
      for (let c = 0; c < attribute.itemSize; c++) array[to + c] = attribute.array[from + c];
    }
    geometry.setAttribute(name, new BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  const IndexType = unique.length > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new BufferAttribute(new IndexType(index), 1));
  return geometry;
}

function materialBucket(material) {
  return /body/i.test(material?.name ?? '') ? 'body' : 'clothes';
}

function buildMaterial(source, bucket, environment) {
  const material = new MeshStandardMaterial({
    name: `Zombie:${bucket}`,
    color: source?.color ?? 0xffffff,
    map: source?.map ?? null,
    normalMap: source?.normalMap ?? null,
    roughness: 0.88,
    metalness: 0,
    side: source?.side
  });
  if (material.map) {
    material.map.colorSpace = SRGBColorSpace;
    material.map.anisotropy = 2;
  }
  material.userData.enemyShader = null;
  patchOnBeforeCompile(material, (shader) => {
    shader.uniforms.uEnemyFlash = { value: 0 };
    shader.uniforms.uEnemyTint = { value: new Color(1, 1, 1) };
    shader.uniforms.uEnemyTintAmount = { value: 0 };
    shader.uniforms.uEnemyDissolve = { value: 0 };
    shader.uniforms.uEnemySeed = { value: 0 };
    shader.vertexShader = prependChunk(
      shader.vertexShader,
      'varying vec3 vEnemyLocal; uniform float uEnemyDissolve; uniform float uEnemySeed;'
    );
    shader.vertexShader = replaceChunk(
      shader.vertexShader,
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vEnemyLocal = position;
       transformed.x += sin(position.y * 0.09 + uEnemySeed * 17.0) * uEnemyDissolve * 1.2;`
    );
    shader.fragmentShader = prependChunk(
      shader.fragmentShader,
      'varying vec3 vEnemyLocal; uniform float uEnemyFlash; uniform vec3 uEnemyTint; uniform float uEnemyTintAmount; uniform float uEnemyDissolve; uniform float uEnemySeed;'
    );
    shader.fragmentShader = replaceChunk(
      shader.fragmentShader,
      '#include <dithering_fragment>',
      `float enemyNoise = fract(sin(dot(floor(vEnemyLocal * 0.17) + uEnemySeed, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
       if (uEnemyDissolve > 0.001 && enemyNoise < uEnemyDissolve) discard;
       gl_FragColor.rgb = mix(gl_FragColor.rgb, uEnemyTint, clamp(uEnemyTintAmount, 0.0, 0.8));
       gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), clamp(uEnemyFlash, 0.0, 1.0));
       #include <dithering_fragment>`
    );
    material.userData.enemyShader = shader;
  });
  material.customProgramCacheKey = () => 'zombie-feedback-v1';
  environment.registerShadowCaster(material);
  return material;
}

function attachFeedback(mesh) {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.layers.set(LAYER.WORLD);
  mesh.onBeforeRender = (_renderer, _scene, _camera, _geometry, material) => {
    const enemy = mesh.userData.enemy;
    const shader = material.userData.enemyShader;
    if (!enemy || !shader) return;
    shader.uniforms.uEnemyFlash.value = enemy.renderFlash;
    shader.uniforms.uEnemyTint.value.copy(enemy.renderTint);
    shader.uniforms.uEnemyTintAmount.value = enemy.renderTintAmount;
    shader.uniforms.uEnemyDissolve.value = enemy.renderDissolve;
    shader.uniforms.uEnemySeed.value = enemy.seed;
  };
}

export function optimiseTemplate(fbx, environment) {
  const sourceMeshes = [];
  fbx.traverse((node) => {
    if (node.isSkinnedMesh) sourceMeshes.push(node);
  });
  if (!sourceMeshes.length) throw new Error('[EnemyAssets] walking FBX contains no SkinnedMesh');

  // This export contains three same-named 63-bone sets. Only one is the real
  // parent/child hierarchy; the Body and Top deformers are helper bones hung
  // one-by-one from it. Picking the first mesh therefore flattens the rig and
  // produces the classic stretched-spaghetti skin. Select the skeleton with
  // the most internal parent links (62 for a valid 63-bone tree).
  const hierarchyScore = (mesh) => {
    const bones = new Set(mesh.skeleton.bones);
    let score = 0;
    for (const bone of bones) if (bones.has(bone.parent)) score++;
    return score;
  };
  const reference = sourceMeshes.reduce(
    (best, mesh) => hierarchyScore(mesh) > hierarchyScore(best) ? mesh : best,
    sourceMeshes[0]
  );
  const referenceBones = new Set(reference.skeleton.bones);
  const referenceRoots = reference.skeleton.bones.filter((bone) => !referenceBones.has(bone.parent));
  const parts = new Map([['body', []], ['clothes', []]]);
  const sources = new Map();
  // The FBX parents each duplicated rig beneath its SkinnedMesh. Preserve the
  // body's rig before removing those source meshes.
  fbx.updateMatrixWorld(true);
  for (const root of referenceRoots) fbx.attach(root);

  for (const mesh of sourceMeshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = mesh.geometry.groups.length
      ? mesh.geometry.groups
      : [{ start: 0, count: mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count, materialIndex: 0 }];
    for (const group of groups) {
      const sourceMaterial = materials[group.materialIndex] ?? materials[0];
      const bucket = materialBucket(sourceMaterial);
      sources.set(bucket, sourceMaterial);
      parts.get(bucket).push(groupGeometry(mesh.geometry, group));
    }
  }

  const optimised = [];
  for (const [bucket, geometries] of parts) {
    if (!geometries.length) continue;
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((item) => item.dispose());
    if (!geometry) throw new Error(`[EnemyAssets] failed to merge ${bucket} geometry`);
    geometry.computeBoundingSphere();
    const material = buildMaterial(sources.get(bucket), bucket, environment);
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = `Zombie:${bucket}`;
    mesh.bind(reference.skeleton, reference.bindMatrix);
    attachFeedback(mesh);
    optimised.push(mesh);
  }

  for (const mesh of sourceMeshes) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material?.dispose();
  }
  // Each clothing mesh carries an identical exported skeleton. The merged
  // meshes all bind to the body's skeleton, so drop the two now-unreferenced
  // bone hierarchies before cloning the template into the pool.
  const redundantRoots = [];
  fbx.traverse((node) => {
    if (!node.isBone || referenceBones.has(node)) return;
    if (!node.parent?.isBone || referenceBones.has(node.parent)) redundantRoots.push(node);
  });
  for (const root of redundantRoots) root.parent?.remove(root);
  fbx.add(...optimised);
  return optimised;
}

function measureFacing(root) {
  let foot = null;
  let toe = null;
  root.traverse((node) => {
    if (!node.isBone) return;
    const short = node.name.split(':').pop().replace(/^mixamorig/i, '');
    if (short === 'LeftFoot' && !foot) foot = node;
    else if (short === 'LeftToeBase' && !toe) toe = node;
  });
  if (!foot || !toe) return 0;
  const heel = foot.getWorldPosition(new Vector3());
  const tip = toe.getWorldPosition(new Vector3()).sub(heel).setY(0);
  return tip.lengthSq() > 1e-6 ? Math.atan2(tip.x, tip.z) : 0;
}

export class EnemyAssets {
  constructor(template, clips, materials, geometries, forwardYaw) {
    this.template = template;
    this.clips = clips;
    this.materials = materials;
    this.geometries = geometries;
    this.forwardYaw = forwardYaw;
  }

  static async load(assets, environment) {
    const walking = await assets.loadFBX(FILES.walk);
    await assets.settled();
    const clips = { walk: flattenedClip(walking, 'walk', true) };

    for (const name of ['attack', 'death', 'flyingDeath']) {
      const file = await assets.loadFBX(FILES[name]);
      await assets.settled();
      clips[name] = flattenedClip(file, name, name === 'attack');
      disposeObject(file);
    }

    const meshes = optimiseTemplate(walking, environment);
    walking.animations.length = 0;
    walking.scale.setScalar(0.01);
    walking.updateMatrixWorld(true);
    const box = new Box3().setFromObject(walking);
    box.getSize(_size);
    walking.scale.multiplyScalar(TARGET_HEIGHT / Math.max(0.001, _size.y));
    walking.updateMatrixWorld(true);
    box.setFromObject(walking);
    box.getCenter(_center);
    walking.position.x -= _center.x;
    walking.position.z -= _center.z;
    walking.position.y -= box.min.y;
    walking.updateMatrixWorld(true);

    const forwardYaw = measureFacing(walking);
    const materials = [...new Set(meshes.map((mesh) => mesh.material))];
    const geometries = [...new Set(meshes.map((mesh) => mesh.geometry))];
    walking.visible = false;
    return new EnemyAssets(walking, clips, materials, geometries, forwardYaw);
  }

  createModel() {
    const model = cloneSkeleton(this.template);
    model.visible = true;
    model.traverse((node) => {
      if (node.isSkinnedMesh) attachFeedback(node);
    });
    return model;
  }

  dispose() {
    this.template.parent?.remove(this.template);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) {
      for (const key of Object.keys(material)) {
        if (material[key]?.isTexture) material[key].dispose();
      }
      material.dispose();
    }
  }
}
