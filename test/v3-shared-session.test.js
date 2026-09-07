import test from 'node:test';
import assert from 'node:assert/strict';

import { AdventureSession } from '../src/campaign/v3/AdventureSession.js';
import { validateAdventurePackage } from '../src/campaign/v3/AdventurePackageValidator.js';
import { AdventureWorkbench } from '../src/campaign/v3/AdventureWorkbench.js';
import { importAdventurePackage } from '../src/campaign/v3/AdventurePackageSerializer.js';
import { FakeStreetViewAdapter } from '../src/campaign/v3/StreetViewAdapter.js';
import {
  NEW_YORK_SHARED_SHELL_PACKAGE,
} from '../src/campaign/v3/packages/newYorkSharedShell.js';

function ids(count) {
  return Array.from({ length: count }, (_, index) => `p${index + 1}`);
}

function resolveNavigation(session) {
  const effect = session.takeEffects().find((item) => item.type === 'navigate-street-view');
  assert.ok(effect);
  const adapter = new FakeStreetViewAdapter({ observations: [{
    position: effect.target.position,
    heading: effect.target.heading,
    pitch: effect.target.pitch,
    roadRelationship: effect.target.roadRelationship,
  }] });
  session.resolveEffect(adapter.navigate(effect));
}

function submitVote(session, participantId, actionId) {
  const action = session.getState().availableActions.find((item) => item.id === actionId);
  session.submit({
    type: 'participant-submission', participantId, actionId,
    ...(action?.streetViewInput ? { streetViewMatched: [action.streetViewInput] } : {}),
  });
}

function submitCombatRoles(session) {
  const state = session.getState();
  for (const participantId of state.participantIds) {
    for (const role of state.roleAssignments[participantId]) {
      const action = state.availableActions.find((candidate) => candidate.role === role);
      session.submit({
        type: 'participant-submission', participantId, actionId: action.id, role,
        ...(action.streetViewInput ? { streetViewMatched: [action.streetViewInput] } : {}),
      });
    }
  }
}

function reachCaseVote(session, participantIds, openingAction = 'inspect-shoreline-layer') {
  resolveNavigation(session);
  participantIds.forEach((participantId) => submitVote(session, participantId, openingAction));
  assert.equal(session.getState().nodeId, 'S2');
  resolveNavigation(session);
  submitCombatRoles(session);
  assert.equal(session.getState().nodeId, 'S3');
  resolveNavigation(session);
}

