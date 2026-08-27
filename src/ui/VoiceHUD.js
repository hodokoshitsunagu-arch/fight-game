/**
 * VoiceHUD.js — the microphone, and proof that the voice is doing the work.
 *
 * Two jobs:
 *
 * 1. **The mic button.** On a phone there is no key to hold, so the whole
 *    push-to-talk gesture lives here: press and hold the button at the bottom
 *    of the screen, speak, let go. It is the primary control of this build, so
 *    it is thumb-sized and sits where a thumb already is.
 *
 * 2. **Showing the mechanism.** Without the transcript and the chips, a spoken
 *    cast is indistinguishable from someone tapping a spell off camera. A
 *    modifier that lands *after* the cast is marked separately, because that is
 *    the part worth seeing.
 *
 * Styling lives in `styles.css` alongside the rest of the UI; only per-cast
 * accent colours are set inline, since those come from `ELEMENT_META`.
 */

import { ELEMENT_META } from '../config/settings.js';

const MIC_ICON = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5Z"
          fill="currentColor"/>
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18.5V22"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

export class VoiceHUD {
  constructor(root) {
    this.root = root;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'voice-hud';
    this.wrapper.innerHTML = `
      <div class="voice-hud__readout">
        <div class="voice-hud__transcript" data-voice-transcript></div>
        <div class="voice-hud__chips" data-voice-chips></div>
      </div>
      <button class="voice-hud__help-btn" data-voice-help type="button"
              aria-label="How to play">?</button>
      <div class="voice-hud__controls">
        <button class="voice-hud__mic" data-voice-mic type="button"
                aria-label="Hold to speak">
          <span class="voice-hud__mic-ring" aria-hidden="true"></span>
          <span class="voice-hud__mic-icon">${MIC_ICON}</span>
        </button>
      </div>
      <div class="voice-hud__hint" data-voice-hint>长按说话 · HOLD TO SPEAK</div>`;

    root.appendChild(this.wrapper);

    this.micButton = this.wrapper.querySelector('[data-voice-mic]');
    this.helpButton = this.wrapper.querySelector('[data-voice-help]');
    this.hint = this.wrapper.querySelector('[data-voice-hint]');
    this.transcriptEl = this.wrapper.querySelector('[data-voice-transcript]');
    this.chips = this.wrapper.querySelector('[data-voice-chips]');

    /** Set by App: start and stop listening. */
    this.onTalkStart = null;
    this.onTalkEnd = null;
    /** Set by App: open the how-to-play panel. */
    this.onHelp = null;

    this._hideTimer = 0;
    this._accent = '#8fb7ff';
    this._talking = false;

    this._bindMic();
    this.helpButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onHelp?.();
    });
  }

  /**
   * Press-and-hold, built on pointer events so one path covers touch, pen and
   * mouse.
   *
   * `setPointerCapture` is the important part: without it, sliding a thumb a few
   * pixels off the button loses the release event and the mic stays open. Every
   * exit route ends the turn, because a microphone stuck on is much worse than
   * one that stops early.
   */
  _bindMic() {
    const start = (event) => {
      // Stops the long-press text callout and the synthetic mouse events iOS
      // fires after a touch.
      event.preventDefault();
      event.stopPropagation();
      if (this._talking) return;
      this._talking = true;
      try {
        this.micButton.setPointerCapture(event.pointerId);
      } catch {
        /* capture is a nicety, not a requirement */
      }
      this.micButton.classList.add('is-talking');
      this.onTalkStart?.();
    };

    const end = (event) => {
      event?.preventDefault();
      event?.stopPropagation();
      if (!this._talking) return;
      this._talking = false;
      this.micButton.classList.remove('is-talking');
      this.onTalkEnd?.();
    };

    this.micButton.addEventListener('pointerdown', start);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.micButton.addEventListener(type, end);
    }
    // A dropped pointer (tab hidden, call comes in) must not leave it listening.
    window.addEventListener('blur', () => end());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) end();
    });
    // Belt and braces on iOS, which still emits touch events alongside pointer.
    this.micButton.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.micButton.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setVisible(visible) {
    this.wrapper.classList.toggle('is-hidden', !visible);
  }

  setSupported(supported) {
    if (supported) return;
    this.micButton.disabled = true;
    this.micButton.classList.add('is-unsupported');
    this.hint.textContent = '语音需要 Chrome / Edge · VOICE NEEDS CHROME';
  }

  setListening(listening) {
    this.micButton.classList.toggle('is-listening', listening);
    this.hint.textContent = listening
      ? '在听… · LISTENING'
      : '长按说话 · HOLD TO SPEAK';
    if (listening) {
      this.transcriptEl.textContent = '';
      this.chips.innerHTML = '';
      this._accent = '#8fb7ff';
      this._hideTimer = 0;
      this.transcriptEl.style.color = '';
    }
  }

  setTranscript(text) {
    this.transcriptEl.textContent = text;
    this.transcriptEl.classList.toggle('is-visible', Boolean(text));
  }

  /** A spell fired. Highlight it in its own accent colour. */
  showCast(element, modifiers) {
    const meta = ELEMENT_META[element];
    this._accent = meta?.accent ?? '#8fb7ff';
    this.transcriptEl.style.color = this._accent;
    this.chips.innerHTML = '';
    this._addChip(meta?.label ?? element, true);
    for (const modifier of modifiers) this._addChip(modifier.word, false);
    this._hideTimer = 2.8;
  }

  /** A modifier landed on a cast already in flight — mark it as late. */
  showMutation(modifier) {
    this._addChip(modifier.word, false, true);
    this._hideTimer = 2.8;
  }

  showMiss(text) {
    if (!text) return;
    this.transcriptEl.style.color = '#8b93a3';
    this._hideTimer = 1.5;
  }

  _addChip(label, primary, late = false) {
    const chip = document.createElement('span');
    chip.className = `voice-chip${primary ? ' voice-chip--primary' : ''}${late ? ' voice-chip--late' : ''}`;
    chip.textContent = late ? `+ ${label}` : label;
    if (primary) {
      chip.style.borderColor = this._accent;
      chip.style.color = this._accent;
      chip.style.background = `${this._accent}22`;
    }
    this.chips.appendChild(chip);
  }

  update(dt) {
    if (this._hideTimer <= 0) return;
    this._hideTimer -= dt;
    if (this._hideTimer <= 0) {
      this.transcriptEl.classList.remove('is-visible');
      this.chips.innerHTML = '';
      this.transcriptEl.style.color = '';
    }
  }

  dispose() {
    this.wrapper.remove();
  }
}
