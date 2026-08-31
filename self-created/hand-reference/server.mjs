/**
 * A one-job upload endpoint for hand-pose reference photographs.
 *
 * Bound to loopback only — `cloudflared` is what reaches the outside, so the
 * process itself is never exposed. Everything about it is deliberately narrow:
 *
 *   one secret path      an unguessable token, so a public tunnel URL is not
 *                        an open write endpoint for anyone who guesses the host
 *   two routes           the page, and the upload
 *   images only          by declared type and by extension
 *   caps                 per file and in total, so the disk cannot be filled
 *   flat names           the basename only, sanitised — nothing can escape the
 *                        one directory it is allowed to write
 *
 * Files arrive as raw bodies with the name in a header rather than as multipart
 * form data: there is no dependency here to parse multipart with, and hand
 * rolling a parser for a five-minute intake endpoint is exactly the kind of
 * code that has a path-traversal bug in it.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DROP = path.join(DIR, 'photos');
const TOKEN = process.env.DROP_TOKEN;
const PORT = Number(process.env.DROP_PORT || 8788);

const MAX_FILE = 16 * 1024 * 1024;
const MAX_TOTAL = 400 * 1024 * 1024;
const MAX_FILES = 120;

if (!TOKEN) {
  console.error('DROP_TOKEN must be set');
  process.exit(1);
}

fs.mkdirSync(DROP, { recursive: true });

const PAGE = fs.readFileSync(path.join(DIR, 'page.html'), 'utf8');

/** Strip everything that is not a plain filename. */
function safeName(raw) {
  const base = path.basename(String(raw || 'photo'));
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').slice(0, 80).trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'photo';
}

function unique(name) {
  const ext = path.extname(name) || '.jpg';
  const stem = path.basename(name, ext);
  let candidate = `${stem}${ext}`;
  let n = 1;
  while (fs.existsSync(path.join(DROP, candidate))) candidate = `${stem}-${n++}${ext}`;
  return candidate;
}

function totals() {
  const files = fs.readdirSync(DROP).filter((f) => !f.startsWith('.'));
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(DROP, f)).size, 0);
  return { count: files.length, bytes, files };
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  // Everything lives under the token. A wrong or missing one looks like an
  // empty host, not like a locked door worth rattling.
  if (parts[0] !== TOKEN) return send(res, 404, 'Not found');

  const route = parts[1] ?? '';

  if (req.method === 'GET' && route === '') {
    return send(res, 200, PAGE, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && route === 'state') {
    const { count, bytes, files } = totals();
    return send(res, 200, JSON.stringify({ count, bytes, files }), 'application/json');
  }

  if (req.method === 'POST' && route === 'upload') {
    const name = safeName(req.headers['x-filename']);
    const type = String(req.headers['content-type'] || '');
    const looksImage = /^image\//.test(type) || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(name);
    if (!looksImage) return send(res, 415, 'Images only');

    const before = totals();
    if (before.count >= MAX_FILES) return send(res, 507, 'Too many files already');

    const chunks = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_FILE || before.bytes + size > MAX_TOTAL) {
        aborted = true;
        send(res, 413, 'Too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const written = unique(name);
      fs.writeFileSync(path.join(DROP, written), Buffer.concat(chunks));
      console.log(`received ${written} (${(size / 1024).toFixed(0)}KB)`);
      send(res, 200, JSON.stringify({ saved: written }), 'application/json');
    });

    req.on('error', () => { aborted = true; });
    return undefined;
  }

  return send(res, 404, 'Not found');
});

// Loopback only. The tunnel is the only way in, and it runs on this machine.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`listening on 127.0.0.1:${PORT}, writing to ${DROP}`);
});
