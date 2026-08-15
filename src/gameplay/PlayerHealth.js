import { settings } from '../config/settings.js';
import { EventEmitter } from '../utils/EventEmitter.js';

export class PlayerHealth extends EventEmitter {
  constructor(position) {
    super();
    this.position = position;
    this.maxHP = settings.player.maxHP;
    this.currentHP = this.maxHP;
    this.isDowned = false;
    this.respawnRemaining = 0;
    this.invulnerability = 0;
  }

  get healthPercent() {
    return this.maxHP > 0 ? this.currentHP / this.maxHP : 0;
  }

  get isTargetable() {
    return !this.isDowned && this.currentHP > 0;
  }

  damage(amount, source = null) {
    if (!this.isTargetable || this.invulnerability > 0) return 0;
    const applied = Math.max(0, Math.min(this.currentHP, Number(amount) || 0));
    if (applied <= 0) return 0;
    this.currentHP -= applied;
    this.emit('player:damage', { amount: applied, source, currentHP: this.currentHP });
    if (this.currentHP <= 0) this.down(source);
    return applied;
  }

  heal(amount) {
    if (this.isDowned) return 0;
    const applied = Math.max(0, Math.min(this.maxHP - this.currentHP, Number(amount) || 0));
    if (applied <= 0) return 0;
    this.currentHP += applied;
    this.emit('player:heal', { amount: applied, currentHP: this.currentHP });
    return applied;
  }

  down(source = null) {
    if (this.isDowned) return false;
    this.currentHP = 0;
    this.isDowned = true;
    this.respawnRemaining = settings.player.respawnDelay;
    this.invulnerability = 0;
    this.emit('player:down', { source, duration: this.respawnRemaining });
    return true;
  }

  update(dt, respawnPosition) {
    this.invulnerability = Math.max(0, this.invulnerability - dt);
    if (!this.isDowned) return false;
    this.respawnRemaining = Math.max(0, this.respawnRemaining - dt);
    if (this.respawnRemaining > 0) return false;
    this.respawn(respawnPosition);
    return true;
  }

  respawn(respawnPosition) {
    if (respawnPosition) this.position.copy(respawnPosition);
    this.currentHP = Math.max(1, Math.round(this.maxHP * settings.player.respawnHealthPercent));
    this.isDowned = false;
    this.respawnRemaining = 0;
    this.invulnerability = settings.player.respawnInvulnerability;
    this.emit('player:respawn', { currentHP: this.currentHP, invulnerability: this.invulnerability });
  }

  reset(position = null) {
    if (position) this.position.copy(position);
    this.maxHP = settings.player.maxHP;
    this.currentHP = this.maxHP;
    this.isDowned = false;
    this.respawnRemaining = 0;
    this.invulnerability = 0;
    this.emit('player:reset', { currentHP: this.currentHP });
  }
}
