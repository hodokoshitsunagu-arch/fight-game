/**
 *   node self-created/process-panorama.mjs raw.jpg public/self-created/name
 *
 * Turns the generated image into an equirectangular pair the engine can use:
 * a strict 2:1 panorama, and a depth map derived from it.
 *
 * The model cannot emit 2:1, and it cannot emit depth at all. Both are fixed
 * here — resampling in a browser canvas because that is the only JPEG decoder
 * available, and deriving depth from the geometry an equirectangular projection
 * already implies plus a skyline traced out of the image itself.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';

// Puppeteer is a dev-time dependency of this script only; it is the JPEG
// decoder and the resampler, nothing more.
const require = createRequire(process.env.PUPPETEER_FROM ?? `${process.cwd()}/`);
const puppeteer = require('puppeteer');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node self-created/process-panorama.mjs <raw.jpg> <public/self-created/name> [eyeHeight=2.2] [ringMetres=38]');
  process.exit(1);
}

const W = 4096;
const H = 2048;
// Eye height the panorama was shot from, metres. It sets the ground distances,
// so it has to match the prompt: a street-level shot is ~2, an overhead one is
// whatever height was asked for.
const EYE = Number(process.argv[4] ?? 2.2);
const NEAR = 4.0;   // must match settings.environment.depthNear
const FAR = 170.0;  // must match settings.environment.depthFar
// Distance to the facades ringing the square.
const RING_M = Number(process.argv[5] ?? 38);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('about:blank');

const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(SRC).toString('base64')}`;

const result = await page.evaluate(async ({ dataUrl, W, H, EYE, NEAR, FAR, RING_M }) => {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  /* ---- 1. resample to a strict 2:1 ---- */
  const colour = document.createElement('canvas');
  colour.width = W;
  colour.height = H;
  const cctx = colour.getContext('2d');
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(img, 0, 0, W, H);

  /* ---- 2. how seamless is the wrap? ---- */
  // The left and right edges of an equirectangular image are the same place.
  // The model was asked for that; this measures whether it obliged, by
  // comparing the two edge columns against a same-distance pair elsewhere.
  const edge = cctx.getImageData(0, 0, 2, H).data;
  const edgeR = cctx.getImageData(W - 2, 0, 2, H).data;
  const midA = cctx.getImageData(Math.floor(W / 2), 0, 2, H).data;
  const midB = cctx.getImageData(Math.floor(W / 2) + 2, 0, 2, H).data;
  const mad = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return s / (a.length / 4 * 3);
  };
  const seamBefore = { wrap: +mad(edge, edgeR).toFixed(1), neighbour: +mad(midA, midB).toFixed(1) };

  /* ---- 2b. close the wrap ---- */
  /*
   * The model was asked to make the edges match and did not, which is the
   * normal outcome — it is painting a picture, not projecting a sphere. Left
   * alone that shows in-engine as a hard vertical line you rotate straight into.
   *
   * The fix spreads the edge error backwards across a band instead of blending
   * two copies of the image over each other: every pixel in the band is shifted
   * by a fraction of the mismatch, ramped to zero at the far end. The edges then
   * meet exactly, detail is preserved because nothing is averaged away, and the
   * correction is a slow colour drift over 3% of the width rather than a line.
   */
  {
    const band = Math.round(W * 0.03);
    const strip = cctx.getImageData(W - band, 0, band, H);
    const left = cctx.getImageData(0, 0, 1, H).data;
    const right = cctx.getImageData(W - 1, 0, 1, H).data;

    for (let y = 0; y < H; y++) {
      const d0 = left[y * 4] - right[y * 4];
      const d1 = left[y * 4 + 1] - right[y * 4 + 1];
      const d2 = left[y * 4 + 2] - right[y * 4 + 2];
      for (let x = 0; x < band; x++) {
        // Smoothstep so the correction eases in rather than starting abruptly.
        const t = x / (band - 1);
        const w = t * t * (3 - 2 * t);
        const i = (y * band + x) * 4;
        strip.data[i] = Math.max(0, Math.min(255, strip.data[i] + d0 * w));
        strip.data[i + 1] = Math.max(0, Math.min(255, strip.data[i + 1] + d1 * w));
        strip.data[i + 2] = Math.max(0, Math.min(255, strip.data[i + 2] + d2 * w));
      }
    }
    cctx.putImageData(strip, W - band, 0);
  }

  const e2 = cctx.getImageData(0, 0, 2, H).data;
  const e2r = cctx.getImageData(W - 2, 0, 2, H).data;
  const seam = { ...seamBefore, wrapAfter: +mad(e2, e2r).toFixed(1) };

  /* ---- 3. trace the skyline ---- */
  // At night the sky is the darkest thing above the horizon and the buildings
  // are the lit thing, so the first bright row down each column is the roofline.
  // Cheap, and far better than assuming a flat wall of buildings.
  const small = document.createElement('canvas');
  const SW = 512;
  const SH = 256;
  small.width = SW;
  small.height = SH;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, SW, SH);
  const px = sctx.getImageData(0, 0, SW, SH).data;

  const lum = (x, y) => {
    const i = (y * SW + x) * 4;
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  };

  const horizonRow = SH / 2;
  const raw = new Float32Array(SW);
  for (let x = 0; x < SW; x++) {
    let roof = horizonRow;
    for (let y = 0; y < horizonRow; y++) {
      if (lum(x, y) > 92) { roof = y; break; }
    }
    raw[x] = roof;
  }
  // Median across a window: a bright cloud or a raindrop should not punch a
  // spike through the skyline.
  const roofline = new Float32Array(SW);
  const R = 6;
  for (let x = 0; x < SW; x++) {
    const window = [];
    for (let d = -R; d <= R; d++) window.push(raw[(x + d + SW) % SW]);
    window.sort((a, b) => a - b);
    roofline[x] = window[R];
  }

  /* ---- 4. build the depth map ---- */
  const RING = RING_M;   // metres to the facades across the crossing
  const SKY = FAR;

  const depth = document.createElement('canvas');
  depth.width = W;
  depth.height = H;
  const dctx = depth.getContext('2d');
  const out = dctx.createImageData(W, H);

  for (let y = 0; y < H; y++) {
    const v = 1 - 2 * (y + 0.5) / H;
    const phi = (v * Math.PI) / 2;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let x = 0; x < W; x++) {
      let distance;
      if (sinPhi < -1e-3) {
        /*
         * Below the horizon is road. Its true distance is not a guess — the
         * projection fixes it from the elevation angle — but true is not what
         * is wanted here.
         *
         * At street level the ground directly underfoot is two metres away and
         * the ground at a grazing angle is hundreds, and a sphere with 128 rows
         * of latitude cannot span that without smearing the lower hemisphere
         * into streaks. It also does not need to: the play area has its own
         * floor covering everything close in, so the only road that is ever
         * seen is the far part. Clamping the range keeps the geometry stable
         * and costs nothing that was ever visible.
         */
        /*
         * The floor stops the range from collapsing, not the ceiling.
         *
         * From street level the road underfoot is two metres away and the road
         * at a grazing angle is hundreds, and a sphere with 128 rows of latitude
         * smears that into streaks — so the near end is clamped. From an
         * overhead capture the nearest ground is already tens of metres away and
         * nothing needs clamping, which is why the bound is tied to the eye
         * height rather than fixed. Capping the far end as well, as an earlier
         * version did, flattened the road into a ring and pushed it out of frame.
         */
        distance = Math.min(Math.max(EYE / -sinPhi, Math.max(EYE, 12)), FAR);
      } else {
        const roof = roofline[Math.floor((x / W) * SW)] / SH; // 0..1 from top
        const roofPhi = (1 - 2 * roof) * (Math.PI / 2);
        if (phi > roofPhi) {
          distance = SKY;
        } else {
          // Facade: slant range to a ring at RING metres.
          distance = Math.min(RING / Math.max(cosPhi, 1e-3), FAR);
        }
      }
      const enc = Math.round(255 * (NEAR / Math.max(distance, NEAR)));
      const i = (y * W + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = enc;
      out.data[i + 3] = 255;
    }
  }
  dctx.putImageData(out, 0, 0);

  return {
    seam,
    colour: colour.toDataURL('image/jpeg', 0.92),
    depth: depth.toDataURL('image/png')
  };
}, { dataUrl, W, H, EYE, NEAR, FAR, RING_M });

const save = (dataUri, path) => {
  fs.writeFileSync(path, Buffer.from(dataUri.split(',')[1], 'base64'));
  return (fs.statSync(path).size / 1024 / 1024).toFixed(2);
};

const cMb = save(result.colour, `${OUT}.jpg`);
const dMb = save(result.depth, `${OUT}_depth.png`);

console.log(`panorama  ${OUT}.jpg        ${W}x${H}  ${cMb} MB`);
console.log(`depth     ${OUT}_depth.png  ${W}x${H}  ${dMb} MB`);
console.log(`seam  before ${result.seam.wrap}  ->  after ${result.seam.wrapAfter}   (adjacent columns differ by ${result.seam.neighbour})`);
console.log(result.seam.wrapAfter <= result.seam.neighbour * 1.5
  ? '  -> the wrap is now as continuous as any two neighbouring columns'
  : '  -> still visible; widen the correction band');

await browser.close();
