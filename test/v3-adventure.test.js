import test from 'node:test';
import assert from 'node:assert/strict';

import { campaignVersionFromSearch } from '../src/campaign/campaignVersion.js';
import {
  NEW_YORK_TRACER_PACKAGE,
} from '../src/campaign/v3/packages/newYorkTracer.js';
import {
  validateAdventurePackage,
} from '../src/campaign/v3/AdventurePackageValidator.js';
import { AdventureSession } from '../src/campaign/v3/AdventureSession.js';
import { FakeStreetViewAdapter } from '../src/campaign/v3/StreetViewAdapter.js';
import {
  DISCOVERY_STORAGE_KEY,
  DiscoveryStore,
} from '../src/campaign/v3/DiscoveryStore.js';
import { AdventureRuntime } from '../src/campaign/v3/AdventureRuntime.js';
import {
  freshCulturalProgress,
  loadCulturalProgress,
  saveCulturalProgress,
} from '../src/campaign/CulturalCampaignSave.js';

class MemoryStorage {
  constructor(entries = {}) { this.data = new Map(Object.entries(entries)); }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
}

function participants(count) {
  return Array.from({ length: count }, (_, index) => `p${index + 1}`);
}

function submitAll(session, participantIds) {
  for (const participantId of participantIds) {
    const state = session.getState();
    session.submit({
      type: 'participant-submission',
      participantId,
      actionId: state.availableActions[0].id,
    });
  }
}

function resolveNavigation(session, adapter) {
  const [effect] = session.takeEffects();
  assert.equal(effect.type, 'navigate-street-view');
  session.resolveEffect(adapter.navigate(effect));
}

function runRoute(count) {
  const participantIds = participants(count);
  const adapter = new FakeStreetViewAdapter({
    observations: NEW_YORK_TRACER_PACKAGE.graph.nodes.map((node) => ({
      position: node.streetViewTarget.position,
      heading: node.streetViewTarget.heading,
    })),
  });
  const session = new AdventureSession(NEW_YORK_TRACER_PACKAGE);
  session.start({ participantIds });

  for (let index = 0; index < 3; index += 1) {
    resolveNavigation(session, adapter);
    assert.equal(session.getState().status, 'awaiting-submissions');
    submitAll(session, participantIds);
  }

  return session;
}

test('campaign=v3 is additive to the existing route selection', () => {
  assert.equal(campaignVersionFromSearch(''), 1);
  assert.equal(campaignVersionFromSearch('?game'), 1);
  assert.equal(campaignVersionFromSearch('?campaign=v2'), 2);
  assert.equal(campaignVersionFromSearch('?campaign=v3'), 3);
  assert.equal(campaignVersionFromSearch('?campaign=unknown'), 1);
});

test('the versioned three-anchor package passes development and is rejected for production', () => {
  assert.deepEqual(validateAdventurePackage(NEW_YORK_TRACER_PACKAGE, { level: 'development' }), []);
  assert.ok(validateAdventurePackage(NEW_YORK_TRACER_PACKAGE, { level: 'production' })
    .some((error) => /36 anchors/.test(error)));
  assert.equal(NEW_YORK_TRACER_PACKAGE.schemaVersion, 1);
  assert.deepEqual(
    NEW_YORK_TRACER_PACKAGE.graph.nodes.map((node) => node.segment),
    ['shared-opening', 'case', 'final-reasoning'],
  );
  assert.ok(NEW_YORK_TRACER_PACKAGE.graph.nodes.every((node) => node.fact && node.fantasy));
});

test('the fake Street View adapter reports heading and range success', () => {
  const node = NEW_YORK_TRACER_PACKAGE.graph.nodes[0];
  const adapter = new FakeStreetViewAdapter({ observations: [{
    position: node.streetViewTarget.position,
    heading: node.streetViewTarget.heading + 2,
  }] });
  const outcome = adapter.navigate({
    id: 'effect-1',
    type: 'navigate-street-view',
    nodeId: node.id,
    target: node.streetViewTarget,
  });

  assert.deepEqual(outcome, {
    type: 'adapter-result',
    effectId: 'effect-1',
    adapter: 'street-view',
    ok: true,
    reason: null,
    matched: ['range', 'heading'],
  });
});

test('navigation failure follows the authored deterministic fallback without locking the route', () => {
  const session = new AdventureSession(NEW_YORK_TRACER_PACKAGE);
  const adapter = new FakeStreetViewAdapter({ observations: [null] });
  session.start({ participantIds: ['solo'] });
  const [effect] = session.takeEffects();
  session.resolveEffect(adapter.navigate(effect));

  const state = session.getState();
  assert.equal(state.status, 'awaiting-submissions');
  assert.equal(state.navigation.degraded, true);
  assert.equal(state.navigation.reason, 'viewer-unavailable');
  assert.equal(state.navigation.fallbackId, 'opening-public-fallback');
});

