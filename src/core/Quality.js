import { settings } from '../config/settings.js';

/** Runtime quality multipliers. They scale budgets, never authored values. */
export const QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({ particles: 1, instances: 1, samples: 1, pixelRatio: 1.75 }),
  medium: Object.freeze({ particles: 0.7, instances: 0.75, samples: 0.75, pixelRatio: 1.5 }),
  low: Object.freeze({ particles: 0.4, instances: 0.5, samples: 0.5, pixelRatio: 1.25 })
});

export function qualityProfile() {
  return QUALITY_PROFILES[settings.global.quality] ?? QUALITY_PROFILES.high;
}

export function qualityCount(value, kind = 'instances', minimum = 0) {
  return Math.max(minimum, Math.round(value * qualityProfile()[kind]));
}

export function qualitySamples(value, minimum = 1) {
  return Math.max(minimum, Math.round(value * qualityProfile().samples));
}

/** Evenly retain a quality-scaled subset without biasing ordered role groups. */
export function qualityVisibleIndex(index, total, kind = 'instances') {
  if (total <= 0) return false;
  const wanted = Math.min(total, qualityCount(total, kind));
  return Math.floor(((index + 1) * wanted) / total) !== Math.floor((index * wanted) / total);
}
