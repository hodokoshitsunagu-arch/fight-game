import { validateAdventureEvent } from '../src/campaign/v3/AdventureEventSink.js';

async function readJson(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function adventureEventReceiver({
  enabled = false,
  region = null,
  enabledRegions = [],
  record = () => {},
} = {}) {
  const regionSet = new Set(enabledRegions);
  return async (request, response, next) => {
    if (request.url !== '/api/adventure-events') return next();
    response.setHeader('content-type', 'application/json');
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.end(JSON.stringify({ ok: false, reason: 'method-not-allowed' }));
      return;
    }
    if (enabled !== true || !regionSet.has(region)) {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, reason: 'region-disabled' }));
      return;
    }
    try {
      const validation = validateAdventureEvent(await readJson(request));
      if (!validation.ok) {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, reason: validation.reason }));
        return;
      }
      await record(validation.event);
      response.statusCode = 202;
      response.end(JSON.stringify({ ok: true }));
    } catch {
      response.statusCode = 400;
      response.end(JSON.stringify({ ok: false, reason: 'invalid-json' }));
    }
  };
}
