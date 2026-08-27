import { settings } from '../config/settings.js';

/**
 * StatusBar.js — health and mana, one row, top left.
 *
 * One row rather than two stacked bars, because it has to sit at the same
 * height as the scene selector and the spell strip: the three of them make the
 * top edge of the screen, and a status block twice as tall as its neighbours
 * breaks that line.
 *
 * Numbers sit inside the bars rather than beside them. A phone has no width to
 * spare for labels, and a bar without a number is a vague feeling rather than a
 * readout.
 */

const BARS = [
  { key: 'hp', label: 'HP', className: 'status-bar__fill--hp' },
  { key: 'mp', label: 'MP', className: 'status-bar__fill--mp' }
];

export class StatusBar {
  constructor(root = document.body) {
    this.element = document.createElement('div');
    this.element.className = 'status-bar';
    this.element.innerHTML = BARS.map(
      (bar) => `
      <div class="status-bar__track" data-track="${bar.key}">
        <i class="status-bar__fill ${bar.className}" data-fill="${bar.key}"></i>
        <span class="status-bar__label">${bar.label}</span>
        <span class="status-bar__value" data-value="${bar.key}">—</span>
      </div>`
    ).join('');
    root.appendChild(this.element);

    this.fills = {};
    this.values = {};
    for (const bar of BARS) {
      this.fills[bar.key] = this.element.querySelector(`[data-fill="${bar.key}"]`);
      this.values[bar.key] = this.element.querySelector(`[data-value="${bar.key}"]`);
    }
    this._shown = {};
  }

  /**
   * @param {{current:number,max:number}} hp
   * @param {{current:number,max:number}} mp
   *
   * Writes only what changed. This runs every frame, and a style write per bar
   * per frame is two layout invalidations per frame for numbers that move a
   * few times a second.
   */
  update(hp, mp) {
    this._set('hp', hp);
    this._set('mp', mp);
  }

  _set(key, source) {
    if (!source) return;
    const max = Math.max(1, source.max);
    const ratio = Math.max(0, Math.min(1, source.current / max));
    const rounded = Math.round(ratio * 1000) / 1000;
    /*
     * The current value only, not `current/max`.
     *
     * "300/300" needs about 48px beside a two-letter label, and the track is 44
     * on a phone — it overflowed and sat on top of the label. The bar already
     * shows the ratio, which is what the max was for; the number is here to give
     * the absolute. The full pair stays in the tooltip.
     */
    const text = String(Math.ceil(source.current));

    const previous = this._shown[key];
    if (previous?.ratio !== rounded) {
      this.fills[key].style.transform = `scaleX(${rounded})`;
      // Low health is the one state worth colouring differently — it is the
      // only one where the number needs to interrupt.
      this.element.classList.toggle(`is-${key}-low`, rounded < 0.3);
    }
    if (previous?.text !== text) {
      this.values[key].textContent = text;
      this.values[key].parentElement.title = `${Math.ceil(source.current)} / ${Math.round(max)}`;
    }
    this._shown[key] = { ratio: rounded, text };
  }

  setVisible(visible) {
    this.element.classList.toggle('is-hidden', !visible);
  }

  dispose() {
    this.element.remove();
  }
}
