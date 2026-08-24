/**
 * grammar.js — the spoken vocabulary, derived rather than declared.
 *
 * Spell entries are generated from `ELEMENT_META`, so adding an ability to the
 * registry adds it to the grammar too and the two can never drift apart. The
 * only hand-written part is the modifier lexicon, which is genuinely editorial.
 *
 * The important design point is the **trigger token**. Three abilities share a
 * noun ("Frost Lance" / "Storm Lance") and two share a family ("Glacial Crown"
 * against Frost Lance), so matching the full name would either fire late or fire
 * wrong. Every spell therefore declares the single earliest word that identifies
 * it uniquely — `frost`, `storm`, `glacial` — and that word is what fires the
 * cast. Full names still parse; they just resolve on their first distinct word.
 * This is also what makes firing on an interim result safe: a distinguishing
 * token cannot later be revised into a different spell.
 */

import { ELEMENT_META } from '../config/settings.js';

/**
 * The word that uniquely identifies each ability, chosen as early in the spoken
 * name as ambiguity allows. Verified exhaustively distinct by test.
 */
const TRIGGER = {
  ice: 'frost',
  thunder: 'storm',
  meteor: 'cinder',
  beam: 'nova',
  snare: 'voltaic',
  glacier: 'glacial',
  void: 'rift',
  phoenix: 'phoenix',
  singularity: 'gravity',
  worldtree: 'worldroot'
};

/**
 * Extra ways people actually say these out loud, plus rescues for words the
 * recogniser reliably mishears. "Voltaic" in particular comes back as "voltage"
 * or "photographic" often enough to be worth catching.
 */
const ALIASES = {
  ice: ['frost lance', 'ice lance', 'frostlance'],
  thunder: ['storm lance', 'lightning', 'thunder', 'stormlance'],
  meteor: ['cinder fall', 'meteor', 'cinderfall'],
  beam: ['nova beam', 'beam', 'novabeam'],
  snare: ['voltaic snare', 'snare', 'voltage', 'voltaic'],
  glacier: ['glacial crown', 'glacier', 'crown'],
  void: ['rift sever', 'rift', 'sever'],
  phoenix: ['solar phoenix', 'phoenix', 'solar'],
  singularity: ['gravity singularity', 'singularity', 'gravity'],
  worldtree: ['worldroot bloom', 'worldroot', 'world root', 'bloom']
};

/** Chinese trigger tokens, taken from the labels the HUD already ships. */
const ZH_ALIASES = {
  ice: ['冰霜长枪', '冰霜', '冰枪'],
  thunder: ['雷霆长枪', '雷霆', '闪电'],
  meteor: ['烬火天降', '烬火', '陨石'],
  beam: ['新星光束', '新星', '光束'],
  snare: ['伏特陷阱', '伏特', '陷阱'],
  glacier: ['冰川王冠', '冰川', '王冠'],
  void: ['裂隙斩', '裂隙'],
  phoenix: ['太阳凤凰', '凤凰'],
  singularity: ['引力奇点', '引力', '奇点'],
  worldtree: ['世界树绽放', '世界树', '绽放']
};

/**
 * Modifier axes.
 *
 * `fields` is a predicate over the field names a block actually has, not a
 * fixed list — ability blocks differ wildly (ice has 25 colour fields and
 * `spikeCount`; phoenix has neither) and hardcoding per-ability lists would rot
 * the first time an ability was retuned. Matching by name pattern means a new
 * ability picks up modifier support for free.
 */
export const AXIS = {
  SCALE: 'scale',
  TEMPO: 'tempo',
  DURATION: 'duration',
  COLOUR: 'colour',
  INTENSITY: 'intensity'
};

/** Fields no modifier may ever touch, whatever it matches. */
const PROTECTED = new Set(['minRange', 'cooldown', 'castAnim', 'quality']);

const SCALE_RE = /^(width|height|range|zoneRadius|radius)$|(Size|Length|Span|Reach|Radius|Width|Height|Count)$/;
const TEMPO_RE = /^speed$|(Speed)$/;
const DURATION_RE = /^(lifetime)$|(Time|Lifetime|Duration)$/;
const INTENSITY_RE = /^(opacity|density|fresnel|distortion|translucency|envIntensity)$|(Rate|Intensity|Glow|Flash|Opacity)$/;

const AXIS_MATCHERS = {
  [AXIS.SCALE]: SCALE_RE,
  [AXIS.TEMPO]: TEMPO_RE,
  [AXIS.DURATION]: DURATION_RE,
  [AXIS.INTENSITY]: INTENSITY_RE
};

/**
 * Which numeric fields of a block an axis applies to.
 * `Count` fields land in SCALE deliberately: more spikes reads as a bigger
 * spell, not a denser one.
 */
export function fieldsForAxis(block, axis) {
  const matcher = AXIS_MATCHERS[axis];
  if (!matcher || !block) return [];
  return Object.keys(block).filter(
    (key) => typeof block[key] === 'number' && !PROTECTED.has(key) && matcher.test(key)
  );
}

/** Every `#rrggbb` field on a block. */
export function colourFields(block) {
  return Object.keys(block).filter(
    (key) => typeof block[key] === 'string' && /^#[0-9a-f]{6}$/i.test(block[key])
  );
}

/**
 * The modifier lexicon. `dir` is which way the axis moves; colour carries a
 * target hue in degrees instead.
 */
