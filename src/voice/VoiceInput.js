/**
 * VoiceInput.js — the microphone, and only the microphone.
 *
 * A thin wrapper over the Web Speech API that emits a transcript stream and
 * knows nothing about spells. Everything downstream is driven by `transcript`
 * events, which is what makes `simulate()` a complete substitute for a
 * microphone rather than a test-only shortcut: it feeds the identical path.
 *
 * Three details the API forces on us:
 *
 *  - `onend` fires on its own schedule — silence, a network hiccup, Chrome
 *    deciding it has heard enough. While the key is held we restart.
 *  - `lang` cannot be changed on a live recogniser, so switching between
 *    en-US and zh-CN builds a new one.
 *  - Interim results arrive as the *whole utterance so far*, re-sent and
 *    sometimes revised, which is why the parser downstream is written to be
 *    idempotent.
 *
 * Emits: `transcript` (text, confidence, isFinal), `start`, `stop`, `error`.
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { settings } from '../config/settings.js';

const Recognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
    : null;

export class VoiceInput extends EventEmitter {
  constructor() {
    super();
    this.recognition = null;
    this.listening = false;
    this.wanted = false; // the key is held
    this.lang = settings.voice.lang;
    this.lastError = null;
  }

  /** Whether this browser can hear at all. */
  static get supported() {
    return Recognition !== null;
  }

  get supported() {
    return Recognition !== null;
  }

  _build() {
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = settings.voice.fireOnInterim;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      // Re-read the whole utterance: interim results are cumulative, and the
      // parser is built to tolerate seeing the same words again.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result[0];
        this.emit(
          'transcript',
          alternative.transcript,
          // Chrome reports 0 confidence on interim results; treating that as
          // "unknown" rather than "bad" is what lets early firing work at all.
          result.isFinal ? alternative.confidence : Math.max(alternative.confidence, 1),
          result.isFinal
        );
      }
    };

    recognition.onerror = (event) => {
      this.lastError = event.error;
      // `no-speech` and `aborted` are ordinary push-to-talk outcomes, not faults.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.emit('error', event.error);
      }
    };

    recognition.onend = () => {
      this.listening = false;
      if (this.wanted) {
        // Chrome ends sessions on its own; if the key is still down, keep going.
        this._start();
      } else {
        this.emit('stop');
      }
    };

    return recognition;
  }

  setLanguage(lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    settings.voice.lang = lang;
    // A live recogniser ignores a changed `lang`, so replace it outright.
    const wasWanted = this.wanted;
    this.stop();
    this.recognition = null;
    if (wasWanted) this.start();
  }

  /** Push-to-talk down. */
  start() {
    if (!this.supported) {
      this.emit('error', 'unsupported');
      return false;
    }
    this.wanted = true;
    this.emit('start');
    return this._start();
  }

  _start() {
    this.recognition ??= this._build();
    if (!this.recognition || this.listening) return false;
    try {
      this.recognition.start();
      this.listening = true;
      return true;
    } catch {
      // `start()` throws if the previous session has not finished tearing down.
      // `onend` will restart us, so there is nothing to do here.
      return false;
    }
  }

  /** Push-to-talk up. */
  stop() {
    this.wanted = false;
    if (!this.recognition || !this.listening) {
      this.emit('stop');
      return;
    }
    try {
      this.recognition.stop();
    } catch {
      /* already stopping */
    }
  }

  /**
   * Feed a transcript as though it had been spoken.
   *
   * This is the path used to develop and verify without a microphone, and to
   * exercise voice casting in a headless test. Passing an array delivers the
   * words one at a time, which is how you reproduce the thing that actually
   * matters: a modifier landing on a cast that is already in the air.
   *
   * @param {string|string[]} transcript
   */
  simulate(transcript) {
    const parts = Array.isArray(transcript) ? transcript : [transcript];
    let spoken = '';
    for (const part of parts) {
      spoken = spoken ? `${spoken} ${part}` : part;
      this.emit('transcript', spoken, 1, false);
    }
    this.emit('transcript', spoken, 1, true);
    return spoken;
  }

  dispose() {
    this.wanted = false;
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      try {
        this.recognition.abort();
      } catch {
        /* nothing to abort */
      }
    }
    this.recognition = null;
    this.clear();
  }
}
