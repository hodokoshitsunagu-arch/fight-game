/**
 * Ability sigils for the HUD — drawn inline so they inherit `currentColor` (the
 * slot's `--accent`) and need no image assets.
 *
 * A 100×100 box, stroke only, so the mark reads the same at 34px in the ability
 * slot as it does scaled up.
 */

const WRAP = (body) =>
  `<svg class="glyph-svg" viewBox="0 0 100 100" aria-hidden="true" fill="none"
     stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const VOID = WRAP(`
  <path d="M20 76L76 18M28 84L84 26"/>
  <path d="M40 65L31 53L48 49L44 34M60 42L69 52L54 58L58 73"/>
  <path d="M14 88L33 81M67 19L87 12"/>
`);

const PHOENIX = WRAP(`
  <path d="M50 24C43 39 43 57 50 78C57 57 57 39 50 24Z"/>
  <path d="M47 43C35 30 18 25 8 31C23 38 31 50 43 60"/>
  <path d="M53 43C65 30 82 25 92 31C77 38 69 50 57 60"/>
  <path d="M45 75L34 91M50 77V95M55 75L66 91"/>
`);

const SINGULARITY = WRAP(`
  <circle cx="50" cy="50" r="13" fill="currentColor" stroke="none"/>
  <ellipse cx="50" cy="50" rx="42" ry="17" transform="rotate(-18 50 50)"/>
  <ellipse cx="50" cy="50" rx="31" ry="10" transform="rotate(24 50 50)"/>
  <path d="M15 25L25 30M75 72L87 79"/>
`);

const WORLDTREE = WRAP(`
  <path d="M50 88V43M50 57L31 39M50 49L68 31M50 69L68 58"/>
  <path d="M50 88C39 82 27 83 17 90M50 88C62 80 74 83 86 90"/>
  <circle cx="28" cy="32" r="13"/><circle cx="50" cy="24" r="16"/>
  <circle cx="72" cy="30" r="14"/><circle cx="66" cy="51" r="12"/>
`);

/**
 * Ice — a six-fold snowflake over a rising lance.
 *
 * Three axes at 60°, each with a pair of barbs, and a heavier vertical that runs
 * past the star into a point: the star says frost, the point says skillshot.
 */
const ICE = WRAP(`
  <path d="M50 12V88"/>
  <path d="M17.5 30.5L82.5 69.5"/>
  <path d="M82.5 30.5L17.5 69.5"/>
  <path d="M50 24L41 33M50 24L59 33"/>
  <path d="M50 76L41 67M50 76L59 67"/>
  <path d="M27.5 36.5L27.7 49.2M27.5 36.5L38.5 30.4"/>
  <path d="M72.5 63.5L72.3 50.8M72.5 63.5L61.5 69.6"/>
  <path d="M72.5 36.5L72.3 49.2M72.5 36.5L61.5 30.4"/>
  <path d="M27.5 63.5L27.7 50.8M27.5 63.5L38.5 69.6"/>
`);

/**
 * Thunder — a bolt struck through a pair of arcs.
 *
 * The zigzag is drawn on the same diagonal the cast travels on, and the two
 * open arcs behind it read as the discharge spreading off it. Stroke only, like
 * the snowflake, so the two slots sit at the same visual weight.
 */
const THUNDER = WRAP(`
  <path d="M60 10L30 52H49L40 90L72 45H52L60 10Z"/>
  <path d="M23 26C13 36 11 52 17 65"/>
  <path d="M84 34C90 47 88 63 78 73"/>
`);

/**
 * Meteor — a cracked ball trailing fire.
 *
 * The circle sits forward and low with three seams splitting it, and three
 * tapering streaks run back up the same diagonal the other two sigils are drawn
 * on, so the slot reads as "the rock, thrown" at 34px.
 */
const METEOR = WRAP(`
  <circle cx="62" cy="62" r="24"/>
  <path d="M46 45L58 58L52 72M74 46L66 60L79 72M58 84L64 70"/>
  <path d="M30 70L10 90M40 34L18 22M22 48L4 44"/>
`);

/**
 * Beam — a charge held in a bracket, firing a cone.
 *
 * The orb sits low-left where the other three sigils start their diagonal, two
 * open brackets behind it read as the hands holding it, and three tapering rays
 * open out to the upper right with a single wave threaded through them: the
 * column, and the coil wrapped around it.
 */
const BEAM = WRAP(`
  <circle cx="27" cy="66" r="11"/>
  <path d="M13 55C7 62 7 74 13 81"/>
  <path d="M40 79C47 73 47 61 40 55"/>
  <path d="M41 57L92 20M42 66L94 50M43 75L92 80"/>
  <path d="M46 63C56 49 64 71 74 57C82 46 88 52 93 46"/>
`);

/**
 * Snare — a ring with a bolt standing in it.
 *
 * The only sigil in the set built around a *circle you look into* rather than a
 * diagonal, because that is the one thing this slot has to say before anything
 * else: it is not a skillshot, it is a footprint. The ellipse is the boundary
 * seen in perspective, four arcs step around it where the rim current runs, and
 * the zigzag rises out of the middle.
 */
const SNARE = WRAP(`
  <ellipse cx="50" cy="70" rx="38" ry="15"/>
  <path d="M12 70L4 70M88 70L96 70M31 82L27 89M69 82L73 89"/>
  <path d="M56 18L38 46H50L44 68"/>
  <path d="M50 55L62 40H52L58 26"/>
`);

/**
 * Glacier — a crown of blades standing on a ring.
 *
 * The second sigil built around a *circle you look into*, because it is the
 * second far cast and that is the first thing the slot has to say. Where the
 * Snare stands one bolt in the middle of its ellipse, this one stands the ring
 * itself up: five blades of uneven height rising off the boundary with the
 * spire tallest in the middle, which is the silhouette the ability actually
 * makes.
 */
const GLACIER = WRAP(`
  <ellipse cx="50" cy="74" rx="38" ry="13"/>
  <path d="M9 70L13 41L21 66"/>
  <path d="M24 65L30 31L37 60"/>
  <path d="M42 61L50 15L58 61"/>
  <path d="M63 60L70 31L76 65"/>
  <path d="M79 66L87 41L91 70"/>
`);

const REPULSE = WRAP(`
  <circle cx="50" cy="50" r="12"/>
  <circle cx="50" cy="50" r="27" stroke-dasharray="9 7"/>
  <path d="M50 3V23M50 77V97M3 50H23M77 50H97"/>
  <path d="M16 16L30 30M70 70L84 84M84 16L70 30M30 70L16 84"/>
`);

const HEAL = WRAP(`
  <path d="M50 14V86M14 50H86" stroke-width="13"/>
  <circle cx="50" cy="50" r="39" stroke-dasharray="4 10"/>
  <path d="M25 77C36 68 64 68 75 77M25 23C36 32 64 32 75 23"/>
`);

/** Keyed by the ids in `ELEMENTS`. */
export const ELEMENT_SIGILS = {
  void: VOID,
  phoenix: PHOENIX,
  singularity: SINGULARITY,
  worldtree: WORLDTREE,
  ice: ICE,
  thunder: THUNDER,
  meteor: METEOR,
  beam: BEAM,
  snare: SNARE,
  glacier: GLACIER
};

export const SELF_ABILITY_SIGILS = Object.freeze({
  repulse: REPULSE,
  heal: HEAL
});
