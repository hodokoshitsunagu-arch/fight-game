import { ELEMENT_META } from '../config/settings.js';
import { settings } from '../config/settings.js';

/**
 * PronunciationScore.js — how well was that said?
 *
 * Two signals, because neither is enough alone:
 *
 *   confidence   what the recogniser thinks of its own answer. Honest about
 *                audio quality — noise, distance, a swallowed ending — and
 *                completely blind to whether it heard the right word.
 *   similarity   how close the heard text is to the spell's actual name.
 *                Catches "force lands" for "frost lance", which the recogniser
 *                is perfectly confident about.
 *
 * A cast that fired is never cancelled by a bad score. The spell already left
 * your hands — taking it back would punish the player for the recogniser's
 * opinion, arriving half a second late. It is scaled instead: a mumbled Frost
 * Lance is a smaller, dimmer, shorter Frost Lance, and a clean one is bigger
 * than the baseline. The feedback is in the thing you are already watching.
 *
 * Chrome reports 0 confidence on interim results, so scoring only ever runs on
 * a final one — which is also when the whole phrase is available to compare.
 */

/** Levenshtein distance, iterative with a single row. */
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current.slice();
  }
  return previous[b.length];
}

/** 1 for identical, 0 for nothing in common. */
function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return Math.max(0, 1 - distance(a, b) / longest);
}

const normalise = (text) => (text ?? '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');

/**
 * The best window of the utterance to judge against the name.
 *
 * People say more than the spell — "uh, greater frost lance please" — and
 * comparing the whole utterance to "frostlance" would score a perfectly good
 * cast at 0.4 for the crime of politeness. So the name is matched against the
 * closest same-length stretch of what was said.
 */
function bestWindow(heard, target) {
  if (heard.length <= target.length) return similarity(heard, target);
  let best = 0;
  // A window either side of the exact length absorbs a dropped or doubled
  // syllable without needing a second pass.
  for (let width = Math.max(1, target.length - 2); width <= target.length + 2; width++) {
    for (let start = 0; start + width <= heard.length; start++) {
      best = Math.max(best, similarity(heard.slice(start, start + width), target));
      if (best === 1) return 1;
    }
  }
  return best;
}

/** Every name this element answers to, in the language being spoken. */
function namesFor(element, lang) {
  const meta = ELEMENT_META[element];
  if (!meta) return [];
  return lang?.startsWith('zh')
    ? [meta.zhLabel].filter(Boolean)
    : [meta.label].filter(Boolean);
}

/**
 * @param {{transcript: string, element: string|null, confidence: number, lang: string}} utterance
 * @returns {{score: number, confidence: number, similarity: number, passed: boolean}}
 */
export function scoreUtterance({ transcript, element, confidence = 0, lang = 'en-US' }) {
  const cfg = settings.voice.scoring;

  // Nothing recognised at all is the clearest possible fail — there is no
  // partial credit for a phrase that matched no spell.
  if (!element) {
    return { score: 0, confidence: Math.max(0, Math.min(1, confidence)), similarity: 0, passed: false };
  }

  const heard = normalise(transcript);
  const match = namesFor(element, lang).reduce(
    (best, name) => Math.max(best, bestWindow(heard, normalise(name))),
    0
  );

  /*
   * Similarity gates, confidence trims — not a symmetric blend.
   *
   * Weighting the two evenly got both interesting cases backwards: a confident
   * mishearing ("force lands" for "frost lance", similarity 0.40) passed at
   * 0.69, while a perfect "frost lance" in a noisy room failed at 0.59. Those
   * are precisely the two judgements that matter, so the shape has to be
   * "did you say the right word", scaled by "how sure was the microphone" —
   * never the other way around.
   */
  const clamped = Math.max(0, Math.min(1, confidence));
  const score = match * (1 - cfg.confidenceInfluence + cfg.confidenceInfluence * clamped);

  return {
    score: Math.max(0, Math.min(1, score)),
    confidence: clamped,
    similarity: match,
    passed: score >= cfg.passMark
  };
}

/**
 * Turn a score into a multiplier for the cast.
 *
 * Deliberately never zero and never enormous: the worst recognised cast is
 * still a cast, and the best is a noticeable but not game-breaking step up
 * from the baseline the whole game is tuned around.
 */
export function scaleForScore(score) {
  const cfg = settings.voice.scoring;
  return cfg.minScale + (cfg.maxScale - cfg.minScale) * Math.max(0, Math.min(1, score));
}
