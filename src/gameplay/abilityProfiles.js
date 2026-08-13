/** Gameplay-only tuning. Visual ability classes never read these values. */
export const ABILITY_PROFILES = Object.freeze({
  void: {
    mode: 'impact-line', damage: 90, startRadius: 0.6, endRadius: 0.6,
    force: 3.2, damageType: 'void'
  },
  phoenix: {
    mode: 'impact-sphere', damage: 120, radiusKey: 'impactRadius',
    force: 7, radial: true, damageType: 'fire', deathMode: 'flying', hitStop: true
  },
  singularity: {
    mode: 'tick-sphere', damage: 18, radiusKey: 'zoneRadius', interval: 0.25, duration: 1.5,
    force: -2.8, radial: true, damageType: 'void'
  },
  worldtree: {
    mode: 'impact-sphere', damage: 100, radiusKey: 'zoneRadius', force: 0,
    damageType: 'nature', status: { type: 'root', duration: 1.2 }
  },
  ice: {
    mode: 'impact-line', damage: 80, startRadiusKey: 'widthNear', endRadiusKey: 'width',
    force: 1.2, damageType: 'ice', status: { type: 'ice', duration: 1 }
  },
  thunder: {
    mode: 'impact-line', damage: 75, startRadiusKey: 'spreadNear', endRadiusKey: 'spread',
    force: 1, damageType: 'shock', status: { type: 'shock', duration: 0.25, stagger: 0.25 }
  },
  meteor: {
    mode: 'impact-sphere', damage: 150, radiusKey: 'shockRadius',
    force: 9, radial: true, damageType: 'fire', deathMode: 'flying', hitStop: true
  },
  beam: {
    mode: 'tick-line', damage: 16, startRadiusKey: 'radiusNear', endRadiusKey: 'radius',
    interval: 0.12, duration: 1.15, force: 0.55, damageType: 'energy'
  },
  snare: {
    mode: 'tick-sphere', damage: 18, radiusKey: 'zoneRadius', interval: 0.25, duration: 1.5,
    force: 0, damageType: 'shock', status: { type: 'snare', duration: 0.4, stagger: 0.12 }
  },
  glacier: {
    mode: 'impact-sphere', damage: 125, radiusKey: 'zoneRadius', force: 2,
    radial: true, damageType: 'ice', status: { type: 'ice', duration: 1.5 }, hitStop: true
  }
});
