import { settings } from '../config/settings.js';

const TRAITS = ['berserk', 'heavy', 'shielded'];

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export class WaveDirector {
  budgetFor(wave) {
    const c = settings.wave;
    let budget = c.baseBudget + wave * c.linearGrowth + c.nonlinearFactor * Math.pow(wave, c.nonlinearPower);
    if (wave > 1 && wave % 10 === 1) budget *= c.recoveryMultiplier;
    if (wave % 10 === 9) budget *= c.pressureMultiplier;
    return Math.max(1, Math.round(budget));
  }

  generate(wave) {
    const random = mulberry32((wave * 2654435761) >>> 0);
    let budget = this.budgetFor(wave);
    const descriptors = [];
    const add = (archetype, traits = []) => {
      const type = settings.enemyTypes[archetype];
      if (!type || budget + 1e-6 < type.cost) return false;
      budget -= type.cost;
      descriptors.push({ archetype, traits: [...traits], elite: archetype === 'elite', wave });
      return true;
    };

    if (wave >= 5 && wave % 5 === 0) {
      const eliteCount = wave % 10 === 0 ? Math.min(4, 1 + Math.floor(wave / 20)) : 1;
      for (let i = 0; i < eliteCount; i++) {
        const traits = wave >= 8
          ? [TRAITS[i % TRAITS.length], TRAITS[(i + 1) % TRAITS.length]]
          : [];
        add('elite', traits);
      }
    }

    while (budget >= 1) {
      const roll = random();
      let archetype = 'normal';
      const runnerWeight = wave >= 3 ? Math.min(0.42, 0.12 + wave * 0.008 + (wave % 10 === 7 ? 0.18 : 0)) : 0;
      const tankWeight = wave >= 5 ? Math.min(0.28, 0.06 + wave * 0.005) : 0;
      const eliteWeight = wave >= 8 ? Math.min(0.12, (wave - 7) * 0.0025) : 0;
      if (roll < eliteWeight && budget >= settings.enemyTypes.elite.cost) archetype = 'elite';
      else if (roll < eliteWeight + tankWeight && budget >= settings.enemyTypes.tank.cost) archetype = 'tank';
      else if (roll < eliteWeight + tankWeight + runnerWeight && budget >= settings.enemyTypes.runner.cost) archetype = 'runner';

      const traits = [];
      if (archetype === 'elite' && wave >= 8) {
        const first = TRAITS[Math.floor(random() * TRAITS.length)];
        let second = TRAITS[Math.floor(random() * TRAITS.length)];
        if (second === first) second = TRAITS[(TRAITS.indexOf(first) + 1) % TRAITS.length];
        traits.push(first, second);
      } else if (wave >= 15 && random() < Math.min(0.22, (wave - 14) * 0.008)) {
        traits.push(TRAITS[Math.floor(random() * TRAITS.length)]);
      }
      if (!add(archetype, traits)) add('normal');
    }

    return {
      wave,
      budget: this.budgetFor(wave),
      milestone: wave % 10 === 0,
      maxAlive: wave % 10 === 0 ? settings.wave.milestoneMaxAlive : settings.wave.normalMaxAlive,
      descriptors
    };
  }
}