export const MODIFIERS = {
  // scale
  greater: { axis: AXIS.SCALE, dir: 1 },
  massive: { axis: AXIS.SCALE, dir: 1 },
  huge: { axis: AXIS.SCALE, dir: 1 },
  grand: { axis: AXIS.SCALE, dir: 1 },
  lesser: { axis: AXIS.SCALE, dir: -1 },
  tiny: { axis: AXIS.SCALE, dir: -1 },
  minor: { axis: AXIS.SCALE, dir: -1 },
  // tempo
  swift: { axis: AXIS.TEMPO, dir: 1 },
  quick: { axis: AXIS.TEMPO, dir: 1 },
  rapid: { axis: AXIS.TEMPO, dir: 1 },
  slow: { axis: AXIS.TEMPO, dir: -1 },
  heavy: { axis: AXIS.TEMPO, dir: -1 },
  // duration
  lingering: { axis: AXIS.DURATION, dir: 1 },
  enduring: { axis: AXIS.DURATION, dir: 1 },
  fleeting: { axis: AXIS.DURATION, dir: -1 },
  brief: { axis: AXIS.DURATION, dir: -1 },
  // intensity
  brilliant: { axis: AXIS.INTENSITY, dir: 1 },
  blazing: { axis: AXIS.INTENSITY, dir: 1 },
  dense: { axis: AXIS.INTENSITY, dir: 1 },
  dim: { axis: AXIS.INTENSITY, dir: -1 },
  faint: { axis: AXIS.INTENSITY, dir: -1 },
  sparse: { axis: AXIS.INTENSITY, dir: -1 },
  // colour — hue in degrees
  crimson: { axis: AXIS.COLOUR, hue: 0 },
  red: { axis: AXIS.COLOUR, hue: 0 },
  amber: { axis: AXIS.COLOUR, hue: 38 },
  golden: { axis: AXIS.COLOUR, hue: 48 },
  emerald: { axis: AXIS.COLOUR, hue: 140 },
  green: { axis: AXIS.COLOUR, hue: 140 },
  azure: { axis: AXIS.COLOUR, hue: 205 },
  blue: { axis: AXIS.COLOUR, hue: 220 },
  violet: { axis: AXIS.COLOUR, hue: 280 },
  purple: { axis: AXIS.COLOUR, hue: 285 },
  magenta: { axis: AXIS.COLOUR, hue: 320 }
};

/** Chinese modifier lexicon, same axes. */
export const ZH_MODIFIERS = {
  巨大: { axis: AXIS.SCALE, dir: 1 },
  强化: { axis: AXIS.SCALE, dir: 1 },
  微小: { axis: AXIS.SCALE, dir: -1 },
  迅捷: { axis: AXIS.TEMPO, dir: 1 },
  缓慢: { axis: AXIS.TEMPO, dir: -1 },
  持久: { axis: AXIS.DURATION, dir: 1 },
  短暂: { axis: AXIS.DURATION, dir: -1 },
  明亮: { axis: AXIS.INTENSITY, dir: 1 },
  暗淡: { axis: AXIS.INTENSITY, dir: -1 },
  赤红: { axis: AXIS.COLOUR, hue: 0 },
  翠绿: { axis: AXIS.COLOUR, hue: 140 },
  蔚蓝: { axis: AXIS.COLOUR, hue: 205 },
  紫色: { axis: AXIS.COLOUR, hue: 285 },
  金色: { axis: AXIS.COLOUR, hue: 48 }
};

/**
 * Build the lookup the parser walks: token -> { kind, element | modifier }.
 * Longer aliases are decomposed to their words so a multi-word name still
 * resolves on whichever word arrives first.
 */
export function buildLexicon(lang = 'en-US') {
  const zh = lang.startsWith('zh');
  const spells = new Map();
  const modifiers = new Map();

  for (const element of Object.keys(ELEMENT_META)) {
    if (zh) {
      for (const alias of ZH_ALIASES[element] ?? []) spells.set(alias, element);
    } else {
      spells.set(TRIGGER[element], element);
      for (const alias of ALIASES[element] ?? []) {
        spells.set(alias.toLowerCase(), element);
        // A multi-word alias also registers its distinguishing word alone.
        for (const word of alias.toLowerCase().split(/\s+/)) {
          if (!spells.has(word) && isDistinct(word, element)) spells.set(word, element);
        }
      }
    }
  }

  const table = zh ? ZH_MODIFIERS : MODIFIERS;
  for (const [word, spec] of Object.entries(table)) modifiers.set(word.toLowerCase(), spec);

  return { spells, modifiers, zh };
}

/** True when `word` maps to exactly one ability across every English alias. */
function isDistinct(word, element) {
  let owner = null;
  for (const [el, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      if (alias.toLowerCase().split(/\s+/).includes(word)) {
        if (owner && owner !== el) return false;
        owner = el;
      }
    }
  }
  return owner === element;
}

/** Split a transcript into comparable tokens. Chinese has no spaces to split on. */
export function tokenize(transcript, zh = false) {
  const clean = String(transcript ?? '').toLowerCase().replace(/[.,!?;:]/g, ' ').trim();
  if (!clean) return [];
  return zh ? [clean] : clean.split(/\s+/).filter(Boolean);
}

export { TRIGGER, ALIASES, ZH_ALIASES, PROTECTED };
