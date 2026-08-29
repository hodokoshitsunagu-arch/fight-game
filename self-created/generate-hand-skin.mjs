/**
 * Generates the skin textures the high-fidelity hands are built from.
 *
 *   node self-created/generate-hand-skin.mjs
 *
 * Writes seamless tiles into `public/self-created/`. These are generated from a
 * text prompt and are the project's own assets — the reference videos were used
 * to derive pose *numbers* in `HandPoses.js` and nothing from them is shipped.
 *
 * A tile rather than a painted hand, deliberately. Mapping a photograph of a
 * hand onto this geometry would fight it at every seam and read worse than the
 * flat colour it replaced; skin detail applied across the whole mesh, with the
 * anatomy carried by geometry and shading, is what actually raises fidelity.
 *
 * Reads IMAGE_GEN_* from `.env` (gitignored). The key is held in memory only —
 * never logged, never written out, never put in a URL, and scrubbed out of any
 * error text before it is printed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const BASE = env.IMAGE_GEN_BASE_URL;
const MODEL = env.IMAGE_GEN_MODEL;
const KEY = env.IMAGE_GEN_API_KEY;

if (!BASE || !MODEL || !KEY) {
  console.error('IMAGE_GEN_BASE_URL / IMAGE_GEN_MODEL / IMAGE_GEN_API_KEY must be set in .env');
  process.exit(1);
}

/*
 * Stylised rather than photoreal, for two reasons.
 *
 * A photoreal skin request comes back refused as recitation — the model will
 * not produce it — and even if it did, it would sit badly against a world
 * whose enemies and props are flat-shaded blocks. A hand-painted tile matches
 * the art it has to live next to.
 */
const TILE = [
  'Hand-painted stylised texture tile, warm tan colour, for a low-poly video game character.',
  'Soft mottled variation between light tan and slightly deeper tan, gentle painterly',
  'brush texture, very subtle fine lines.',
  'Completely flat and evenly lit — no shadows, no highlights, no gradients across the frame.',
  'Abstract surface only: no figures, no body parts, no objects, no background, no text.',
  'Fills the frame edge to edge and tiles seamlessly on all four sides.'
].join('\n');

const ROUGH = [
  'Seamless tileable grayscale bump map of human skin micro-surface.',
  'Mid grey base. Pores as small dark speckles, creases as fine darker lines.',
  'No colour, no shading, no lighting, no hand shape, no text.',
  'Fills the frame edge to edge and tiles seamlessly on all four sides.'
].join('\n');

async function generate(prompt, outFile) {
  const response = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '1:1' }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('HTTP', response.status, text.replace(/AIza[\w-]+/g, '<key>').slice(0, 800));
    return false;
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData || p.inline_data);
  if (!image) {
    console.error('no image in response:', JSON.stringify(data).slice(0, 600));
    return false;
  }

  const inline = image.inlineData ?? image.inline_data;
  const buffer = Buffer.from(inline.data, 'base64');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buffer);
  console.log(`${path.relative(ROOT, outFile)}  ${(buffer.length / 1024).toFixed(0)}KB`);
  return true;
}

const dir = path.join(ROOT, 'public', 'self-created');
const ok1 = await generate(TILE, path.join(dir, 'hand-skin.jpg'));
const ok2 = await generate(ROUGH, path.join(dir, 'hand-skin-bump.jpg'));
process.exit(ok1 && ok2 ? 0 : 1);
