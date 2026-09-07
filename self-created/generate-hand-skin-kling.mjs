/**
 * Regenerates the high-fidelity hands' skin textures through Kling.
 *
 *   node self-created/generate-hand-skin-kling.mjs --i-approve-paid-generation
 *
 * Replaces what `generate-hand-skin.mjs` produces. That script's output is a
 * soft orange wash: mean |Laplacian| 2.2 across the tile, and a luma range of
 * 158..188 — thirty levels out of 255. On geometry it reads as a tint and
 * nothing more, so the high tier was paying for a texture fetch and getting a
 * flat colour. For scale, an ordinary photograph of a hand measures 10.4 on
 * the same metric.
 * Skin reads as skin because of pores and creases at the scale of a millimetre,
 * and that is what this asks for specifically.
 *
 * Text to image, no reference photograph fed in. Kling will happily take an
 * input image, and the hand references that shaped `HandPoses.js` are sitting
 * right there — but a texture derived from somebody's photograph is that
 * photograph, processed, and this build is public. Pose *numbers* measured off
 * a reference are ours; pixels traceable to it are not. Same line as before.
 *
 * Costs money per call, which is why the approval flag is positional and
 * explicit rather than an environment variable that could be left set.
 *
 * Reads KLING_* from the WorldX environment file. The key is held in memory
 * only — never logged, never written out, never put in a URL, and scrubbed from
 * any error text before it is printed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'self-created');

/**
 * Where the Kling client lives.
 *
 * Imported rather than reimplemented: it already handles the JWT-less bearer
 * auth, the submit-then-poll shape of the API, the retry classification and a
 * concurrency limiter, and a second copy of all that would drift from the first
 * one within a week. Overridable because the sibling checkout is not guaranteed
 * to be beside this one.
 */
const WORLDX = process.env.WORLDX_DIR || path.resolve(ROOT, '..', 'WorldX');

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

/** Never let a key reach a log, however the error was constructed. */
const scrub = (text) => String(text).replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<redacted>');

const TILES = [
  {
    name: 'hand-skin.jpg',
    prompt:
      'Extreme macro photograph of human skin on the back of a hand, filling the '
      + 'entire frame edge to edge. Fine pore structure, shallow diamond-shaped '
      + 'creases, faint downy hair, subtle mottling between warmer and cooler '
      + 'patches. Even diffuse studio light, no shadows cast across the surface, '
      + 'no highlights, no fingers, no nails, no hand silhouette, no background — '
      + 'surface only, flat and evenly lit like a material sample.'
  },
  {
    name: 'hand-skin-bump.jpg',
    prompt:
      'Greyscale height map of human skin surface detail: pores as small dark '
      + 'pits, creases as fine dark lines forming an irregular diamond network, '
      + 'mid grey base. Neutral grey throughout, no colour, no lighting, no cast '
      + 'shadows, filling the whole frame as a flat material sample.'
  }
];

async function main() {
  if (!process.argv.includes('--i-approve-paid-generation')) {
    console.error(
      'This calls a paid image API. Re-run with --i-approve-paid-generation '
      + `to confirm ${TILES.length} generations.`
    );
    process.exit(1);
  }

  const env = { ...readEnv(path.join(WORLDX, '.env')), ...process.env };
  if (!env.KLING_API_KEY) {
    console.error(`KLING_API_KEY not found. Looked in ${path.join(WORLDX, '.env')}; `
      + 'set WORLDX_DIR if that checkout is elsewhere.');
    process.exit(1);
  }

  const { generateKlingImage } =
    await import(path.join(WORLDX, 'shared', 'kling-image-provider.mjs'));

  fs.mkdirSync(OUT, { recursive: true });

  for (const tile of TILES) {
    process.stdout.write(`${tile.name} … `);
    try {
      const result = await generateKlingImage({
        prompt: tile.prompt,
        aspectRatio: '1:1',
        apiKey: env.KLING_API_KEY,
        model: env.KLING_IMAGE_MODEL,
        approvePaidGeneration: true
      });
      const target = path.join(OUT, tile.name);
      fs.writeFileSync(target, result.buffer);
      console.log(`${(result.buffer.length / 1024).toFixed(0)}KB ${result.mimeType}`);
    } catch (error) {
      console.log('failed');
      console.error(scrub(error?.message ?? error));
      process.exitCode = 1;
    }
  }
}

main();
