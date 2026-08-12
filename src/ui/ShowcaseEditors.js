import { settings, CAST_ANIMATIONS } from '../config/settings.js';

const RANGE = (folder, object, [key, min, max, step, label = key]) =>
  folder.add(object, key, min, max, step).name(label);

const COLOR = (folder, object, key, label = key) => folder.addColor(object, key).name(label);

function section(folder, title, object, ranges = [], colors = []) {
  const child = folder.addFolder(title);
  ranges.forEach((item) => RANGE(child, object, item));
  colors.forEach((item) => COLOR(child, object, item[0], item[1]));
  return child;
}

function casting(folder, c) {
  const child = section(folder, 'Casting', c, [
    ['range', 2, 30, 0.1],
    ['minRange', 0, 12, 0.1, 'min range'],
    ['speed', 1, 60, 0.1],
    ['cooldown', 0, 5, 0.05]
  ]);
  child.add(c, 'castAnim', CAST_ANIMATIONS).name('cast animation');
  if ('zoneRadius' in c) RANGE(child, c, ['zoneRadius', 0.5, 10, 0.05, 'zone radius']);
}

function buildVoid(gui) {
  const c = settings.void;
  const f = gui.addFolder('◇  Rift Sever');
  casting(f, c);
  section(f, 'Rift silhouette', c, [
    ['width', 0.03, 0.8, 0.01], ['height', 0.5, 8, 0.05], ['edgeWidth', 0.02, 1, 0.01],
    ['waviness', 0, 1.5, 0.01], ['noiseScale', 0.2, 8, 0.05], ['flowSpeed', 0, 6, 0.05]
  ], [['colorCore', 'core'], ['colorInner', 'inner'], ['colorEdge', 'edge']]);
  section(f, 'Timing', c, [
    ['openTime', 0.05, 1.5, 0.01], ['holdTime', 0.1, 5, 0.05], ['fadeTime', 0.1, 3, 0.05]
  ]);
  section(f, 'Shards & atmosphere', c, [
    ['shardCount', 0, 48, 1], ['shardSize', 0.02, 0.6, 0.01], ['shardSpin', 0, 15, 0.1],
    ['moteRate', 0, 500, 1], ['moteSize', 0.01, 0.3, 0.005], ['moteSpeed', 0.1, 8, 0.05],
    ['moteLifetime', 0.1, 4, 0.05], ['mistRate', 0, 300, 1], ['mistSize', 0.05, 1.5, 0.01], ['mistLifetime', 0.1, 4, 0.05]
  ], [['colorShard', 'shards'], ['colorMist', 'mist']]);
  section(f, 'Impact & distortion', c, [
    ['distortion', 0, 3, 0.01], ['impactShake', 0, 2, 0.01], ['impactFlash', 0, 1, 0.01],
    ['lightIntensity', 0, 30, 0.1], ['lightRadius', 1, 30, 0.1]
  ], [['lightColor', 'light']]);
}

function buildPhoenix(gui) {
  const c = settings.phoenix;
  const f = gui.addFolder('♢  Solar Phoenix');
  casting(f, c);
  section(f, 'Body & wings', c, [
    ['charge', 0, 1.2, 0.01], ['bodyLength', 0.5, 5, 0.05], ['bodyWidth', 0.1, 1.5, 0.01],
    ['wingSpan', 1, 10, 0.05], ['wingDepth', 0.2, 4, 0.05], ['flapSpeed', 0, 15, 0.1],
    ['flapAmount', 0, 1.2, 0.01], ['flightHeight', 0.2, 4, 0.05], ['tailLength', 0.5, 8, 0.05], ['tailWidth', 0.05, 0.7, 0.01]
  ], [['colorCore', 'core'], ['colorWing', 'wing'], ['colorEdge', 'edge'], ['colorTail', 'tail']]);
  section(f, 'Feathers & flame', c, [
    ['emberRate', 0, 600, 1], ['emberSize', 0.01, 0.3, 0.005], ['emberSpeed', 0.1, 8, 0.05],
    ['emberLifetime', 0.1, 4, 0.05], ['smokeRate', 0, 240, 1], ['smokeSize', 0.05, 1.2, 0.01],
    ['smokeLifetime', 0.2, 4, 0.05], ['featherCount', 0, 160, 1, 'release feathers'],
    ['featherRate', 0, 180, 1], ['featherSize', 0.05, 0.8, 0.01], ['featherLifetime', 0.2, 5, 0.05],
    ['trailOpacity', 0, 2, 0.01, 'tail opacity']
  ], [['colorSmoke', 'smoke']]);
  section(f, 'Impact & heat haze', c, [
    ['impactRadius', 1, 10, 0.05], ['distortion', 0, 3, 0.01], ['impactShake', 0, 2, 0.01],
    ['impactFlash', 0, 1, 0.01], ['lightIntensity', 0, 35, 0.1], ['lightRadius', 1, 30, 0.1]
  ], [['lightColor', 'light']]);
}

