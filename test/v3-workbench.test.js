import test from 'node:test';
import assert from 'node:assert/strict';

import { AdventureSession } from '../src/campaign/v3/AdventureSession.js';
import {
  validateAdventurePackageDetailed,
} from '../src/campaign/v3/AdventurePackageValidator.js';
import {
  importAdventurePackage,
  exportAdventurePackage,
} from '../src/campaign/v3/AdventurePackageSerializer.js';
import { AdventureWorkbench } from '../src/campaign/v3/AdventureWorkbench.js';
import {
  assertProductionPackages,
} from '../src/campaign/v3/AdventurePackagePublication.js';
import { AuthorDraftAssistant } from '../src/campaign/v3/AuthorDraftAssistant.js';
import {
  NEW_YORK_TRACER_PACKAGE,
} from '../src/campaign/v3/packages/newYorkTracer.js';

function clone(value) {
  return structuredClone(value);
}

test('workbench edits package content and keeps story and geographic relationships separate', () => {
  const workbench = new AdventureWorkbench(clone(NEW_YORK_TRACER_PACKAGE));
  workbench.update('city', 'Kyoto');
  workbench.update('graph.nodes.0.culturalStatus', 'needs-review');
  workbench.update('participantRules', { min: 1, max: 4 });

  assert.equal(workbench.package.city, 'Kyoto');
  assert.equal(workbench.package.graph.nodes[0].culturalStatus, 'needs-review');
  assert.deepEqual(workbench.package.participantRules, { min: 1, max: 4 });

  const relationships = workbench.relationships();
  assert.deepEqual(relationships.story.edges[0], {
    from: 'opening-bowling-green',
    to: 'case-public-time',
  });
  assert.equal(relationships.story.nodes[0].reachable, true);
  assert.deepEqual(relationships.geographic.routes[0], {
    from: 'opening-bowling-green',
    to: 'case-public-time',
    transition: 'coordinate',
    routeStatus: 'needs-live-check',
  });
});

