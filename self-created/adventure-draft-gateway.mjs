import { authorDraftRequestError } from '../src/campaign/v3/AuthorDraftRequest.js';

const MAX_BODY_BYTES = 64 * 1024;

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) reject(new Error('request-too-large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function send(response, status, value) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

export function authorDraftMiddleware({ endpoint, apiKey, model, fetchImpl = fetch } = {}) {
  return async (request, response, next) => {
    if (request.url !== '/api/adventure-drafts') return next();
    if (request.method !== 'POST') return send(response, 405, { error: 'method-not-allowed' });
    if (!endpoint || !apiKey || !model) return send(response, 503, { error: 'draft-gateway-not-configured' });

    let payload;
    try {
      payload = JSON.parse(await readBody(request));
    } catch (error) {
      return send(response, 400, { error: error.message === 'request-too-large' ? error.message : 'invalid-json' });
    }
    const requestError = authorDraftRequestError(payload);
    if (requestError) return send(response, 400, { error: requestError });

    try {
      const upstream = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: JSON.stringify({
              task: 'Draft original city-adventure beats for human review. Do not invent facts.',
              ...payload,
            }),
          }],
        }),
      });
      const result = await upstream.json();
      if (!upstream.ok) return send(response, 502, { error: 'draft-provider-failed' });
      const content = result?.choices?.[0]?.message?.content;
      if (!content) return send(response, 502, { error: 'draft-provider-returned-no-content' });
      return send(response, 200, { content });
    } catch {
      return send(response, 502, { error: 'draft-provider-unavailable' });
    }
  };
}
