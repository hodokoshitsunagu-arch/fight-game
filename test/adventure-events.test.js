import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdventureEventSink,
  validateAdventureEvent,
} from '../src/campaign/v3/AdventureEventSink.js';
import {
  adventureEventReceiver,
} from '../self-created/adventure-event-receiver.mjs';

const VALID_EVENT = {
  schemaVersion: 1,
  type: 'adventure-completed',
  runId: 'ephemeral-run',
  packageId: 'new-york-disordered-archive',
  packageVersion: '0.2.0-dev',
  participantCount: 2,
  caseId: 'manhattan-time',
  endingId: 'manhattan-time-restored',
};

function responseRecorder() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = value; },
  };
}

test('event effects are globally off by default and make no request', async () => {
  let calls = 0;
  const sink = new AdventureEventSink({
    fetchImpl: async () => { calls += 1; },
  });

  assert.equal(await sink.apply({ type: 'record-adventure-event', event: VALID_EVENT }), false);
  assert.equal(calls, 0);
});

test('enabled regional event sink accepts only the versioned allowlist and prohibited fields are rejected', async () => {
  const sent = [];
  const sink = new AdventureEventSink({
    enabled: true,
    region: 'us',
    enabledRegions: ['us'],
    fetchImpl: async (_url, request) => {
      sent.push(JSON.parse(request.body));
      return { ok: true };
    },
  });

  assert.equal(validateAdventureEvent(VALID_EVENT).ok, true);
  for (const field of ['freeText', 'deviceId', 'crossRunIdentity', 'ip', 'userAgent']) {
    assert.equal(validateAdventureEvent({ ...VALID_EVENT, [field]: 'forbidden' }).ok, false);
  }
  assert.equal(validateAdventureEvent({ ...VALID_EVENT, caseId: 'free text is not an id' }).ok, false);
  assert.equal(await sink.apply({ type: 'record-adventure-event', event: VALID_EVENT }), true);
  assert.deepEqual(sent, [VALID_EVENT]);
  assert.match(sink.disclosure.fields, /局内随机 ID/);
  assert.match(sink.disclosure.retention, /无限期保留.*未声明法律批准/);
});

test('minimal receiver is region gated and retains only an accepted event body', async () => {
  const records = [];
  const middleware = adventureEventReceiver({
    enabled: true,
    enabledRegions: ['us'],
    region: 'us',
    record: (event) => records.push(event),
  });
  const request = {
    method: 'POST',
    url: '/api/adventure-events',
    headers: { 'user-agent': 'must-not-persist', 'x-forwarded-for': '203.0.113.1' },
    body: VALID_EVENT,
  };
  const response = responseRecorder();
  await middleware(request, response, () => assert.fail('receiver should handle the request'));

  assert.equal(response.statusCode, 202);
  assert.deepEqual(records, [VALID_EVENT]);
  assert.equal(JSON.stringify(records).includes('must-not-persist'), false);
  assert.equal(JSON.stringify(records).includes('203.0.113.1'), false);
});
