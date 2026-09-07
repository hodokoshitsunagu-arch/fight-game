/**
 * verify-scenes.mjs — check coordinates for *walkable* Street View coverage.
 *
 *   PUPPETEER_FROM=/path/to/dir/ node self-created/verify-scenes.mjs
 *   (needs `npm run preview` or the dev server running, and a Maps key in .env)
 *
 * Three things must all be true, and checking only one is how a location that
 * cannot be walked ends up on a scene list:
 *
 *   links >= 2    there is a road graph here, so walking actually goes somewhere
 *   copyright     Google's car coverage, not somebody's uploaded photosphere —
 *                 photospheres are standalone and their link count is always 0
 *   drift < 200m  the resolved panorama is still at the place that was asked for
 *
 * Seven of eighteen candidates failed one of these, including every Egyptian,
 * Turkish, Moroccan and Thai landmark tried, and the whole of mainland China.
 *
 * Worth re-running: Google retires panoramas, so a coordinate that verifies
 * today can stop resolving later.
 */
import { createRequire } from 'node:module';
// Puppeteer drives a real browser because the Street View service only exists
// inside one; point this at wherever it is installed.
const require = createRequire(process.env.PUPPETEER_FROM ?? `${process.cwd()}/`);
const puppeteer = require('puppeteer');
const C = [
  ['US','美国','Times Square (7th Ave)',      40.75700,-73.98600],
  ['EG','埃及','Giza plateau road',           29.97600, 31.13050],
  ['PE','秘鲁','Machu Picchu terraces',      -13.16330,-72.54540],
  ['TR','土耳其','Sultanahmet Square',         41.00820, 28.97840],
  ['KR','韩国','Gwanghwamun Plaza',           37.57590,126.97690],
  ['MX','墨西哥','Chichen Itza causeway',      20.68290,-88.56860],
  ['MA','摩洛哥','Koutoubia, Marrakech',       31.62430, -7.99320],
  ['CN','中国','The Bund promenade',          31.23970,121.49000],
  ['ZA','南非','Table Mountain, Cape Town',  -33.96250, 18.40950],
  ['RU','俄罗斯','Red Square, Moscow',         55.75390, 37.62080],
  ['ES','西班牙','Sagrada Familia, Barcelona', 41.40360,  2.17440],
  ['TH','泰国','Grand Palace, Bangkok',       13.75110,100.49250],
  ['IS','冰岛','Reykjavik centre',            64.14660,-21.94260],
  ['CA','加拿大','Niagara Falls',              43.08280,-79.07420],
];
const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=swiftshader'] });
const page = await b.newPage();
await page.goto('http://127.0.0.1:4173/?streetview', { waitUntil:'domcontentloaded', timeout:240000 });
await page.waitForFunction("document.getElementById('loader')?.classList.contains('is-hidden')", { timeout:240000 });
await new Promise(r=>setTimeout(r,13000));
const rows = await page.evaluate(async (list)=>{
  const maps=window.google.maps, svc=new maps.StreetViewService(), pano=window.app.streetView.panorama;
  const out=[];
  for (const [cc,zh,name,lat,lng] of list) {
    let best={cc,zh,name,links:-1};
    for (let attempt=0; attempt<2; attempt++){
      try{
        const {data}=await svc.getPanorama({location:{lat,lng},radius:120,source:maps.StreetViewSource.OUTDOOR});
        const loc=data?.location; if(!loc?.pano) continue;
        pano.setPano(loc.pano);
        await new Promise(res=>{const l=pano.addListener('pano_changed',()=>{l.remove();res();});setTimeout(res,4500);});
        await new Promise(res=>setTimeout(res,800));
        const links=(pano.getLinks?.()??[]).length;
        const p=pano.getPosition?.();
        const rlat=+(p?p.lat():loc.latLng.lat()).toFixed(6), rlng=+(p?p.lng():loc.latLng.lng()).toFixed(6);
        // 落点必须离目标够近,否则视为无覆盖
        const drift=Math.hypot((rlat-lat)*111320,(rlng-lng)*111320*Math.cos(lat*Math.PI/180));
        if(links>best.links) best={cc,zh,name,links,lat:rlat,lng:rlng,drift:Math.round(drift),cr:(data.copyright||'').slice(0,24)};
        if(links>0&&drift<200) break;
      }catch(e){ best.why=String(e.message||e).slice(0,34); }
    }
    out.push(best);
  }
  return out;
}, C);
for(const r of rows){
  const ok = r.links>0 && r.drift<200;
  console.log(`${ok?'✓':'✗'} ${r.cc} ${r.zh.padEnd(5)} links=${String(r.links).padStart(2)} 偏移=${String(r.drift??'-').padStart(4)}m ${r.lat??''},${r.lng??''} ${r.cr??r.why??''}`);
}
await b.close();
