/**
 * VoiceHUD.js — proof that the voice is doing the work.
 *
 * Without this the demo is indistinguishable from someone pressing Q off
 * camera. Showing the live transcript, the word that fired, and each modifier
 * as it lands is what makes the mechanism visible — particularly a modifier
 * arriving *after* the cast, which is the part worth seeing.
 *
 * Plain DOM and inline styles, matching the rest of `src/ui`, so it needs no
 * changes to the stylesheet.
 */

import { ELEMENT_META } from '../config/settings.js';

// Sits just above the ability bar. The bar occupies roughly the bottom third,
// and anything lower puts the transcript straight through the spell cards.
const WRAPPER_STYLE = `
  position:fixed; left:50%; bottom:40%; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; gap:10px;
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif; pointer-events:none;
  z-index:40; transition:opacity .25s ease; opacity:0;`;

export class VoiceHUD {
  constructor(root) {
    this.root = root;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'voice-hud';
    this.wrapper.setAttribute('style', WRAPPER_STYLE);
    this.wrapper.innerHTML = `
      <div data-voice-mic style="
        display:flex; align-items:center; gap:9px; padding:7px 16px; border-radius:999px;
        background:rgba(12,16,24,.72); border:1px solid rgba(255,255,255,.14);
        color:#dfe8f5; font-size:12px; letter-spacing:.14em; text-transform:uppercase;
        backdrop-filter:blur(8px);">
        <span data-voice-dot style="
          width:9px; height:9px; border-radius:50%; background:#48506099;
          box-shadow:0 0 0 0 rgba(255,90,90,.6); transition:background .2s ease;"></span>
        <span data-voice-state>Hold Space to speak</span>
      </div>
      <div data-voice-transcript style="
        min-height:1.4em; padding:0 12px; color:#fff; font-size:26px; font-weight:600;
        letter-spacing:.01em; text-align:center; text-shadow:0 2px 14px rgba(0,0,0,.85);
        opacity:0; transition:opacity .18s ease;"></div>
      <div data-voice-chips style="display:flex; gap:7px; flex-wrap:wrap; justify-content:center;"></div>`;

    root.appendChild(this.wrapper);

    this.mic = this.wrapper.querySelector('[data-voice-mic]');
    this.dot = this.wrapper.querySelector('[data-voice-dot]');
    this.state = this.wrapper.querySelector('[data-voice-state]');
    this.transcriptEl = this.wrapper.querySelector('[data-voice-transcript]');
    this.chips = this.wrapper.querySelector('[data-voice-chips]');

    this._hideTimer = 0;
    this._accent = '#8fb7ff';
    this.setVisible(true);
  }

  setVisible(visible) {
    this.wrapper.style.opacity = visible ? '1' : '0';
  }

  setSupported(supported) {
    if (supported) return;
    this.state.textContent = 'Voice needs Chrome or Edge';
    this.dot.style.background = '#7a2f2f';
  }

  setListening(listening) {
    this.dot.style.background = listening ? '#ff5a5a' : '#48506099';
    this.dot.style.boxShadow = listening
      ? '0 0 0 6px rgba(255,90,90,.16)'
      : '0 0 0 0 rgba(255,90,90,0)';
    this.state.textContent = listening ? 'Listening' : 'Hold Space to speak';
    if (listening) {
      this.transcriptEl.textContent = '';
      this.chips.innerHTML = '';
      this._accent = '#8fb7ff';
      this._hideTimer = 0;
    }
  }

  setTranscript(text) {
    this.transcriptEl.textContent = text;
    this.transcriptEl.style.opacity = text ? '1' : '0';
  }

  /** A spell fired. Highlight the name in its own accent colour. */
  showCast(element, modifiers) {
    const meta = ELEMENT_META[element];
    this._accent = meta?.accent ?? '#8fb7ff';
    this.transcriptEl.style.color = this._accent;
    this.chips.innerHTML = '';
    this._addChip(meta?.label ?? element, this._accent, true);
    for (const modifier of modifiers) this._addChip(modifier.word, this._accent, false);
    this._hideTimer = 2.6;
  }

  /** A modifier landed on a cast already in flight — mark it as late. */
  showMutation(modifier) {
    this._addChip(modifier.word, this._accent, false, true);
    this._hideTimer = 2.6;
  }

  showMiss(text) {
    if (!text) return;
    this.transcriptEl.style.color = '#8b93a3';
    this._hideTimer = 1.4;
  }

  _addChip(label, accent, primary, late = false) {
    const chip = document.createElement('span');
    chip.textContent = late ? `+ ${label}` : label;
    chip.setAttribute(
      'style',
      `padding:4px 11px; border-radius:999px; font-size:12px; letter-spacing:.1em;
       text-transform:uppercase; backdrop-filter:blur(8px);
       border:1px solid ${primary ? accent : 'rgba(255,255,255,.18)'};
       background:${primary ? `${accent}22` : 'rgba(12,16,24,.7)'};
       color:${primary ? accent : '#d7dfec'};
       ${late ? 'animation:none; outline:1px dashed rgba(255,255,255,.25); outline-offset:2px;' : ''}`
    );
    this.chips.appendChild(chip);
  }

  update(dt) {
    if (this._hideTimer <= 0) return;
    this._hideTimer -= dt;
    if (this._hideTimer <= 0) {
      this.transcriptEl.style.opacity = '0';
      this.chips.innerHTML = '';
      this.transcriptEl.style.color = '#fff';
    }
  }

  dispose() {
    this.wrapper.remove();
  }
}
