/**
 * CastOverrides.js — turns recognised modifiers into a parameter patch.
 *
 * Two rules shape everything here:
 *
 * 1. **Never invent fields.** A patch may only contain keys the block already
 *    has, because an ability reads named fields and a stray key is dead weight
 *    at best. Blocks differ a lot (ice has `spikeCount` and 25 colour fields;
 *    phoenix has neither), so every axis resolves against the block in hand.
 *
 * 2. **Colour rotates, it does not flatten.** Setting all 25 of an ice field's
 *    colours to red destroys the effect: the rim highlight, the deep body tint
 *    and the scorch decal all carry different jobs. Instead the whole palette is
 *    rotated by the delta between the block's accent hue and the spoken hue,
 *    which preserves every relationship inside it and still reads unmistakably
 *    as "the red one". Near-greys barely move, which is correct — they are
 *    highlights, not identity.
 */

import { Color } from 'three';
import { settings, ELEMENT_META } from '../config/settings.js';
import { AXIS, fieldsForAxis, colourFields } from './grammar.js';

const _color = new Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _accent = new Color();

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Fields that are fractions by contract and must not be scaled past 1. */
const UNIT_RE = /^(opacity|density|fresnel|crown|rubble|scatter)$|Opacity$/;

/**
 * @param {string} element  ability id
 * @param {Array<{axis: string, dir?: number, hue?: number}>} modifiers
 * @param {object|null} base  patch to build on (for mid-flight merges)
 * @returns {object} a patch of real field names -> values
 */
export function resolve(element, modifiers, base = null) {
  const block = settings[element];
  if (!block || !modifiers?.length) return base ?? {};

  const cfg = settings.voice;
  const patch = { ...(base ?? {}) };

  for (const modifier of modifiers) {
    if (modifier.axis === AXIS.COLOUR) {
      applyColour(patch, block, element, modifier.hue);
      continue;
    }

    const factor = factorFor(cfg, modifier);
    if (factor === 1) continue;

    for (const field of fieldsForAxis(block, modifier.axis)) {
      const authored = block[field];
      const current = patch[field] ?? authored;
      let next = current * factor;

      // Keep the field within reach of the value it was tuned at.
      next = clamp(next, authored * cfg.clampLow, authored * cfg.clampHigh);
      if (UNIT_RE.test(field) && authored <= 1) next = Math.min(next, 1);
      // Counts must stay whole, and at least one.
      if (/Count$/.test(field)) next = Math.max(1, Math.round(next));

      patch[field] = next;
    }

    // Going faster also means getting there sooner. Without this, "swift" moves
    // the front quicker but the wind-up and fade stay put and the cast reads
    // mistimed rather than fast.
    if (modifier.axis === AXIS.TEMPO) {
      for (const field of fieldsForAxis(block, AXIS.DURATION)) {
        const authored = block[field];
        const current = patch[field] ?? authored;
        patch[field] = clamp(current / factor, authored * cfg.clampLow, authored * cfg.clampHigh);
      }
    }
  }

  return patch;
}

function factorFor(cfg, modifier) {
  const up = modifier.dir > 0;
  switch (modifier.axis) {
    case AXIS.SCALE:
      return up ? cfg.scaleUp : cfg.scaleDown;
    case AXIS.TEMPO:
      return up ? cfg.tempoFast : cfg.tempoSlow;
    case AXIS.DURATION:
      return up ? cfg.durationLong : cfg.durationShort;
    case AXIS.INTENSITY:
      return up ? cfg.intensityUp : cfg.intensityDown;
    default:
      return 1;
  }
}

/**
 * Rotate the block's whole palette to a new hue, preserving its internal
 * structure. The rotation is measured from the ability's own accent colour, so
 * "crimson frost lance" lands on red rather than on red-plus-whatever-ice-was.
 */
function applyColour(patch, block, element, hue) {
  const accentHex = ELEMENT_META[element]?.accent ?? '#ffffff';
  _accent.set(accentHex).getHSL(_hsl);
  const delta = hue / 360 - _hsl.h;

  for (const field of colourFields(block)) {
    _color.set(patch[field] ?? block[field]).getHSL(_hsl);
    // A near-grey has no hue worth rotating; leaving it alone keeps highlights
    // and smoke reading as highlights and smoke.
    if (_hsl.s < 0.05) continue;
    _color.setHSL((_hsl.h + delta + 1) % 1, _hsl.s, _hsl.l);
    patch[field] = `#${_color.getHexString()}`;
  }
}

/** A short human label for the HUD: "greater · crimson". */
export function describe(modifiers) {
  return modifiers.map((m) => m.word).filter(Boolean).join(' · ');
}
