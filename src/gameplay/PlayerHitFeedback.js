import { Color } from 'three';
import { settings } from '../config/settings.js';

const HIT_FLASH_COLOR = new Color('#ff6670');

/**
 * One global gate for all Zombie attacks. It deliberately owns no HP: an
 * accepted hit only drives animation, a restrained vignette and camera trauma.
 */
export class PlayerHitFeedback {
  constructor(character, {
    flash = null,
    shake = null,
    damageNumbers = null,
    root = globalThis.document?.body
  } = {}) {
    this.character = character;
    this.flash = flash;
    this.shake = shake;
    this.damageNumbers = damageNumbers;
    this.invulnerability = 0;
    this.overlayStrength = 0;
    this.overlay = root?.ownerDocument?.createElement('div') ?? null;
    if (this.overlay) {
      this.overlay.className = 'player-hit-overlay';
      this.overlay.setAttribute('aria-hidden', 'true');
      root.appendChild(this.overlay);
    }
  }

  tryHit(attacker) {
    if (!attacker?.root?.visible || attacker.isDead || this.invulnerability > 0) return false;
    const dx = attacker.position.x - this.character.position.x;
    const dz = attacker.position.z - this.character.position.z;
    const range = settings.enemy.attackHitRange;
    if (dx * dx + dz * dz > range * range) return false;
    if (!this.character.playHitReaction()) return false;

    this.invulnerability = settings.character.hitReactionInvulnerability;
    this.overlayStrength = 1;
    this.damageNumbers?.spawnPlayer(
      this.character.position,
      24 + Math.floor(Math.random() * 17),
      '#ff5d68',
      'damage'
    );
    this.flash?.trigger(HIT_FLASH_COLOR, 0.14, 0.009);
    this.shake?.add(0.075, 4.6, 28);
    return true;
  }

  update(realDt) {
    this.invulnerability = Math.max(0, this.invulnerability - realDt);
    this.overlayStrength *= Math.exp(-settings.character.hitOverlayDecay * realDt);
    if (this.overlayStrength < 0.002) this.overlayStrength = 0;
    if (this.overlay) this.overlay.style.opacity = String(this.overlayStrength);
  }

  /** Temporary super armour for defensive self-casts; presentation only. */
  grantImmunity(duration) {
    this.invulnerability = Math.max(this.invulnerability, Math.max(0, duration));
  }

  reset() {
    this.invulnerability = 0;
    this.overlayStrength = 0;
    if (this.overlay) this.overlay.style.opacity = '0';
  }

  dispose() {
    this.overlay?.remove();
    this.overlay = null;
  }
}
