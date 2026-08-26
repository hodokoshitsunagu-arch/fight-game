/**
 * Calls the configured image model for an equirectangular panorama.
 *
 *   node tools/generate-panorama.mjs out-raw.jpg "your prompt"
 *
 * Then run `tools/process-panorama.mjs` on the result: the model cannot emit
 * 2:1, cannot make the edges wrap, and cannot produce depth, and that script
 * fixes all three.
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

/*
 * The user's prompt, plus the projection requirements.
 *
 * Image models do not natively think in equirectangular, so the geometry has to
 * be spelled out: 2:1, horizon on the centre line, the left and right edges
 * being the same place. Whether it actually obeys is checked afterwards by
 * measuring the seam — the prompt is a request, not a guarantee.
 */
const SUBJECT = process.argv[3] ?? '东京涉谷十字路口,雨夜街头的 360 度全景等距矩形图像。';

const PROMPT = [
  SUBJECT,
  '',
  'Equirectangular 360x180 panorama (VR photosphere), strict 2:1 aspect ratio.',
  'The horizon must sit exactly on the horizontal centre line.',
  'The far-left and far-right edges must be the same place, so the image wraps',
  'seamlessly when tiled horizontally.',
  'Photographic, cinematic, high detail, no text overlays, no watermark, no logo,',
  'no fisheye circle, no little-planet effect.'
].join('\n');

const url = `${BASE}/models/${MODEL}:generateContent`;

const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9' }
    }
  })
});

if (!response.ok) {
  const text = await response.text();
  // Scrub anything key-shaped before this reaches a log.
  console.error('HTTP', response.status, text.replace(/AIza[\w-]+/g, '<key>').slice(0, 1200));
  process.exit(1);
}

const data = await response.json();
const parts = data?.candidates?.[0]?.content?.parts ?? [];
const image = parts.find((p) => p.inlineData || p.inline_data);

if (!image) {
  console.error('no image in response:', JSON.stringify(data).slice(0, 900));
  process.exit(1);
}

const inline = image.inlineData ?? image.inline_data;
const buffer = Buffer.from(inline.data, 'base64');
const out = process.argv[2] ?? path.join(ROOT, 'panorama-raw.jpg');
fs.writeFileSync(out, buffer);

// PNG and JPEG carry their size in different places; read whichever this is.
function dimensions(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'png' };
  }
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), kind: 'jpeg' };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0, kind: 'unknown' };
}

const d = dimensions(buffer);
console.log(`saved ${out}`);
console.log(`mime  ${inline.mimeType ?? inline.mime_type}`);
console.log(`size  ${d.w}x${d.h} (${d.kind})  ratio ${(d.w / d.h).toFixed(3)}  ${(buffer.length / 1024).toFixed(0)} KB`);
