import { settings } from '../config/settings.js';

const NEXT_QUALITY = Object.freeze({ high: 'medium', medium: 'low', low: 'low' });

export class PerformanceQualityController {
  constructor(onChange = null) {
    this.onChange = onChange;
    this.frames = 0;
    this.windowTime = 0;
    this.lowTime = 0;
    this.cooldown = 0;
    this.fps = 60;
  }

  update(dt, active) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!settings.performance.autoQuality || !active || dt <= 0) {
      this.frames = 0;
      this.windowTime = 0;
      this.lowTime = 0;
      return;
    }
    this.frames++;
    this.windowTime += dt;
    if (this.windowTime < 1) return;
    this.fps = this.frames / this.windowTime;
    if (this.fps < settings.performance.lowFpsThreshold) this.lowTime += this.windowTime;
    else this.lowTime = Math.max(0, this.lowTime - this.windowTime * 1.5);
    this.frames = 0;
    this.windowTime = 0;
    if (this.lowTime < settings.performance.lowFpsDuration || this.cooldown > 0) return;
    const current = settings.global.quality;
    const next = NEXT_QUALITY[current] ?? current;
    this.lowTime = 0;
    this.cooldown = settings.performance.changeCooldown;
    if (next === current) return;
    settings.global.quality = next;
    this.onChange?.(next, this.fps);
  }

  resetWindow() {
    this.frames = 0;
    this.windowTime = 0;
    this.lowTime = 0;
  }
}
