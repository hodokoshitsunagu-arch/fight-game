import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.self = globalThis;
globalThis.window = { URL: globalThis.URL };
globalThis.document = {
  createElementNS() {
    return { addEventListener() {}, removeEventListener() {}, set src(_value) {}, style: {} };
  }
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'Zombie Walking .fbx',
  'Zombie Punching.fbx',
  'Zombie Death.fbx',
  'Flying Back Death.fbx'
];

test('all Zombie FBX files share the same skeleton and animation bindings', async () => {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  let expectedBones = null;
  let expectedTracks = null;
  let walkingObject = null;
  const loadedClips = {};

  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, 'public', 'models', file));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const object = loader.parse(buffer, './public/models/');
    const clip = object.animations[0];
    assert.ok(clip?.duration > 1, `${file} needs a usable clip`);
    const tracks = clip.tracks.map((track) => track.name).sort();
    let bones = null;
    object.traverse((node) => {
      if (!bones && node.isSkinnedMesh) bones = node.skeleton.bones.map((bone) => bone.name);
    });
    assert.equal(bones?.length, 63);
    assert.equal(tracks.length, 50);
    expectedBones ??= bones;
    expectedTracks ??= tracks;
    assert.deepEqual(bones, expectedBones, `${file} skeleton differs`);
    assert.deepEqual(tracks, expectedTracks, `${file} tracks differ`);
    loadedClips[file] = clip.clone();
    if (file === 'Zombie Walking .fbx') walkingObject = object;
  }

  const { optimiseTemplate } = await import('../src/enemies/EnemyAssets.js');
  const meshes = optimiseTemplate(walkingObject, { registerShadowCaster() {} });
  let remainingBones = 0;
  let hierarchyLinks = 0;
  let canonicalSkeleton = null;
  walkingObject.traverse((node) => {
    if (node.isBone) remainingBones++;
    if (node.isSkinnedMesh && !canonicalSkeleton) canonicalSkeleton = node.skeleton;
  });
  const canonicalBones = new Set(canonicalSkeleton.bones);
  for (const bone of canonicalBones) if (canonicalBones.has(bone.parent)) hierarchyLinks++;
  assert.equal(remainingBones, 63, 'template keeps one skeleton');
  assert.equal(hierarchyLinks, 62, 'template keeps the complete bone hierarchy');
  assert.equal(meshes.length, 2, 'body and clothing collapse to two draw meshes');
  assert.ok(meshes.every((mesh) => !Array.isArray(mesh.material)), 'each mesh uses one material');

  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const instance = clone(walkingObject);
  let clonedBones = 0;
  const clonedMeshes = [];
  instance.traverse((node) => {
    if (node.isBone) clonedBones++;
    if (node.isSkinnedMesh) clonedMeshes.push(node);
  });
  assert.equal(clonedBones, 63, 'pooled instance clones one rig');
  assert.equal(clonedMeshes.length, 2);
  assert.ok(clonedMeshes.every((mesh) => mesh.skeleton.bones.length === 63));
  assert.notEqual(clonedMeshes[0].skeleton.bones[0], meshes[0].skeleton.bones[0]);

  const { AnimationMixer } = await import('three');
  const mixer = new AnimationMixer(instance);
  const action = mixer.clipAction(walkingObject.animations[0]);
  const animatedBone = clonedMeshes[0].skeleton.bones.find((bone) => bone.name === 'mixamorigLeftUpLeg');
  const before = animatedBone.quaternion.clone();
  action.play();
  mixer.update(0.35);
  assert.ok(before.angleTo(animatedBone.quaternion) > 0.01, 'walk clip moves the cloned skeleton');

  const { EnemyAnimation } = await import('../src/enemies/EnemyAnimation.js');
  const controller = new EnemyAnimation(instance, {
    walk: loadedClips['Zombie Walking .fbx'],
    attack: loadedClips['Zombie Punching.fbx'],
    death: loadedClips['Zombie Death.fbx'],
    flyingDeath: loadedClips['Flying Back Death.fbx']
  });
  controller.play('walk', { randomPhase: true });
  assert.equal(controller.currentName, 'walk');
  controller.update(0.1);
  controller.play('attack', { restart: true, blend: 0.12 });
  assert.equal(controller.currentName, 'attack');
  controller.update(0.2);
  controller.play('death', { restart: true, blend: 0.08 });
  assert.equal(controller.currentName, 'death');
  controller.play('flyingDeath', { restart: true, blend: 0.08 });
  assert.equal(controller.currentName, 'flyingDeath');
  const poseSignatures = new Set();
  for (const name of ['walk', 'attack', 'death', 'flyingDeath']) {
    controller.reset();
    controller.play(name, { restart: true, blend: 0 });
    controller.update(0.45);
    const pose = clonedMeshes[0].skeleton.bones
      .filter((bone) => /Hips|Spine2|LeftUpLeg|RightArm/.test(bone.name))
      .flatMap((bone) => bone.quaternion.toArray().map((value) => value.toFixed(3)))
      .join('|');
    poseSignatures.add(pose);
  }
  assert.equal(poseSignatures.size, 4, 'walk, attack and both deaths produce distinct poses');
  controller.dispose();

  const prewarmed = Array.from({ length: 100 }, () => clone(walkingObject));
  let instanceMeshes = 0;
  let instanceBones = 0;
  for (const root of prewarmed) {
    root.traverse((node) => {
      if (node.isSkinnedMesh) instanceMeshes++;
      if (node.isBone) instanceBones++;
    });
  }
  assert.equal(instanceMeshes, 200);
  assert.equal(instanceBones, 6300);
});

test('player hit reaction binds to the display character skeleton', async () => {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const { AnimationMixer } = await import('three');
  const loader = new FBXLoader();
  const parse = (file) => {
    const bytes = fs.readFileSync(path.join(root, 'public', 'models', file));
    return loader.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      './public/models/'
    );
  };
  const character = parse('Idle.fbx');
  const reactionFile = parse('Standing React Small From Front.fbx');
  const bones = new Set();
  character.traverse((node) => {
    if (node.isBone) bones.add(node.name);
  });
  const clip = reactionFile.animations[0].clone();
  clip.tracks = clip.tracks.filter((track) => bones.has(track.name.split('.')[0]));
  assert.ok(clip.tracks.length >= 20, 'reaction retains the major body tracks');

  let spine = null;
  character.traverse((node) => {
    if (node.name === 'mixamorigSpine2') spine = node;
  });
  const before = spine.quaternion.clone();
  const mixer = new AnimationMixer(character);
  mixer.clipAction(clip).play();
  mixer.update(0.45);
  assert.ok(before.angleTo(spine.quaternion) > 0.01, 'reaction changes the player pose');
});