test('the workbench-authored New York shell contains S1-S6 and stays outside production publication', () => {
  const workbench = new AdventureWorkbench(NEW_YORK_SHARED_SHELL_PACKAGE);
  const roundTrip = importAdventurePackage(workbench.export());

  assert.deepEqual(roundTrip.graph.nodes.map((node) => node.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.deepEqual(validateAdventurePackage(roundTrip, { level: 'development' }), []);
  assert.ok(validateAdventurePackage(roundTrip, { level: 'production' })
    .some((message) => /36 anchors|human Street View acceptance/.test(message)));
  assert.equal(roundTrip.cases.length, 3);
  assert.equal(roundTrip.endings.length, 3);
});

test('one through four participants rotate navigator ownership and merge all four fixed combat roles', () => {
  for (const count of [1, 2, 3, 4]) {
    const participantIds = ids(count);
    const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE, {
      createRunId: () => `run-${count}`,
    });
    session.start({ participantIds });
    assert.equal(session.getState().navigatorParticipantId, 'p1');

    resolveNavigation(session);
    participantIds.forEach((participantId) =>
      submitVote(session, participantId, 'inspect-shoreline-layer'));
    const combat = session.getState();
    assert.equal(combat.nodeId, 'S2');
    assert.equal(combat.navigatorParticipantId, 'p1');
    assert.equal(combat.streetViewLocked, true);
    assert.deepEqual(
      Object.values(combat.roleAssignments).flat().sort(),
      ['attack', 'defense', 'evidence', 'support'],
    );

    resolveNavigation(session);
    submitCombatRoles(session);
    const dossier = session.getState();
    assert.equal(dossier.nodeId, 'S3');
    assert.equal(dossier.navigatorParticipantId, participantIds[1 % count]);
    assert.equal(dossier.streetViewLocked, false);
    assert.ok(dossier.evidenceIds.includes('protected-archive-layer'));
  }
});

test('public vote totals update live and resolve by majority, group-approved evidence, then navigator', () => {
  const majority = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  majority.start({ participantIds: ids(3) });
  reachCaseVote(majority, ids(3));
  submitVote(majority, 'p1', 'choose-manhattan');
  assert.deepEqual(majority.getState().voteCounts, {
    'choose-manhattan': 1, 'choose-brooklyn': 0, 'choose-queens': 0,
  });
  submitVote(majority, 'p2', 'choose-manhattan');
  submitVote(majority, 'p3', 'choose-queens');
  assert.equal(majority.getState().selectedCaseId, 'manhattan-time');

  const evidence = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  evidence.start({ participantIds: ids(4) });
  reachCaseVote(evidence, ids(4), 'inspect-shoreline-layer');
  submitVote(evidence, 'p1', 'choose-manhattan');
  submitVote(evidence, 'p2', 'choose-brooklyn');
  submitVote(evidence, 'p3', 'choose-manhattan');
  submitVote(evidence, 'p4', 'choose-brooklyn');
  assert.equal(evidence.getState().status, 'awaiting-evidence-tiebreak');
  for (const participantId of ids(4)) {
    evidence.submit({
      type: 'evidence-tiebreak-decision', participantId, useEvidence: participantId !== 'p4',
    });
  }
  assert.equal(evidence.getState().selectedCaseId, 'brooklyn-shoreline');
  assert.equal(evidence.getState().lastResolution.strategy, 'evidence');

  const navigator = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  navigator.start({ participantIds: ids(4) });
  reachCaseVote(navigator, ids(4), 'inspect-shoreline-layer');
  assert.equal(navigator.getState().navigatorParticipantId, 'p2');
  submitVote(navigator, 'p1', 'choose-manhattan');
  submitVote(navigator, 'p2', 'choose-queens');
  submitVote(navigator, 'p3', 'choose-queens');
  submitVote(navigator, 'p4', 'choose-manhattan');
  for (const participantId of ids(4)) {
    navigator.submit({
      type: 'evidence-tiebreak-decision', participantId, useEvidence: participantId === 'p1',
    });
  }
  assert.equal(navigator.getState().selectedCaseId, 'queens-future');
  assert.equal(navigator.getState().lastResolution.strategy, 'navigator');
});

test('only the current navigator can issue shared Street View commands outside combat', () => {
  const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  session.start({ participantIds: ids(3) });
  resolveNavigation(session);

  session.submit({ type: 'navigator-command', participantId: 'p2', command: 'turn-left' });
  assert.equal(session.takeEffects().some((effect) => effect.type === 'control-street-view'), false);
  session.submit({ type: 'navigator-command', participantId: 'p1', command: 'turn-left' });
  const effect = session.takeEffects().find((item) => item.type === 'control-street-view');
  assert.equal(effect.command, 'turn-left');
  assert.equal(effect.participantId, 'p1');
});

test('three failures and participant departure deterministically unblock the shared route', () => {
  const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  session.start({ participantIds: ids(4) });
  reachCaseVote(session, ids(4));
  session.submit({ type: 'participant-departure', participantId: 'p4' });
  assert.deepEqual(session.getState().participantIds, ['p1', 'p2', 'p3']);
  assert.deepEqual(
    Object.values(session.getState().roleAssignments).flat().sort(),
    ['attack', 'defense', 'evidence', 'support'],
  );

  submitVote(session, 'p1', 'choose-brooklyn');
  submitVote(session, 'p2', 'choose-brooklyn');
  submitVote(session, 'p3', 'choose-brooklyn');
  resolveNavigation(session);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    session.submit({ type: 'interaction-failure', reason: 'missing-input' });
  }
  assert.equal(session.getState().nodeId, 'S5');
  assert.equal(session.getState().lastFallback.reason, 'missing-input');
});

test('departure during combat uses a non-fabricating fallback and reduces the group at the next safe node', () => {
  const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  session.start({ participantIds: ids(4) });
  resolveNavigation(session);
  ids(4).forEach((participantId) =>
    submitVote(session, participantId, 'inspect-shoreline-layer'));
  resolveNavigation(session);
  session.submit({
    type: 'participant-submission', participantId: 'p1', actionId: 'stabilize-anomaly', role: 'attack',
    streetViewMatched: ['range'],
  });
  session.submit({ type: 'participant-departure', participantId: 'p4' });

  assert.equal(session.getState().nodeId, 'S3');
  assert.deepEqual(session.getState().participantIds, ['p1', 'p2', 'p3']);
  assert.deepEqual(
    Object.values(session.getState().roleAssignments).flat().sort(),
    ['attack', 'defense', 'evidence', 'support'],
  );
  assert.equal(session.getState().lastFallback.reason, 'participant-departure');
  assert.equal(session.getState().submissions.length, 0);
});

