/**
 * Live verification for the v2 campaign's 80 authored Street View anchors.
 *
 * Dry inventory (free):
 *   node self-created/verify-city-chapters.mjs
 *
 * Live Maps checks (billable; dev/preview server + key in .env required):
 *   PUPPETEER_FROM=/path/to/node_modules node self-created/verify-city-chapters.mjs --live
 *
 * The script never persists panorama ids. It checks coordinate resolution,
 * drift, official outdoor attribution and greedy linked travel for `walk`
 * segments. A failing segment should stay a visible `cut` at runtime until a
 * nearby candidate passes a later verification run.
 */
import { createRequire } from 'node:module';
import { CITY_CHAPTERS, TOTAL_CULTURAL_ANCHORS, validateCityChapters } from '../src/campaign/cityChapters.js';

const live = process.argv.includes('--live');
const errors = validateCityChapters();
const inventory = {
  chapters: CITY_CHAPTERS.length,
  anchors: TOTAL_CULTURAL_ANCHORS,
  walkSegments: CITY_CHAPTERS.flatMap((chapter) => chapter.anchors).filter((anchor) => anchor.transition === 'walk').length,
  schemaErrors: errors
};

if (!live) {
  console.log(JSON.stringify({ mode: 'dry-run', ...inventory, next: 'Pass --live to make billable Google Maps checks.' }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
} else {
  if (errors.length) throw new Error(`Content schema is invalid: ${errors.join('; ')}`);
  const require = createRequire(process.env.PUPPETEER_FROM ?? `${process.cwd()}/`);
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader']
  });
  const page = await browser.newPage();
  await page.goto(process.env.CAMPAIGN_VERIFY_URL ?? 'http://127.0.0.1:4173/?streetview&campaign=v2', {
    waitUntil: 'domcontentloaded', timeout: 240000
  });
  await page.waitForFunction("document.getElementById('loader')?.classList.contains('is-hidden')", { timeout: 240000 });
  await page.waitForFunction('window.google?.maps?.StreetViewService && window.app?.streetView?.panorama', { timeout: 60000 });

  const compact = CITY_CHAPTERS.map((chapter) => ({
    id: chapter.id,
    anchors: chapter.anchors.map(({ id, name, lat, lng, radius, transition, walkSteps }) =>
      ({ id, name, lat, lng, radius, transition, walkSteps }))
  }));
  const report = await page.evaluate(async (chapters) => {
    const maps = window.google.maps;
    const service = new maps.StreetViewService();
    const panorama = window.app.streetView.panorama;
    const earth = 6371000;
    const rad = Math.PI / 180;
    const distance = (a, b) => {
      const dLat = (b.lat - a.lat) * rad;
      const dLng = (b.lng - a.lng) * rad;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
      return earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    };
    const bearing = (a, b) => {
      const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
      const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
        Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
      return (Math.atan2(y, x) / rad + 360) % 360;
    };
    const waitForPano = async (pano) => {
      panorama.setPano(pano);
      await new Promise((resolve) => {
        const listener = panorama.addListener('pano_changed', () => { listener.remove(); resolve(); });
        setTimeout(resolve, 4500);
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    };
    const resolved = new Map();
    const anchors = [];
    for (const chapter of chapters) {
      for (const anchor of chapter.anchors) {
        const row = { chapterId: chapter.id, ...anchor, ok: false };
        try {
          const { data } = await service.getPanorama({
            location: { lat: anchor.lat, lng: anchor.lng }, radius: anchor.radius,
            source: maps.StreetViewSource.OUTDOOR
          });
          const loc = data?.location;
          if (!loc?.pano || !loc.latLng) throw new Error('no outdoor panorama');
          await waitForPano(loc.pano);
          const p = panorama.getPosition();
          const position = { lat: p.lat(), lng: p.lng() };
          row.driftMeters = Math.round(distance(anchor, position));
          row.links = (panorama.getLinks?.() ?? []).length;
          row.copyright = data.copyright ?? '';
          row.ok = row.driftMeters <= anchor.radius && row.links > 0;
          resolved.set(anchor.id, { pano: loc.pano, position });
        } catch (error) {
          row.reason = String(error?.message ?? error).slice(0, 120);
        }
        anchors.push(row);
      }
    }

    const routes = [];
    for (const chapter of chapters) {
      for (let index = 1; index < chapter.anchors.length; index++) {
        const target = chapter.anchors[index];
        if (target.transition !== 'walk') continue;
        const origin = chapter.anchors[index - 1];
        const start = resolved.get(origin.id);
        const row = { chapterId: chapter.id, from: origin.id, to: target.id, ok: false, steps: 0 };
        if (!start) { row.reason = 'origin unresolved'; routes.push(row); continue; }
        await waitForPano(start.pano);
        const seen = new Set([start.pano]);
        for (let step = 0; step < Math.max(1, target.walkSteps); step++) {
          const p = panorama.getPosition();
          const here = { lat: p.lat(), lng: p.lng() };
          row.driftMeters = Math.round(distance(here, target));
          if (row.driftMeters <= target.radius) { row.ok = true; break; }
          const want = bearing(here, target);
          const links = (panorama.getLinks?.() ?? []).filter((link) => link.pano && !seen.has(link.pano));
          links.sort((a, b) => Math.abs(((a.heading - want + 540) % 360) - 180) - Math.abs(((b.heading - want + 540) % 360) - 180));
          if (!links[0] || Math.abs(((links[0].heading - want + 540) % 360) - 180) > 95) break;
          seen.add(links[0].pano);
          await waitForPano(links[0].pano);
          row.steps++;
        }
        if (!row.ok) row.reason = 'no validated linked route; keep coordinate fallback/cut';
        routes.push(row);
      }
    }
    return { anchors, routes };
  }, compact);

  await browser.close();
  const failedAnchors = report.anchors.filter((row) => !row.ok).length;
  const failedRoutes = report.routes.filter((row) => !row.ok).length;
  console.log(JSON.stringify({ mode: 'live', ...inventory, failedAnchors, failedRoutes, ...report }, null, 2));
  process.exitCode = failedAnchors || failedRoutes ? 1 : 0;
}
