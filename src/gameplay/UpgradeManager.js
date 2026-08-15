import { settings } from '../config/settings.js';
import { EventEmitter } from '../utils/EventEmitter.js';

export const UPGRADE_DEFINITIONS = Object.freeze([
  { id: 'power', maxRank: 8, title: 'ARCANE POWER', titleZh: '奥术增幅', description: 'All ability damage +15%', descriptionZh: '所有技能伤害 +15%' },
  { id: 'haste', maxRank: 7, title: 'RAPID CASTING', titleZh: '急速施法', description: 'Cooldowns -8%', descriptionZh: '技能冷却 -8%' },
  { id: 'radius', maxRank: 6, title: 'AMPLIFIED FIELDS', titleZh: '领域扩张', description: 'Ability radius and width +12%', descriptionZh: '技能范围与宽度 +12%' },
  { id: 'control', maxRank: 6, title: 'LINGERING CONTROL', titleZh: '持久控制', description: 'Control duration +20%', descriptionZh: '控制持续时间 +20%' },
  { id: 'repulse', maxRank: 5, title: 'REPULSE MATRIX', titleZh: '震退矩阵', description: 'Repulse radius and force +15%', descriptionZh: '震退半径与力度 +15%' },
  { id: 'renewal', maxRank: 5, title: 'VERDANT RENEWAL', titleZh: '翠绿复苏', description: 'Heal power +25%', descriptionZh: '治疗量 +25%' },
  { id: 'burning-ground', maxRank: 1, behavior: true, title: 'BURNING GROUND', titleZh: '燃烧之地', description: 'Meteor leaves a damaging fire zone', descriptionZh: '陨石留下持续伤害火区' },
  { id: 'ice-shatter', maxRank: 1, behavior: true, title: 'ICE SHATTER', titleZh: '寒冰碎爆', description: 'Frozen deaths explode', descriptionZh: '冻结敌人死亡时爆炸' },
  { id: 'thunder-chain', maxRank: 1, behavior: true, title: 'EXTRA CHAIN', titleZh: '额外连锁', description: 'Storm Lance chains to 2 targets', descriptionZh: '雷霆长枪额外跳跃 2 个目标' },
  { id: 'relic-link', maxRank: 1, behavior: true, title: 'RELIC LINK', titleZh: '圣物链接', description: 'Heal also restores the Relic', descriptionZh: '治疗同时恢复圣物' }
]);

const FALLBACKS = Object.freeze([
  { id: 'fallback-power', fallback: true, title: 'LAST STAND', titleZh: '背水一战', description: 'All ability damage +5%', descriptionZh: '所有技能伤害 +5%' },
  { id: 'fallback-player', fallback: true, title: 'SECOND WIND', titleZh: '重整旗鼓', description: 'Restore player to full HP', descriptionZh: '玩家生命恢复至满值' },
  { id: 'fallback-relic', fallback: true, title: 'EMERGENCY REPAIR', titleZh: '紧急修复', description: 'Repair 3% Relic HP', descriptionZh: '恢复圣物 3% 生命' }
]);

const RADIUS_KEYS = Object.freeze({
  phoenix: ['impactRadius'],
  singularity: ['zoneRadius'],
  worldtree: ['zoneRadius'],
  ice: ['widthNear', 'width'],
  thunder: ['spreadNear', 'spread'],
  meteor: ['shockRadius'],
  beam: ['radiusNear', 'radius'],
  snare: ['zoneRadius'],
  glacier: ['zoneRadius']
});

export class UpgradeManager extends EventEmitter {
  constructor({ player = null, relic = null } = {}) {
    super();
    this.player = player;
    this.relic = relic;
    this.ranks = new Map();
    this.fallbackPower = 0;
    this.currentOffers = [];
    this.baseRadii = new Map();
    for (const [element, keys] of Object.entries(RADIUS_KEYS)) {
      for (const key of keys) this.baseRadii.set(`${element}.${key}`, settings[element][key]);
    }
  }

  rank(id) {
    return this.ranks.get(id) ?? 0;
  }

  has(id) {
    return this.rank(id) > 0;
  }

  draw(count = 3) {
    const available = UPGRADE_DEFINITIONS.filter((item) => this.rank(item.id) < item.maxRank);
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }
    const offers = available.slice(0, count);
    for (const fallback of FALLBACKS) {
      if (offers.length >= count) break;
      offers.push(fallback);
    }
    this.currentOffers = offers;
    this.emit('upgrade:offered', { offers });
    return offers;
  }

  apply(id) {
    const offer = this.currentOffers.find((item) => item.id === id);
    if (!offer) return null;
    if (id === 'fallback-power') this.fallbackPower++;
    else if (id === 'fallback-player') this.player?.heal(this.player.maxHP);
    else if (id === 'fallback-relic') this.relic?.heal(this.relic.maxHP * 0.03);
    else {
      this.ranks.set(id, this.rank(id) + 1);
      if (id === 'radius') this._syncRadiusSettings();
    }
    this.currentOffers = [];
    const result = { ...offer, rank: this.rank(id) };
    this.emit('upgrade:selected', result);
    return result;
  }

  get damageMultiplier() {
    return 1 + this.rank('power') * settings.upgrades.damagePerRank + this.fallbackPower * 0.05;
  }

  get cooldownMultiplier() {
    return Math.max(settings.upgrades.cooldownFloor, 1 - this.rank('haste') * settings.upgrades.cooldownPerRank);
  }

  get radiusMultiplier() {
    return 1 + this.rank('radius') * settings.upgrades.radiusPerRank;
  }

  get statusMultiplier() {
    return 1 + this.rank('control') * settings.upgrades.statusPerRank;
  }

  get repulseMultiplier() {
    return 1 + this.rank('repulse') * settings.upgrades.repulsePerRank;
  }

  get healMultiplier() {
    return 1 + this.rank('renewal') * settings.upgrades.healPerRank;
  }

  _syncRadiusSettings() {
    const multiplier = this.radiusMultiplier;
    for (const [path, value] of this.baseRadii) {
      const [element, key] = path.split('.');
      settings[element][key] = value * multiplier;
    }
  }

  reset() {
    for (const [path, value] of this.baseRadii) {
      const [element, key] = path.split('.');
      settings[element][key] = value;
    }
    this.ranks.clear();
    this.fallbackPower = 0;
    this.currentOffers = [];
    this.emit('upgrade:reset');
  }
}