test('one and four participants traverse the same public session interface to the same ending', () => {
  for (const count of [1, 4]) {
    const session = runRoute(count);
    const state = session.getState();
    assert.equal(state.status, 'complete');
    assert.equal(state.endingId, 'archive-sequence-restored');
    assert.deepEqual(state.evidenceIds, ['boundary-evidence', 'case-sequence-evidence']);
    assert.equal(session.takeEffects().at(-1).type, 'persist-discovery');
  }
});

test('only a completed ending creates discovery and no unfinished run is restored', () => {
  const storage = new MemoryStorage();
  const store = new DiscoveryStore(storage);
  const unfinished = new AdventureSession(NEW_YORK_TRACER_PACKAGE);
  unfinished.start({ participantIds: ['solo'] });

  assert.equal(storage.getItem(DISCOVERY_STORAGE_KEY), null);
  assert.equal(new AdventureSession(NEW_YORK_TRACER_PACKAGE).getState().status, 'idle');

  const complete = runRoute(1);
  const persist = complete.takeEffects().find((effect) => effect.type === 'persist-discovery');
  assert.equal(store.apply(persist), true);
  assert.deepEqual(store.load(NEW_YORK_TRACER_PACKAGE), {
    version: 1,
    packageId: NEW_YORK_TRACER_PACKAGE.id,
    packageVersion: NEW_YORK_TRACER_PACKAGE.version,
    completedCaseIds: ['manhattan-time-tracer'],
    endingIds: ['archive-sequence-restored'],
    cultureCards: [{ id: 'manhattan-time-card', endingId: 'archive-sequence-restored' }],
  });
});

test('v3 discovery is isolated from v2 saves and corrupted data falls back deterministically', () => {
  const storage = new MemoryStorage({ [DISCOVERY_STORAGE_KEY]: '{bad json' });
  const v2Progress = { ...freshCulturalProgress(), mastery: 7 };
  assert.equal(saveCulturalProgress(v2Progress, storage), true);
  const store = new DiscoveryStore(storage);
  assert.deepEqual(store.load(NEW_YORK_TRACER_PACKAGE).completedCaseIds, []);
  assert.equal(loadCulturalProgress(storage).mastery, 7);
});

test('discovery accumulates valid cases and endings instead of replacing earlier results', () => {
  const secondCase = { id: 'brooklyn-shoreline-tracer' };
  const secondEnding = { id: 'shoreline-record-restored', caseId: secondCase.id };
  const adventurePackage = {
    ...NEW_YORK_TRACER_PACKAGE,
    cases: [...NEW_YORK_TRACER_PACKAGE.cases, secondCase],
    endings: [...NEW_YORK_TRACER_PACKAGE.endings, secondEnding],
  };
  const storage = new MemoryStorage();
  const store = new DiscoveryStore(storage);
  const effects = [
    {
      type: 'persist-discovery', packageId: adventurePackage.id,
      packageVersion: adventurePackage.version, caseId: 'manhattan-time-tracer',
      endingId: 'archive-sequence-restored',
      cultureCard: { id: 'manhattan-time-card', endingId: 'archive-sequence-restored' },
    },
    {
      type: 'persist-discovery', packageId: adventurePackage.id,
      packageVersion: adventurePackage.version, caseId: secondCase.id,
      endingId: secondEnding.id,
      cultureCard: { id: 'brooklyn-shoreline-card', endingId: secondEnding.id },
    },
  ];
  effects.forEach((effect) => store.apply(effect, adventurePackage));

  const record = store.load(adventurePackage);
  assert.deepEqual(record.completedCaseIds, ['manhattan-time-tracer', secondCase.id]);
  assert.deepEqual(record.endingIds, ['archive-sequence-restored', secondEnding.id]);
  assert.equal(record.cultureCards.length, 2);
});

test('the runtime drives effects through adapters and exposes the session through a visible-HUD seam', async () => {
  const storage = new MemoryStorage();
  const states = [];
  const hud = {
    bind(submit) { this.submit = submit; },
    render(view) { states.push(view); },
  };
  const streetView = new FakeStreetViewAdapter({
    observations: NEW_YORK_TRACER_PACKAGE.graph.nodes.map((node) => ({
      position: node.streetViewTarget.position,
      heading: node.streetViewTarget.heading,
    })),
  });
  const runtime = new AdventureRuntime({
    adventurePackage: NEW_YORK_TRACER_PACKAGE,
    participantIds: ['p1'],
    streetView,
    discoveryStore: new DiscoveryStore(storage),
    hud,
  });

  await runtime.start();
  for (let index = 0; index < 3; index += 1) {
    assert.equal(runtime.state.status, 'awaiting-submissions');
    await hud.submit({
      type: 'participant-submission',
      participantId: 'p1',
      actionId: runtime.state.availableActions[0].id,
    });
  }

  assert.equal(runtime.state.status, 'complete');
  assert.ok(states.some((view) => view.node?.sourceRefs?.length));
  assert.equal(states.at(-1).ending.title, NEW_YORK_TRACER_PACKAGE.endings[0].title);
  assert.deepEqual(
    new DiscoveryStore(storage).load(NEW_YORK_TRACER_PACKAGE).endingIds,
    ['archive-sequence-restored'],
  );
});
