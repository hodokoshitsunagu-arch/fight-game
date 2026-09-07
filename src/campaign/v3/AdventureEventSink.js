const EVENT_FIELDS = {
  'adventure-started': new Set([
    'schemaVersion', 'type', 'runId', 'packageId', 'packageVersion', 'participantCount',
  ]),
  'case-selected': new Set([
    'schemaVersion', 'type', 'runId', 'packageId', 'packageVersion', 'participantCount', 'caseId',
  ]),
  'adventure-completed': new Set([
    'schemaVersion', 'type', 'runId', 'packageId', 'packageVersion', 'participantCount',
    'caseId', 'endingId',
  ]),
  'culture-card-propagated': new Set([
    'schemaVersion', 'type', 'runId', 'packageId', 'packageVersion', 'participantCount',
    'caseId', 'endingId', 'method',
  ]),
  'next-city-interest': new Set([
    'schemaVersion', 'type', 'runId', 'packageId', 'packageVersion', 'participantCount',
    'caseId', 'endingId', 'cityId',
  ]),
};

const REQUIRED_FIELDS = ['schemaVersion', 'type', 'runId', 'packageId', 'packageVersion'];
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function validateAdventureEvent(event) {
  if (!event || event.schemaVersion !== 1 || !EVENT_FIELDS[event.type]) {
    return { ok: false, reason: 'event-not-allowlisted' };
  }
  const allowed = EVENT_FIELDS[event.type];
  if (Object.keys(event).some((field) => !allowed.has(field))) {
    return { ok: false, reason: 'field-not-allowlisted' };
  }
  if (REQUIRED_FIELDS.some((field) => event[field] == null || event[field] === '')) {
    return { ok: false, reason: 'required-field-missing' };
  }
  for (const field of ['runId', 'packageId', 'packageVersion', 'caseId', 'endingId', 'cityId']) {
    if (event[field] != null && (typeof event[field] !== 'string' || !IDENTIFIER.test(event[field]))) {
      return { ok: false, reason: 'identifier-invalid' };
    }
  }
  if (!Number.isInteger(event.participantCount) || event.participantCount < 1 ||
      event.participantCount > 4) {
    return { ok: false, reason: 'participant-count-invalid' };
  }
  if (event.method && !['system-share-success', 'download-initiated'].includes(event.method)) {
    return { ok: false, reason: 'propagation-method-invalid' };
  }
  return { ok: true, event: structuredClone(event) };
}

export class AdventureEventSink {
  constructor({
    enabled = false,
    region = null,
    enabledRegions = [],
    endpoint = '/api/adventure-events',
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.enabled = enabled === true;
    this.region = region;
    this.enabledRegions = new Set(enabledRegions);
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async apply(effect) {
    if (effect?.type !== 'record-adventure-event' || !this.enabled ||
        !this.enabledRegions.has(this.region)) return false;
    const validation = validateAdventureEvent(effect.event);
    if (!validation.ok || !this.fetchImpl) return false;
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validation.event),
      });
      return response?.ok === true;
    } catch {
      return false;
    }
  }

  get disclosure() {
    if (!this.enabled || !this.enabledRegions.has(this.region)) return null;
    return {
      fields: '局内随机 ID、内容包与版本、参与人数、案件、结局、传播方式或城市意向',
      purpose: '汇总冒险完成、文化卡传播和下一城市意向',
      retention: '允许列表中的原始逐局事件及其单局 run ID 无限期保留；本候选实现未声明法律批准',
    };
  }
}
