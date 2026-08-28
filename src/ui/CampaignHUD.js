/**
 * CampaignHUD.js — what a run tells you about itself.
 *
 * Four things, each with a different lifetime, which is why they are separate
 * elements rather than one panel:
 *
 *   objective   how many are left, or that the shard is up — always on
 *   hint        the technique this node is teaching — until the node ends
 *   beat        one line of story after a shard — a few seconds
 *   card        arriving somewhere new — a few seconds, over a fade
 *
 * The top band is already full: status bars left, scene selector centre, spell
 * strip right, all 40px from `top: 10px`. So everything here starts below it,
 * and nothing takes pointer events — the whole screen is a look-and-cast
 * surface and the HUD must not steal a tap meant for a relic shard.
 *
 * The off-screen arrow exists because the shard is deliberately placed at a
 * bearing you are not facing. Without it the objective reads as "find it" with
 * no affordance, and a locked-pitch view that can only turn horizontally makes
 * a wrong guess cost a full circle.
 */

export class CampaignHUD {
  constructor(root) {
    this.root = root;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'campaign-hud';
    this.wrapper.innerHTML = `
      <div class="campaign-fade" data-fade></div>
      <div class="campaign-objective" data-objective>
        <span class="campaign-objective__text" data-objective-text></span>
        <span class="campaign-objective__arrow" data-arrow aria-hidden="true">➤</span>
      </div>
      <div class="campaign-hint" data-hint></div>
      <div class="campaign-beat" data-beat></div>
      <div class="campaign-card" data-card>
        <div class="campaign-card__level" data-card-level></div>
        <div class="campaign-card__place" data-card-place></div>
        <div class="campaign-card__body" data-card-body></div>
      </div>`;
    root.appendChild(this.wrapper);

    const q = (name) => this.wrapper.querySelector(`[data-${name}]`);
    this.fadeEl = q('fade');
    this.objectiveEl = q('objective');
    this.objectiveText = q('objective-text');
    this.arrowEl = q('arrow');
    this.hintEl = q('hint');
    this.beatEl = q('beat');
    this.cardEl = q('card');
    this.cardLevel = q('card-level');
    this.cardPlace = q('card-place');
    this.cardBody = q('card-body');

    this._beatTimer = 0;
  }

  setVisible(visible) {
    this.wrapper.classList.toggle('is-hidden', !visible);
  }

  /** @param {{remaining: number, shard: boolean}} state */
  setObjective({ remaining, shard }) {
    if (shard) {
      this.objectiveText.textContent = '拾取碎片 · FIND SHARD';
      this.objectiveEl.classList.add('is-shard');
    } else if (remaining > 0) {
      this.objectiveText.textContent = `剩余 ${remaining}`;
      this.objectiveEl.classList.remove('is-shard');
    } else {
      this.objectiveText.textContent = '';
      this.objectiveEl.classList.remove('is-shard');
    }
    this.objectiveEl.classList.toggle('is-visible', Boolean(shard) || remaining > 0);
    if (!shard) this.arrowEl.classList.remove('is-visible');
  }

  /**
   * Point at the shard while it is off screen.
   *
   * @param {number|null} bearing radians left(-) / right(+) of centre, or null
   */
  setShardBearing(bearing) {
    if (bearing === null || Math.abs(bearing) < 0.35) {
      this.arrowEl.classList.remove('is-visible');
      return;
    }
    this.arrowEl.classList.add('is-visible');
    // Only the side matters; a precise angle on a locked-pitch view is noise.
    this.arrowEl.style.transform = bearing > 0 ? 'scaleX(1)' : 'scaleX(-1)';
  }

  setHint(text) {
    this.hintEl.textContent = text ?? '';
    this.hintEl.classList.toggle('is-visible', Boolean(text));
  }

  setLevel(level, locationIndex, scene) {
    this._level = level;
    this._scene = scene;
    this._locationIndex = locationIndex;
  }

  setProgress() {
    /* The scene selector already shows where you are; a second counter next to
     * it would be two things saying the same thing. Kept as a hook because the
     * director calls it and a progress ring may want it later. */
  }

  showBeat(text) {
    this.beatEl.textContent = text ?? '';
    this.beatEl.classList.add('is-visible');
    this._beatTimer = 3.4;
  }

  showCard(place, body) {
    this.cardLevel.textContent = this._level ? `第 ${this._levelNumber()} 关 · ${this._level.zh}` : '';
    this.cardPlace.textContent = place ?? '';
    this.cardBody.textContent = body ?? '';
    this.cardEl.classList.add('is-visible');
  }

  hideCard() {
    this.cardEl.classList.remove('is-visible');
  }

  showDone(shards) {
    this.setObjective({ remaining: 0, shard: false });
    this.setHint('');
    this.cardLevel.textContent = '战役结束';
    this.cardPlace.textContent = `${shards} 枚遗物碎片`;
    this.cardBody.textContent = '遗物完整了。十个地方，你走过了它们全部。';
    this.cardEl.classList.add('is-visible');
  }

  fade(on) {
    this.fadeEl.classList.toggle('is-on', Boolean(on));
  }

  _levelNumber() {
    return (this._level?.id ? ['first-chime', 'echo', 'fracture', 'undertow', 'resonance']
      .indexOf(this._level.id) + 1 : 1);
  }

  update(dt) {
    if (this._beatTimer <= 0) return;
    this._beatTimer -= dt;
    if (this._beatTimer <= 0) this.beatEl.classList.remove('is-visible');
  }

  dispose() {
    this.wrapper.remove();
  }
}
