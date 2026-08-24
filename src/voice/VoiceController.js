/**
 * VoiceController.js — microphone to cast.
 *
 * Owns the whole spoken path and nothing else: it holds the push-to-talk key,
 * drives the parser, resolves a target, casts, and keeps a handle on the cast
 * for as long as trailing modifiers are still allowed to reach it.
 *
 * That handle is the interesting part. Because the engine re-reads its
 * parameters every frame, an ability already travelling across the arena will
 * pick up a new colour or a new size on the very next frame — so a modifier
 * heard after the spell name still lands, and the effect visibly answers you
 * while you are still talking. The mutation window closes after
 * `settings.voice.mutationWindow` seconds, or as soon as the cast finishes.
 *
 * Emits: `listening` (bool), `cast` (element, modifiers), `mutate` (modifier),
 * `transcript` (text, isFinal), `miss` (text), `error` (kind).
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { settings, ELEMENT_META } from '../config/settings.js';
import { VoiceInput } from './VoiceInput.js';
import { IntentParser } from './IntentParser.js';
import { TargetSelector } from './TargetSelector.js';
import { resolve } from './CastOverrides.js';

export class VoiceController extends EventEmitter {
  /**
   * @param {object} deps { abilities, camera, enemies, character, cooldowns }
   */
  constructor({ abilities, camera, enemies, character, canCast = () => true, onCast = null }) {
    super();
    this.abilities = abilities;
    this.canCast = canCast;
    this.onCast = onCast;

    this.input = new VoiceInput();
    this.parser = new IntentParser(settings.voice.lang);
    this.targets = new TargetSelector({ camera, enemies, character });

    /** The cast trailing modifiers still reach, and how long it has left. */
    this.live = null;
    this.liveElement = null;
    this.liveModifiers = [];
    this.mutationRemaining = 0;

    this.listening = false;
    this.transcript = '';
    this.heldKey = false;

    this._bind();
  }

  get supported() {
    return this.input.supported;
  }

  _bind() {
    this.input.on('transcript', (text, confidence, isFinal) => {
      this.transcript = text;
      this.emit('transcript', text, isFinal);
      if (isFinal) this.parser.finish(text, confidence);
      else this.parser.feed(text, confidence);

      // Nothing in the finished utterance matched anything we know.
      if (isFinal && !this.parser.element) this.emit('miss', text);
    });

    this.input.on('start', () => this._setListening(true));
    this.input.on('stop', () => this._setListening(false));
    this.input.on('error', (kind) => this.emit('error', kind));

    this.parser.on('spell', (element, carried) => this._cast(element, carried));
    this.parser.on('modifier', (modifier) => this._mutate(modifier));
  }

  _setListening(value) {
    if (this.listening === value) return;
    this.listening = value;
    this.emit('listening', value);
  }

  /* ---------------------------------------------------------------- */
  /* Push to talk                                                      */
  /* ---------------------------------------------------------------- */

  pressToTalk() {
    if (this.heldKey || !settings.voice.enabled) return;
    this.heldKey = true;
    // Re-sync rather than plumbing a change hook: the language can move from the
    // editor dropdown, a loaded preset or the console, and a recogniser built
    // for the wrong locale simply hears nothing.
    if (settings.voice.lang !== this.input.lang) this.setLanguage(settings.voice.lang);
    this.transcript = '';
    this.parser.reset();
    this.input.start();
  }

  releaseToTalk() {
    if (!this.heldKey) return;
    this.heldKey = false;
    this.input.stop();
  }

  setLanguage(lang) {
    this.input.setLanguage(lang);
    this.parser.setLanguage(lang);
  }

  /* ---------------------------------------------------------------- */
  /* Casting                                                           */
  /* ---------------------------------------------------------------- */

  _cast(element, carriedModifiers) {
    if (!this.canCast(element)) return;

    const modifiers = [...carriedModifiers];
    const overrides = modifiers.length ? resolve(element, modifiers) : null;
    const { origin, direction, distance } = this.targets.solve(element);

    const ability = this.abilities.cast(origin, direction, distance, element, overrides);
    if (!ability) return;

    this.live = ability;
    this.liveElement = element;
    this.liveModifiers = modifiers;
    this.mutationRemaining = settings.voice.mutationWindow;

    this.onCast?.(element, ability);
    this.emit('cast', element, modifiers, ELEMENT_META[element]?.label ?? element);
  }

  /** A modifier arrived after the cast — reshape the effect in flight. */
  _mutate(modifier) {
    if (!this.live || !this.liveElement) return;
    if (this.live.isFinished || !this.live.isActive) {
      this._dropLive();
      return;
    }

    this.liveModifiers.push(modifier);
    // Rebuild from the full modifier list rather than patching the patch, so a
    // second colour replaces the first instead of rotating an already-rotated
    // palette twice.
    const overrides = resolve(this.liveElement, this.liveModifiers);
    this.live.setOverrides(overrides);
    this.emit('mutate', modifier, this.liveModifiers);
  }

  _dropLive() {
    this.live = null;
    this.liveElement = null;
    this.liveModifiers = [];
    this.mutationRemaining = 0;
  }

  update(dt) {
    if (!this.live) return;
    this.mutationRemaining -= dt;
    if (this.mutationRemaining <= 0 || this.live.isFinished) this._dropLive();
  }

  /** Speak without a microphone. See `VoiceInput.simulate`. */
  simulate(transcript) {
    this.parser.reset();
    return this.input.simulate(transcript);
  }

  dispose() {
    this.input.dispose();
    this.parser.clear();
    this._dropLive();
    this.clear();
  }
}
