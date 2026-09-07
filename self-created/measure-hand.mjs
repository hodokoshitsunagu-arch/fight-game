/**
 * Measures finger proportions off a photograph of an open hand.
 *
 *   node self-created/measure-hand.mjs <image>
 *
 * The numbers in `src/world/HandRig.js` have to come from somewhere. Invented
 * at a desk they are wrong in ways that only show up on screen — that is how
 * six sign errors landed on one axis, and how all four fingers ended up
 * identical when a real hand's differ by a centimetre and a half.
 *
 * A polar profile does the work. Take the palm centroid, sweep a ray through
 * every angle, and record how far the skin reaches. Fingertips are the local
 * maxima of that curve and the web spaces between fingers are the minima, so
 * one pass gives both the length of each digit and where its base sits, with
 * no landmark detection and nothing to hand-annotate.
 *
 * Reports ratios, not millimetres. The photograph has no scale in it, and the
 * rig's absolute size is already fixed by the frustum solve in
 * `FirstPersonHands` — what it cannot supply is the *proportions*, which is
 * exactly what survives an unknown camera distance.
 */

import { execFileSync } from 'node:child_process';

const SIZE = 720;

const decode = (file) => execFileSync('ffmpeg',
  ['-v', 'error', '-i', file, '-vf', `scale=${SIZE}:${SIZE}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 1 << 28 });

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node self-created/measure-hand.mjs <image>');
    process.exit(1);
  }
  const raw = decode(file);

  // Skin against a black backdrop separates on luma alone; no colour rule needed.
  const mask = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const j = i * 3;
    mask[i] = 0.299 * raw[j] + 0.587 * raw[j + 1] + 0.114 * raw[j + 2] > 60 ? 1 : 0;
  }

  let cx = 0;
  let cy = 0;
  let n = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!mask[y * SIZE + x]) continue;
      cx += x; cy += y; n++;
    }
  }
  if (!n) { console.error('no skin found — check the threshold'); process.exit(1); }
  cx /= n; cy /= n;

  /*
   * The centroid of the whole hand sits well up into the fingers. Pull it back
   * toward the wrist by a quarter of the reach, or the rays leave the palm from
   * between the fingers and the profile has no minima to find.
   */
  const STEPS = 1440;
  const profile = new Float64Array(STEPS);
  const measure = (ox, oy) => {
    for (let s = 0; s < STEPS; s++) {
      const a = (s / STEPS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let r = 0;
      let last = 0;
      for (let t = 1; t < SIZE; t++) {
        const x = Math.round(ox + dx * t);
        const y = Math.round(oy + dy * t);
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) break;
        if (mask[y * SIZE + x]) last = t;
        r = last;
      }
      profile[s] = r;
    }
  };
  measure(cx, cy);
  const reach = Math.max(...profile);
  measure(cx, cy + reach * 0.25);

  // Smooth, so a stray pixel on a fingertip is not a peak of its own.
  const smooth = new Float64Array(STEPS);
  const W = 7;
  for (let s = 0; s < STEPS; s++) {
    let sum = 0;
    for (let d = -W; d <= W; d++) sum += profile[(s + d + STEPS) % STEPS];
    smooth[s] = sum / (2 * W + 1);
  }

  const peaks = [];
  const valleys = [];
  for (let s = 0; s < STEPS; s++) {
    const p = smooth[(s - 1 + STEPS) % STEPS];
    const c = smooth[s];
    const q = smooth[(s + 1) % STEPS];
    if (c > p && c >= q) peaks.push({ s, r: c });
    if (c < p && c <= q) valleys.push({ s, r: c });
  }

  // Keep the five strongest peaks — the digits — and order them by angle.
  const tips = peaks.sort((a, b) => b.r - a.r).slice(0, 5).sort((a, b) => a.s - b.s);
  const webs = valleys.sort((a, b) => a.r - b.r).slice(0, 4).sort((a, b) => a.s - b.s);

  const deg = (s) => ((s / STEPS) * 360).toFixed(0);
  console.log(`质心 (${cx.toFixed(0)}, ${cy.toFixed(0)})   最大伸展 ${reach.toFixed(0)}px\n`);
  console.log('指尖（按角度排序）');
  for (const t of tips) console.log(`  ${deg(t.s).padStart(4)}°   半径 ${t.r.toFixed(1).padStart(6)}px`);
  console.log('\n指蹼');
  for (const w of webs) console.log(`  ${deg(w.s).padStart(4)}°   半径 ${w.r.toFixed(1).padStart(6)}px`);

  // Finger length ≈ tip radius − the mean of the two web radii flanking it.
  console.log('\n各指长度（tip − 相邻指蹼），归一到最长的一根');
  const lengths = tips.map((t) => {
    const flank = webs.filter((w) => Math.abs(w.s - t.s) < STEPS / 8);
    const base = flank.length ? flank.reduce((a, w) => a + w.r, 0) / flank.length : 0;
    return Math.max(1, t.r - base);
  });
  const longest = Math.max(...lengths);
  tips.forEach((t, i) => {
    console.log(`  ${deg(t.s).padStart(4)}°   ${lengths[i].toFixed(1).padStart(6)}px   `
      + `比值 ${(lengths[i] / longest).toFixed(3)}`);
  });
}

main();
