/**
 * DirectionPad.js — forward, back, left and right, bottom left.
 *
 * Lifted out of the mini map. Sharing the box meant the pad covered the street
 * layout, which is the only thing a 150px map has to say — two controls fighting
 * for the same 150 pixels, and both losing.
 *
 * Standing alone it can be laid out as what it is: a diamond, read at a glance,
 * with each arrow pointing the way it goes.
 *
 * Directions are relative to where the camera looks, not to north. That is the
 * translation the panorama cannot do for itself — Street View knows only compass
 * bearings, and "forward" is a fact about the player.
 */

const KEYS = [
  { deg: 0, cls: 'up', glyph: '▲', label: 'Forward' },
  { deg: 90, cls: 'right', glyph: '▶', label: 'Right' },
  { deg: 180, cls: 'down', glyph: '▼', label: 'Back' },
  { deg: -90, cls: 'left', glyph: '◀', label: 'Left' }
];

export class DirectionPad {
  constructor(root = document.body) {
    /** Set by App: `(relativeDeg) => void`. */
    this.onStep = null;

    this.element = document.createElement('div');
    this.element.className = 'dpad';
    this.element.innerHTML = `
      ${KEYS.map(
        (k) => `<button class="dpad__key dpad__key--${k.cls}" data-dir="${k.deg}"
                   type="button" aria-label="${k.label}">${k.glyph}</button>`
      ).join('')}
      <span class="dpad__hub" aria-hidden="true"></span>`;
    root.appendChild(this.element);

    this.keys = {};
    for (const button of this.element.querySelectorAll('[data-dir]')) {
      this.keys[button.dataset.dir] = button;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!button.disabled) this.onStep?.(Number(button.dataset.dir));
      });
    }
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      this.element.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  /**
   * Light up only what leads somewhere.
   *
   * Dead directions stay drawn rather than disappearing: a pad that changes
   * shape at every junction is harder to use than one that greys out.
   */
  setAvailable({ forward, right, back, left }) {
    const map = { '0': forward, '90': right, '180': back, '-90': left };
    for (const [key, button] of Object.entries(this.keys)) {
      const usable = Boolean(map[key]);
      if (button.disabled === !usable) continue;
      button.disabled = !usable;
      button.classList.toggle('is-available', usable);
    }
  }

  setVisible(visible) {
    this.element.classList.toggle('is-hidden', !visible);
  }

  dispose() {
    this.element.remove();
  }
}
