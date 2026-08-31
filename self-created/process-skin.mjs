/**
 * Turns a generated skin photograph into a tile the hands can actually wear.
 *
 *   node self-created/process-skin.mjs public/self-created/hand-skin.jpg
 *
 * What comes back from an image model is a *photograph of a hand*: a vein
 * running diagonally, a knuckle catching the light, background bleeding into
 * two corners. Every one of those is large-scale structure, and large-scale
 * structure is exactly what a tile must not have — mapped across the mesh and
 * repeated, one vein becomes a grid of veins marching down every finger, which
 * reads worse than the flat colour it replaced.
 *
 * Three passes, in this order:
 *
 *   crop      the middle 80%, which is where the background contamination and
 *             the frame vignette live
 *   flatten   subtract a heavy blur and add the mean back. This is a high-pass:
 *             pores and creases are small and survive, the vein and the lighting
 *             gradient are large and do not. Colour is flattened per channel so
 *             the tint stays put while the shading goes
 *   wrap      blend the tile with a half-offset copy of itself, weighted so the
 *             offset copy carries the tile's edges and the original carries its
 *             centre. Each is continuous exactly where the other is not, so the
 *             result is continuous everywhere
 *
 * The wrap is worth spelling out, because the obvious version is wrong. Rolling
 * by half and cross-fading the two sides of the resulting seam against each
 * other averages a pixel with its mirror image, and that lays a soft symmetric
 * cross through the middle of the tile — measurably seamless, visibly creased.
 * Blending against the offset copy instead costs a little contrast where the
 * weights are even (two independent samples of the same noise, averaged) and
 * leaves no structure behind at all.
 *
 * The script prints the seam mismatch before and after, so a new tile can be
 * judged rather than assumed — same reason `process-panorama.mjs` prints its
 * wrap error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SIZE = 1024;
const CROP = 0.80;
const BLUR = 24;      // luma radius of the low-pass, in pixels of the working tile

const decode = (file, w, h, extra = '') => {
  const vf = [extra, `scale=${w}:${h}`].filter(Boolean).join(',');
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', vf,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
};

const encode = (buf, w, h, out, quality = 3) =>
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', `${w}x${h}`, '-i', 'pipe:0', '-q:v', String(quality), out], { input: buf });

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Mean absolute difference between the two columns that meet when tiled. */
function seamError(buf, w, h) {
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(buf[(y * w) * 3 + c] - buf[(y * w + w - 1) * 3 + c]);
    }
  }
  return sum / (h * 3);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node self-created/process-skin.mjs <image>');
    process.exit(1);
  }
  const inset = Math.round((1 - CROP) / 2 * 100) / 100;
  const crop = `crop=iw*${CROP}:ih*${CROP}:iw*${inset}:ih*${inset}`;

  const src = decode(file, SIZE, SIZE, crop);
  // The low-pass. Done by ffmpeg because a 24px box blur in JavaScript over a
  // megapixel is slow enough to notice and this is not the interesting part.
  const low = decode(file, SIZE, SIZE, `${crop},boxblur=${BLUR}:2`);

  const n = SIZE * SIZE * 3;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i += 3) for (let c = 0; c < 3; c++) mean[c] += src[i + c];
  for (let c = 0; c < 3; c++) mean[c] /= SIZE * SIZE;

  const flat = Buffer.alloc(n);
  for (let i = 0; i < n; i += 3) {
    for (let c = 0; c < 3; c++) flat[i + c] = clamp(src[i + c] - low[i + c] + mean[c]);
  }

  const before = seamError(flat, SIZE, SIZE);

  /*
   * sin² is 0 at both tile edges and 1 at the centre, which is precisely the
   * weight this needs: at an edge the answer is entirely the offset copy, whose
   * pixels there came from the middle of the original and therefore agree
   * across the wrap; at the centre it is entirely the original, which is
   * continuous there and which the offset copy is not.
   */
  const half = SIZE / 2;
  const weight = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    const s = Math.sin((Math.PI * i) / SIZE);
    weight[i] = s * s;
  }

  const pass = (input, axis) => {
    const out = Buffer.alloc(n);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const w = weight[axis === 0 ? x : y];
        const here = (y * SIZE + x) * 3;
        const there = axis === 0
          ? (y * SIZE + ((x + half) % SIZE)) * 3
          : (((y + half) % SIZE) * SIZE + x) * 3;
        for (let c = 0; c < 3; c++) {
          out[here + c] = clamp(input[here + c] * w + input[there + c] * (1 - w));
        }
      }
    }
    return out;
  };

  const blend = pass(pass(flat, 0), 1);

  const after = seamError(blend, SIZE, SIZE);

  // Keep what the model returned. This used to write over its own input, so a
  // second attempt at the processing meant paying for a second generation.
  const raw = file.replace(/(\.[^.]+)$/, '-raw$1');
  if (!fs.existsSync(raw)) fs.copyFileSync(file, raw);
  encode(blend, SIZE, SIZE, file);

  const detail = (b) => {
    let sum = 0, count = 0;
    for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
      const i = (y * SIZE + x) * 3;
      const lum = (j) => 0.299 * b[j] + 0.587 * b[j + 1] + 0.114 * b[j + 2];
      sum += Math.abs(4 * lum(i) - lum(i - 3) - lum(i + 3) - lum(i - SIZE * 3) - lum(i + SIZE * 3));
      count++;
    }
    return sum / count;
  };

  console.log(path.basename(file));
  console.log(`  接缝误差   ${before.toFixed(1)} → ${after.toFixed(1)}`);
  console.log(`  局部对比   ${detail(src).toFixed(1)} → ${detail(blend).toFixed(1)}  (细节保留)`);
  console.log(`  写出       ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
}

main();
