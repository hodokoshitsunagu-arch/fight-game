/**
 * SceneSelector.js — the dropdown that moves you across the world.
 *
 * Top centre, because that is the only edge left: the spell strip owns the
 * right, the microphone owns the bottom. Collapsed it is one row naming where
 * you are; tapped, it drops the whole list.
 *
 * Switching a scene is a network operation against somebody's paid quota, so
 * two things follow. It is debounced, because a list of ten is a list you can
 * hammer. And it shows progress, because the tiles for a remote landmark take
 * seconds to arrive and a UI that just sits there reads as broken.
 */

import { SCENES } from '../config/scenes.js';

const SWITCH_DEBOUNCE_MS = 800;

export class SceneSelector {
  constructor(root = document.body) {
    /** Set by App: `(scene) => Promise<boolean>`. */
    this.onSelect = null;

    this.open = false;
    this.current = null;
    this._busy = false;
    this._lastSwitch = 0;

    this.element = document.createElement('div');
    this.element.className = 'scene-selector';
    this.element.innerHTML = `
      <button class="scene-selector__current" data-toggle type="button" aria-expanded="false">
        <span class="scene-selector__flag" data-flag>🌍</span>
        <span class="scene-selector__name" data-name>选择场景</span>
        <i class="scene-selector__chevron" aria-hidden="true"></i>
      </button>
      <div class="scene-selector__progress" data-progress aria-hidden="true"><i></i></div>
      <div class="scene-selector__list" data-list role="listbox">
        <button class="scene-selector__resume" data-resume type="button" hidden>
          ↩ 回到战役
        </button>
        ${SCENES.map(
          (scene) => `
          <button class="scene-selector__item" data-scene="${scene.id}" type="button" role="option">
            <span class="scene-selector__flag">${scene.flag}</span>
            <span class="scene-selector__item-text">
              <b>${scene.zh}</b>
              <small>${scene.place}</small>
            </span>
          </button>`
        ).join('')}
      </div>`;

    root.appendChild(this.element);

    this.toggle = this.element.querySelector('[data-toggle]');
    this.list = this.element.querySelector('[data-list]');
    this.flagEl = this.element.querySelector('[data-flag]');
    this.nameEl = this.element.querySelector('[data-name]');
    this.progress = this.element.querySelector('[data-progress]');
    this.resumeButton = this.element.querySelector('[data-resume]');
    /** Set by App: return to the campaign node the player left. */
    this.onResume = null;
    this.resumeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(false);
      this.onResume?.();
    });

    this._bind();
  }

  _bind() {
    this.toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(!this.open);
    });

    for (const item of this.list.querySelectorAll('[data-scene]')) {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        this._choose(item.dataset.scene);
      });
    }

    // Three ways out. Leaving any of them off strands somebody in the list.
    document.addEventListener('pointerdown', (event) => {
      if (this.open && !this.element.contains(event.target)) this.setOpen(false);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) this.setOpen(false);
    });

    // The HUD above the canvas is pointer-events:none; these have to opt in,
    // and their taps must not fall through and cast a spell underneath.
    for (const type of ['pointerdown', 'pointerup']) {
      this.element.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  setOpen(open) {
    this.open = open;
    this.element.classList.toggle('is-open', open);
    this.toggle.setAttribute('aria-expanded', String(open));
  }

  /**
   * Offer the way back into the campaign.
   *
   * Picking a place by hand is free roam, and free roam stops the campaign —
   * without this the only route back would be a page reload.
   */
  setResumeVisible(visible) {
    this.resumeButton.hidden = !visible;
  }

  /** @param {import('../config/scenes.js').SCENES[number]} scene */
  setCurrent(scene) {
    this.current = scene;
    this.flagEl.textContent = scene.flag;
    this.nameEl.textContent = scene.zh;
    for (const item of this.list.querySelectorAll('[data-scene]')) {
      item.classList.toggle('is-current', item.dataset.scene === scene.id);
    }
  }

  async _choose(id) {
    const scene = SCENES.find((s) => s.id === id);
    if (!scene || scene.id === this.current?.id) {
      this.setOpen(false);
      return;
    }

    // Every switch is a billed Street View request, and a ten-item list is a
    // list somebody will hammer.
    const now = performance.now();
    if (this._busy || now - this._lastSwitch < SWITCH_DEBOUNCE_MS) {
      this.setOpen(false);
      return;
    }
    this._lastSwitch = now;

    const previous = this.current;
    this.setOpen(false);
    this._setBusy(true);
    // Show the destination immediately — the wait belongs to the place you are
    // going, not the one you are leaving.
    this.setCurrent(scene);

    let ok = false;
    try {
      ok = (await this.onSelect?.(scene)) ?? false;
    } catch {
      ok = false;
    }

    this._setBusy(false);
    if (ok) {
      this.showBlurb(scene);
    } else {
      // Put the label back rather than leaving it claiming somewhere you are
      // not.
      if (previous) this.setCurrent(previous);
      this.showMessage(`${scene.zh}暂时无法加载`);
    }
  }

  _setBusy(busy) {
    this._busy = busy;
    this.element.classList.toggle('is-busy', busy);
  }

  /** The scene's own line, once it is actually on screen. */
  showBlurb(scene) {
    this.showMessage(scene.blurb, 5200);
  }

  showMessage(text, duration = 2600) {
    this._blurb ??= (() => {
      const el = document.createElement('div');
      el.className = 'scene-blurb';
      document.body.appendChild(el);
      return el;
    })();

    this._blurb.textContent = text;
    this._blurb.classList.add('is-visible');
    clearTimeout(this._blurbTimer);
    this._blurbTimer = setTimeout(() => this._blurb.classList.remove('is-visible'), duration);
  }

  dispose() {
    this.element.remove();
    this._blurb?.remove();
    clearTimeout(this._blurbTimer);
  }
}
