import { settings } from '../config/settings.js';

/**
 * Mana.js — a cast resource, so the second bar means something.
 *
 * This did not exist. The project had player health and nothing else, and a
 * status bar with a decorative half is worse than one with a single honest
 * half — it reads as a number until someone notices it never moves.
 *
 * So it is real: casting spends it, time returns it. What it deliberately does
 * *not* do by default is refuse a cast. The point of this build is to say a
 * spell and watch it happen, and a resource that can stop that is a worse
 * trade than a bar that occasionally sits empty. `blocksCasting` turns it into
 * a real constraint for anyone who wants one.
 */
export class Mana {
  constructor() {
    this.max = settings.player.maxMP;
    this.current = this.max;
  }

  get percent() {
    return this.max > 0 ? this.current / this.max : 0;
  }

  /** @returns {boolean} whether the cast may proceed. */
  spend(amount = settings.player.castCost) {
    const affordable = this.current >= amount;
    this.current = Math.max(0, this.current - amount);
    return affordable || !settings.player.manaBlocksCasting;
  }

  canAfford(amount = settings.player.castCost) {
    if (!settings.player.manaBlocksCasting) return true;
    return this.current >= amount;
  }

  update(dt) {
    this.max = settings.player.maxMP;
    if (this.current < this.max) {
      this.current = Math.min(this.max, this.current + settings.player.manaRegen * dt);
    }
  }

  refill() {
    this.current = this.max;
  }
}
