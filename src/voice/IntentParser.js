/**
 * IntentParser.js — a growing transcript in, cast decisions out.
 *
 * The recogniser does not hand over a sentence; it hands over the same sentence
 * repeatedly, getting longer and occasionally revising what it already said.
 * This class turns that stream into two events that fire exactly once each:
 *
 *   `spell`    — the distinguishing token was heard. Cast now.
 *   `modifier` — another modifier word arrived. Fold it into the live cast.
 *
 * Modifiers spoken *before* the spell name are held and handed over with the
 * spell, so "greater frost lance" spawns already-greater rather than growing a
 * frame later. Modifiers spoken after reach the cast mid-flight.
 *
 * The consumed-token cursor is what makes this idempotent: Chrome re-sends the
 * whole interim transcript each time, and without a cursor every re-send would
 * re-apply every modifier.
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { settings } from '../config/settings.js';
import { buildLexicon, tokenize } from './grammar.js';

export class IntentParser extends EventEmitter {
  constructor(lang = 'en-US') {
    super();
    this.setLanguage(lang);
  }

  setLanguage(lang) {
    this.lang = lang;
    this.lexicon = buildLexicon(lang);
    this.reset();
  }

  /** Start of a fresh utterance — a new push-to-talk press. */
  reset() {
    this.consumed = 0;
    this.element = null;
    this.pending = []; // modifiers heard before the spell name
    this.applied = [];
  }

  /**
   * Feed a transcript. Safe to call with the same text repeatedly.
   *
   * The tail token is consumed like any other rather than held back for a final
   * result. Holding it would be safer against revision but would also defeat the
   * point: the spell name is usually the last thing said, so waiting for a final
   * transcript puts the whole recogniser latency back on the cast. The
   * distinguishing-token grammar is what makes consuming the tail acceptable —
   * `frost` is not going to be revised into `storm`.
   *
   * @param {string} transcript
   * @param {number} confidence 0..1
   */
  feed(transcript, confidence = 1) {
    if (confidence < settings.voice.confidence) return;

    const tokens = tokenize(transcript, this.lexicon.zh);
    if (this.lexicon.zh) {
      this._feedChinese(tokens[0] ?? '');
      return;
    }

    // A revision can shorten the transcript; rewind rather than skip forward.
    if (tokens.length < this.consumed) this.consumed = tokens.length;

    for (let i = this.consumed; i < tokens.length; i++) {
      this._consumeToken(tokens[i]);
      this.consumed = i + 1;
    }
  }

  /** The recogniser settled on a final transcript — nothing more will be revised. */
  finish(transcript, confidence = 1) {
    this.feed(transcript, confidence);
  }

  _consumeToken(token) {
    const modifier = this.lexicon.modifiers.get(token);
    if (modifier) {
      this._addModifier({ ...modifier, word: token });
      return;
    }

    const element = this.lexicon.spells.get(token);
    if (element && !this.element) {
      this.element = element;
      const carried = this.pending;
      this.pending = [];
      this.applied.push(...carried);
      this.emit('spell', element, carried);
    }
  }

  /** Chinese arrives unsegmented, so scan for known substrings instead. */
  _feedChinese(text) {
    for (const [word, spec] of this.lexicon.modifiers) {
      if (text.includes(word) && !this.applied.some((m) => m.word === word)) {
        this._addModifier({ ...spec, word });
      }
    }
    if (this.element) return;
    for (const [alias, element] of this.lexicon.spells) {
      if (text.includes(alias)) {
        this.element = element;
        const carried = this.pending;
        this.pending = [];
        this.applied.push(...carried);
        this.emit('spell', element, carried);
        return;
      }
    }
  }

  _addModifier(modifier) {
    if (this.element) {
      this.applied.push(modifier);
      this.emit('modifier', modifier);
    } else {
      this.pending.push(modifier);
    }
  }
}
