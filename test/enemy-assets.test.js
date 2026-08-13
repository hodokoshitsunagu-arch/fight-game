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
test('Monster model keeps its complete rig and receives four compatible animation poses', async () => {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  const parse = (file) => {
    const bytes = fs.readFileSync(path.join(root, 'public', 'models', file));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return loader.parse(buffer, './public/models/');
  };

  const rawMonster = parse('Monster.fbx');
  const mutantWalk = parse('Mutant Walking.fbx').animations[0];
  assert.ok(mutantWalk?.duration > 1, 'Mutant Walking needs a usable clip');
  const rawMeshes = [];
  rawMonster.traverse((node) => {
    if (node.isSkinnedMesh) rawMeshes.push(node);
  });
  assert.equal(rawMeshes.length, 1, 'Monster source contains one skinned mesh');
  assert.equal(rawMeshes[0].skeleton.bones.length, 43);
  const rawBones = new Set(rawMeshes[0].skeleton.bones);
  assert.equal(
    rawMeshes[0].skeleton.bones.filter((bone) => rawBones.has(bone.parent)).length,
    42,
    'Monster source skeleton is one complete hierarchy'
  );

  const { EnemyAssets } = await import('../src/enemies/EnemyAssets.js');
  const loadedFiles = [];
  const assets = await EnemyAssets.load({
    async loadFBX(url) {
      const file = path.posix.basename(url);
      loadedFiles.push(file);
      return parse(file);
    },
    async settled() {}
  }, { registerShadowCaster() {} });
  assert.deepEqual(loadedFiles, [
    'Monster.fbx',
    'Mutant Walking.fbx',
    'Zombie Punching.fbx',
    'Zombie Death.fbx',
    'Flying Back Death.fbx'
  ]);
  assert.equal(assets.clips.walk.duration, mutantWalk.duration, 'walk uses Mutant Walking.fbx');

  const targetBones = new Map();
  let remainingBones = 0;
  let hierarchyLinks = 0;
  let canonicalSkeleton = null;
  const templateMeshes = [];
  assets.template.traverse((node) => {
    if (node.isBone) {
      remainingBones++;
      targetBones.set(node.name, node);
    }
    if (node.isSkinnedMesh && !canonicalSkeleton) canonicalSkeleton = node.skeleton;
    if (node.isSkinnedMesh) templateMeshes.push(node);
  });
  const canonicalBones = new Set(canonicalSkeleton.bones);
  for (const bone of canonicalBones) if (canonicalBones.has(bone.parent)) hierarchyLinks++;
  assert.equal(remainingBones, 43, 'template keeps exactly one Monster skeleton');
  assert.equal(hierarchyLinks, 42, 'template keeps the complete Monster bone hierarchy');
  assert.equal(templateMeshes.length, 1, 'Monster stays in one draw mesh');
  assert.ok(templateMeshes.every((mesh) => !Array.isArray(mesh.material)), 'each mesh uses one material');
  assert.equal(assets.template.animations.length, 0, 'the one-frame source take is not used');

  for (const [name, clip] of Object.entries(assets.clips)) {
    assert.ok(clip.duration > 1, `${name} needs a usable clip`);
    assert.equal(clip.tracks.length, 35, `${name} keeps only Monster-compatible tracks`);
    assert.ok(
      clip.tracks.every((track) => targetBones.has(track.name.split('.')[0])),
      `${name} contains no tracks for missing finger bones`
    );
  }
  for (const name of ['walk', 'attack']) {
    const hips = assets.clips[name].tracks.find((track) => /Hips\.position$/i.test(track.name));
    assert.ok(hips, `${name} has a hips position track`);
    const targetHips = targetBones.get(hips.name.split('.')[0]);
    assert.ok(
      Math.abs(hips.values[1] - targetHips.position.y) < 1e-5,
      `${name} starts at the Monster hip height`
    );
    for (let i = 3; i < hips.values.length; i += 3) {
      assert.ok(
        Math.abs(hips.values[i] - targetHips.position.x) < 1e-5,
        `${name} has no authored X root motion`
      );
      assert.ok(
        Math.abs(hips.values[i + 2] - targetHips.position.z) < 1e-5,
        `${name} has no authored Z root motion`
      );
    }
  }

  const instance = assets.createModel();
  let clonedBones = 0;
  const clonedMeshes = [];
  instance.traverse((node) => {
    if (node.isBone) clonedBones++;
    if (node.isSkinnedMesh) clonedMeshes.push(node);
  });
  assert.equal(clonedBones, 43, 'pooled instance clones one rig');
  assert.equal(clonedMeshes.length, 1);
  assert.ok(clonedMeshes.every((mesh) => mesh.skeleton.bones.length === 43));
  assert.notEqual(clonedMeshes[0].skeleton.bones[0], templateMeshes[0].skeleton.bones[0]);

  const { EnemyAnimation } = await import('../src/enemies/EnemyAnimation.js');
  const controller = new EnemyAnimation(instance, assets.clips);
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

  const prewarmed = Array.from({ length: 100 }, () => assets.createModel());
  let instanceMeshes = 0;
  let instanceBones = 0;
  for (const root of prewarmed) {
    root.traverse((node) => {
      if (node.isSkinnedMesh) instanceMeshes++;
      if (node.isBone) instanceBones++;
    });
  }
  assert.equal(instanceMeshes, 100);
  assert.equal(instanceBones, 4300);
  assets.dispose();
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