function buildSingularity(gui) {
  const c = settings.singularity;
  const f = gui.addFolder('◉  Gravity Singularity');
  casting(f, c);
  section(f, 'Core & accretion disks', c, [
    ['coreRadius', 0.1, 2, 0.01], ['coreHeight', 0.2, 4, 0.05], ['diskRadius', 0.5, 9, 0.05],
    ['diskWidth', 0.05, 1.5, 0.01], ['diskTilt', 0, 1.2, 0.01], ['diskSpeed', 0, 8, 0.05]
  ], [['colorCore', 'core'], ['colorDiskA', 'hot disk'], ['colorDiskB', 'mid disk'], ['colorDiskC', 'cold disk']]);
  section(f, 'Collapse timing', c, [
    ['holdTime', 0.2, 6, 0.05], ['collapseTime', 0.05, 1.5, 0.01], ['fadeTime', 0.1, 3, 0.05], ['distortion', 0, 4, 0.01]
  ]);
  section(f, 'Orbits & atmosphere', c, [
    ['orbitCount', 0, 72, 1], ['orbitSpeed', 0, 6, 0.05], ['debrisSize', 0.02, 0.7, 0.01],
    ['moteRate', 0, 700, 1], ['moteSize', 0.01, 0.25, 0.005], ['moteSpeed', 0.1, 6, 0.05],
    ['moteLifetime', 0.2, 5, 0.05], ['smokeRate', 0, 300, 1], ['smokeSize', 0.05, 1.5, 0.01], ['smokeLifetime', 0.2, 5, 0.05]
  ], [['colorMote', 'motes']]);
  section(f, 'Supernova & light', c, [
    ['impactShake', 0, 2, 0.01], ['impactFlash', 0, 1, 0.01], ['lightIntensity', 0, 35, 0.1], ['lightRadius', 1, 30, 0.1]
  ], [['lightColor', 'light']]);
}

function buildWorldTree(gui) {
  const c = settings.worldtree;
  const f = gui.addFolder('♧  Worldroot Bloom');
  casting(f, c);
  section(f, 'Roots', c, [
    ['rootCount', 1, 24, 1], ['rootReach', 0.2, 1.5, 0.01], ['rootWidth', 0.02, 0.5, 0.01], ['rootWander', 0, 2, 0.01]
  ]);
  section(f, 'Tree silhouette', c, [
    ['treeHeight', 1, 12, 0.05], ['trunkRadius', 0.1, 1.5, 0.01], ['branchCount', 4, 72, 1],
    ['branchSpread', 0.5, 7, 0.05], ['branchTwist', 0, 4, 0.05], ['leafCount', 0, 240, 1],
    ['leafSize', 0.03, 0.6, 0.01], ['leafGlow', 0, 3, 0.01]
  ], [['colorBark', 'bark'], ['colorSap', 'sap'], ['colorLeaf', 'leaves'], ['colorGold', 'gold'], ['colorBloom', 'bloom']]);
  section(f, 'Growth & dissolve', c, [
    ['growTime', 0.1, 3, 0.05], ['holdTime', 0.1, 5, 0.05], ['fadeTime', 0.1, 3, 0.05], ['groundGlow', 0, 2, 0.01]
  ]);
  section(f, 'Pollen & seeds', c, [
    ['pollenRate', 0, 500, 1], ['pollenSize', 0.01, 0.25, 0.005], ['pollenSpeed', 0.05, 4, 0.05],
    ['pollenLifetime', 0.2, 6, 0.05], ['leafRate', 0, 240, 1], ['leafLifetime', 0.2, 6, 0.05],
    ['seedRate', 0, 200, 1], ['seedLifetime', 0.2, 6, 0.05]
  ]);
  section(f, 'Bloom feedback', c, [
    ['distortion', 0, 2, 0.01], ['impactShake', 0, 2, 0.01], ['impactFlash', 0, 1, 0.01],
    ['lightIntensity', 0, 35, 0.1], ['lightRadius', 1, 30, 0.1]
  ], [['lightColor', 'light']]);
}

export function buildShowcaseEditors(gui) {
  buildVoid(gui);
  buildPhoenix(gui);
  buildSingularity(gui);
  buildWorldTree(gui);
}