test('departure while combat navigation is pending cannot leave an absent role blocking the beat', () => {
  const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  session.start({ participantIds: ids(4) });
  resolveNavigation(session);
  ids(4).forEach((participantId) => submitVote(session, participantId, 'inspect-time-layer'));
  assert.equal(session.getState().nodeId, 'S2');
  assert.equal(session.getState().status, 'awaiting-navigation');
  session.submit({ type: 'participant-departure', participantId: 'p4' });
  assert.equal(session.getState().nodeId, 'S2');
  resolveNavigation(session);
  assert.equal(session.getState().nodeId, 'S3');
  assert.deepEqual(session.getState().participantIds, ['p1', 'p2', 'p3']);
  assert.equal(session.getState().lastFallback.reason, 'participant-departure');
});

test('combat accessibility fallback unblocks without fabricating a participant role submission', () => {
  const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  session.start({ participantIds: ids(2) });
  resolveNavigation(session);
  ids(2).forEach((participantId) => submitVote(session, participantId, 'inspect-time-layer'));
  resolveNavigation(session);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    session.submit({ type: 'interaction-failure', reason: 'combat-unavailable' });
  }
  assert.equal(session.getState().nodeId, 'S3');
  assert.equal(session.getState().lastFallback.reason, 'combat-unavailable');
  assert.equal(session.getState().submissions.length, 0);
});

test('completion persists discovery, and only successful share/download and deliberate city choice emit signals', () => {
  const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE, {
    createRunId: () => 'run-signals',
  });
  session.start({ participantIds: ['solo'] });
  reachCaseVote(session, ['solo'], 'inspect-time-layer');
  submitVote(session, 'solo', 'choose-manhattan');

  for (const nodeId of ['S4', 'S5', 'S6']) {
    assert.equal(session.getState().nodeId, nodeId);
    resolveNavigation(session);
    submitVote(session, 'solo', session.getState().availableActions[0].id);
  }
  assert.equal(session.getState().status, 'complete');
  const completionEffects = session.takeEffects();
  assert.ok(completionEffects.some((effect) => effect.type === 'persist-discovery'));
  assert.ok(completionEffects.some((effect) =>
    effect.type === 'record-adventure-event' && effect.event.type === 'adventure-completed'));

  session.submit({ type: 'culture-card-rendered' });
  assert.deepEqual(session.takeEffects(), []);
  session.submit({ type: 'culture-card-propagation', method: 'share-cancelled' });
  assert.deepEqual(session.takeEffects(), []);
  session.submit({ type: 'culture-card-propagation', method: 'download-initiated' });
  assert.equal(session.takeEffects()[0].event.type, 'culture-card-propagated');
  session.submit({ type: 'city-interest', cityId: 'tokyo' });
  const interest = session.takeEffects()[0];
  assert.equal(interest.event.type, 'next-city-interest');
  assert.equal(interest.event.cityId, 'tokyo');
  assert.equal(session.getState().nextCityInterestId, 'tokyo');
  session.submit({ type: 'city-interest', cityId: 'paris' });
  assert.deepEqual(session.takeEffects(), []);
  assert.equal(session.getState().nodeId, 'S6');
});

test('each action is coupled to authored Street View state and each ending exposes its case truth', () => {
  for (const node of NEW_YORK_SHARED_SHELL_PACKAGE.graph.nodes) {
    assert.ok(node.interaction.actions.every((action) => action.streetViewInput));
  }
  for (const caseFile of NEW_YORK_SHARED_SHELL_PACKAGE.cases) {
    const ending = NEW_YORK_SHARED_SHELL_PACKAGE.endings.find((item) => item.caseId === caseFile.id);
    assert.equal(ending.caseTruth, caseFile.truth);
  }
});

test('normal interaction rejects a stale arrival snapshot and requires current Street View state', () => {
  const session = new AdventureSession(NEW_YORK_SHARED_SHELL_PACKAGE);
  session.start({ participantIds: ['solo'] });
  resolveNavigation(session);
  session.submit({
    type: 'participant-submission', participantId: 'solo', actionId: 'inspect-time-layer',
  });
  assert.equal(session.getState().submissions.length, 0);
  submitVote(session, 'solo', 'inspect-time-layer');
  assert.equal(session.getState().nodeId, 'S2');
});