test('versioned text package round trips deterministically with stable keys', () => {
  const first = exportAdventurePackage(NEW_YORK_TRACER_PACKAGE);
  const second = exportAdventurePackage(importAdventurePackage(first));

  assert.equal(second, first);
  assert.match(first, /^\{\n  "cases":/);
  assert.match(first, /\n  "schemaVersion": 1,/);
  assert.ok(first.endsWith('\n'));
});

test('calibration records semantic viewer state without panorama or pixel data', async () => {
  const previewed = [];
  const workbench = new AdventureWorkbench(clone(NEW_YORK_TRACER_PACKAGE), {
    streetView: {
      async preview(target) { previewed.push(target); return { ok: true }; },
      survey() {
        return {
          position: { lat: 40.7, lng: -74.01 },
          heading: 125,
          pitch: -4,
          links: [{ heading: 90, pano: 'must-not-persist' }],
          pano: 'must-not-persist',
        };
      },
    },
  });

  await workbench.previewAnchor('opening-bowling-green');
  const calibrated = workbench.calibrateAnchor('opening-bowling-green', {
    radiusMetres: 42,
    headingTolerance: 18,
    pitchTolerance: 12,
    roadRelationship: 'same-road',
    transition: 'walk',
  });

  assert.equal(previewed.length, 1);
  assert.deepEqual(calibrated, {
    position: { lat: 40.7, lng: -74.01 },
    radiusMetres: 42,
    heading: 125,
    headingTolerance: 18,
    pitch: -4,
    pitchTolerance: 12,
    roadRelationship: 'same-road',
    transition: 'walk',
    routeStatus: 'needs-human-acceptance',
  });
  assert.doesNotMatch(JSON.stringify(workbench.package), /pano|pixel/i);
  assert.equal(workbench.acceptStreetViewLayout('opening-bowling-green').routeStatus, 'verified');
});

test('text export refuses prohibited Street View persistence fields', () => {
  const candidate = clone(NEW_YORK_TRACER_PACKAGE);
  candidate.graph.nodes[0].streetViewTarget.panoramaId = 'must-not-export';
  assert.throws(() => exportAdventurePackage(candidate), /prohibited Google imagery/i);
});

test('author playtest starts at any anchor and emits no discovery or telemetry effect', () => {
  const session = new AdventureSession(NEW_YORK_TRACER_PACKAGE);
  session.start({
    participantIds: ['author'],
    startNodeId: 'final-reasoning',
    mode: 'author-playtest',
  });
  const [navigation] = session.takeEffects();
  session.resolveEffect({
    type: 'adapter-result', effectId: navigation.id, adapter: 'street-view', ok: true,
  });
  session.submit({
    type: 'participant-submission', participantId: 'author', actionId: 'restore-sequence',
  });

  assert.equal(session.getState().endingId, 'archive-sequence-restored');
  assert.equal(session.getState().mode, 'author-playtest');
  assert.deepEqual(session.takeEffects(), []);
});

test('validation explains graph, publication, safety, fallback, participant, combat, and route failures', () => {
  const candidate = clone(NEW_YORK_TRACER_PACKAGE);
  candidate.graph.nodes.push({
    ...clone(candidate.graph.nodes[0]),
    id: 'unreachable',
    sourceRefs: ['missing-source'],
    culturalStatus: 'blocked',
    interaction: { type: 'combat', enemyCount: 3, actions: [{ id: 'fight', label: 'Fight' }] },
    fallback: null,
    streetViewTarget: {
      ...clone(candidate.graph.nodes[0].streetViewTarget),
      panoramaId: 'forbidden',
    },
  });
  candidate.participantRules = { min: 0, max: 6 };
  candidate.endings = [];

  const codes = new Set(validateAdventurePackageDetailed(candidate, { level: 'production' })
    .map((item) => item.code));
  for (const code of [
    'graph.unreachable',
    'reference.source.unknown',
    'culture.unsafe',
    'fallback.missing',
    'participants.invalid',
    'combat.too-many-enemies',
    'street-view.forbidden-field',
    'ending.missing',
    'route.anchor-count',
  ]) assert.ok(codes.has(code), `missing diagnostic ${code}`);
});

test('publication boundary rejects every package not validated for production', () => {
  assert.throws(
    () => assertProductionPackages([NEW_YORK_TRACER_PACKAGE]),
    /not production validated.*36 anchors/s,
  );
  assert.deepEqual(assertProductionPackages([]), []);
});

test('AI drafts require explicit invocation, carry provenance, and need edited human acceptance', async () => {
  let requests = 0;
  const assistant = new AuthorDraftAssistant({
    request: async (payload) => {
      requests += 1;
      assert.deepEqual(Object.keys(payload).sort(), ['brief', 'shortReferences', 'sourceSummaries']);
      return { content: 'Generated beat' };
    },
  });

  assert.equal(requests, 0);
  const draft = await assistant.generate({
    brief: { city: 'New York', caseId: 'manhattan-time' },
    sourceSummaries: ['NYC Parks describes the public space.'],
    shortReferences: ['A short author-selected phrase.'],
  });
  assert.equal(requests, 1);
  assert.equal(draft.provenance.reviewStatus, 'unreviewed');
  assert.throws(() => assistant.accept(draft, { content: 'Generated beat' }), /must edit/i);

  const accepted = assistant.accept(draft, { content: 'Author-edited original beat' });
  assert.equal(accepted.provenance.reviewStatus, 'human-accepted');
  assert.equal(accepted.provenance.humanEdited, true);
});

test('production validation rejects unreviewed AI provenance', () => {
  const candidate = clone(NEW_YORK_TRACER_PACKAGE);
  candidate.graph.nodes[0].dialogue = {
    content: 'Draft',
    provenance: { kind: 'ai-draft', reviewStatus: 'unreviewed' },
  };
  const diagnostics = validateAdventurePackageDetailed(candidate, { level: 'production' });
  assert.ok(diagnostics.some((item) => item.code === 'ai.unreviewed'));
});
