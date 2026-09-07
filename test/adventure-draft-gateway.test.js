import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { authorDraftMiddleware } from '../self-created/adventure-draft-gateway.mjs';

function invoke(middleware, { method = 'POST', body = '{}' } = {}) {
  const request = new EventEmitter();
  request.url = '/api/adventure-drafts';
  request.method = method;
  request.setEncoding = () => {};
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; this.resolve(); },
  };
  const complete = new Promise((resolve) => { response.resolve = resolve; });
  middleware(request, response, () => { response.next = true; response.resolve(); });
  queueMicrotask(() => {
    request.emit('data', body);
    request.emit('end');
  });
  return complete.then(() => response);
}

test('unconfigured local draft gateway never contacts a provider', async () => {
  let calls = 0;
  const response = await invoke(authorDraftMiddleware({
    fetchImpl: async () => { calls += 1; },
  }));

  assert.equal(response.statusCode, 503);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(response.body), { error: 'draft-gateway-not-configured' });
});

test('configured gateway keeps its secret server-side and forwards only an explicit request', async () => {
  let upstream;
  const payload = {
    brief: { city: 'New York' },
    sourceSummaries: ['Institutional source summary'],
    shortReferences: ['Short selected reference'],
  };
  const response = await invoke(authorDraftMiddleware({
    endpoint: 'https://provider.invalid/drafts',
    apiKey: 'server-only-secret',
    model: 'configured-model',
    fetchImpl: async (url, options) => {
      upstream = { url, options };
      return {
        ok: true,
        async json() { return { choices: [{ message: { content: 'Candidate beat' } }] }; },
      };
    },
  }), { body: JSON.stringify(payload) });

  assert.equal(upstream.url, 'https://provider.invalid/drafts');
  assert.equal(upstream.options.headers.authorization, 'Bearer server-only-secret');
  assert.deepEqual(JSON.parse(response.body), { content: 'Candidate beat' });
  assert.doesNotMatch(response.body, /server-only-secret|configured-model/);
});

test('gateway rejects a full-work-sized reference before any provider request', async () => {
  let calls = 0;
  const response = await invoke(authorDraftMiddleware({
    endpoint: 'https://provider.invalid/drafts',
    apiKey: 'server-only-secret',
    model: 'configured-model',
    fetchImpl: async () => { calls += 1; },
  }), { body: JSON.stringify({
    brief: { city: 'New York' },
    sourceSummaries: [],
    shortReferences: ['x'.repeat(501)],
  }) });

  assert.equal(response.statusCode, 400);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(response.body), { error: 'references-must-be-short' });
});
