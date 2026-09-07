import { validateAdventurePackage } from './AdventurePackageValidator.js';

const COMBAT_ROLES = ['attack', 'defense', 'evidence', 'support'];
const PROPAGATION_METHODS = new Set(['system-share-success', 'download-initiated']);

function defaultRunId() {
  return globalThis.crypto?.randomUUID?.() ??
    `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class AdventureSession {
  constructor(adventurePackage, { createRunId = defaultRunId } = {}) {
    const errors = validateAdventurePackage(adventurePackage, { level: 'development' });
    if (errors.length) throw new Error(`Invalid adventure package: ${errors.join('; ')}`);
    this.package = adventurePackage;
    this.createRunId = createRunId;
    this.nodes = new Map(adventurePackage.graph.nodes.map((node) => [node.id, node]));
    this.edges = new Map();
    for (const edge of adventurePackage.graph.edges) {
      const outgoing = this.edges.get(edge.from) ?? [];
      outgoing.push(edge);
      this.edges.set(edge.from, outgoing);
    }
    this.effectSequence = 0;
    this.pendingEffects = [];
    this.state = this._freshState();
  }

  _freshState() {
    return {
      packageId: this.package.id,
      packageVersion: this.package.version,
      runId: null,
      status: 'idle',
      nodeId: null,
      segment: null,
      participantIds: [],
      pendingDepartureIds: [],
      navigatorParticipantId: null,
      roleAssignments: {},
      streetViewLocked: false,
      navigationTurnCount: 0,
      submissions: [],
      contributionSequence: 0,
      lastContribution: null,
      availableActions: [],
      voteCounts: {},
      evidenceDecisions: {},
      evidenceDecisionCounts: { use: 0, skip: 0 },
      evidenceIds: [],
      selectedCaseId: null,
      navigation: { degraded: false, reason: null, fallbackId: null },
      failureCount: 0,
      lastFallback: null,
      lastResolution: null,
      endingId: null,
      nextCityInterestId: null,
      mode: 'player',
      visitedAnchorCount: 0,
    };
  }

  start({ participantIds, startNodeId = null, mode = 'player' }) {
    const unique = [...new Set(participantIds ?? [])];
    if (unique.length < 1 || unique.length > 4) throw new Error('Adventure sessions require 1–4 participants');
    if (!['player', 'author-playtest'].includes(mode)) throw new Error(`Unknown adventure mode ${mode}`);
    const firstNodeId = startNodeId ?? this.package.graph.startNodeId;
    if (!this.nodes.has(firstNodeId)) throw new Error(`Unknown adventure node ${firstNodeId}`);
    this.pendingEffects = [];
    this.state = {
      ...this._freshState(),
      runId: this.createRunId(),
      participantIds: unique,
      navigatorParticipantId: unique[0],
      roleAssignments: this._assignRoles(unique),
      mode,
    };
    if (mode === 'author-playtest') {
      this.state.evidenceIds = [...(this.nodes.get(firstNodeId).interaction?.requiresEvidence ?? [])];
    }
    this._enterNode(firstNodeId);
    if (mode === 'player') this._event('adventure-started');
    return this.getState();
  }

  submit(input) {
    if (this.state.status === 'complete') return this._submitCompletionSignal(input);
    if (input?.type === 'participant-departure') return this._removeParticipant(input.participantId);
    if (input?.type === 'interaction-failure') return this._recordFailure(input.reason);
    if (input?.type === 'navigator-command') return this._controlStreetView(input);
    if (input?.type === 'evidence-tiebreak-decision') return this._decideEvidenceTieBreak(input);
    if (input?.type !== 'participant-submission' || this.state.status !== 'awaiting-submissions') {
      return this.getState();
    }
    const action = this.state.availableActions.find((item) => item.id === input.actionId);
    if (!this.state.participantIds.includes(input.participantId) || !action) return this.getState();

    const node = this.nodes.get(this.state.nodeId);
    if (!this.state.navigation.degraded && action.streetViewInput &&
        !input.streetViewMatched?.includes(action.streetViewInput)) return this.getState();
    if (node.interaction.type === 'combat') {
      const role = input.role ?? action.role;
      if (action.role !== role ||
          !this.state.roleAssignments[input.participantId]?.includes(role) ||
          this.state.submissions.some((item) => item.role === role)) return this.getState();
      this.state.submissions.push({ participantId: input.participantId, actionId: action.id, role });
      this._noteContribution(input.participantId);
      this._refreshVoteCounts();
      if (COMBAT_ROLES.every((roleId) =>
        this.state.submissions.some((submission) => submission.role === roleId))) this._completeNode();
      return this.getState();
    }

    if (this.state.submissions.some((submission) => submission.participantId === input.participantId)) {
      return this.getState();
    }
    this.state.submissions.push({ participantId: input.participantId, actionId: input.actionId });
    this._noteContribution(input.participantId);
    this._refreshVoteCounts();
    if (this.state.submissions.length === this.state.participantIds.length) this._completeNode();
    return this.getState();
  }

  resolveEffect(result) {
    if (result?.type !== 'adapter-result' || result.effectId !== this.state.pendingNavigationEffectId) {
      return this.getState();
    }
    const node = this.nodes.get(this.state.nodeId);
    this.state.pendingNavigationEffectId = null;
    this.state.navigation = result.ok
      ? { degraded: false, reason: null, fallbackId: null, matched: [...(result.matched ?? [])] }
      : {
          degraded: true,
          reason: result.reason ?? 'navigation-failed',
          fallbackId: node.fallback.id,
          matched: [...(result.matched ?? [])],
        };
    this.state.status = 'awaiting-submissions';
    this.state.availableActions = this._availableActions(node);
    this._refreshVoteCounts();
    if (!node.safeNode && this.state.pendingDepartureIds.length) {
      this._applyFallback('participant-departure');
    }
    return this.getState();
  }

  getState() {
    return structuredClone(this.state);
  }

  takeEffects() {
    return this.pendingEffects.splice(0).map((effect) => structuredClone(effect));
  }

  _effect(type, details) {
    const effect = { id: `v3-effect-${++this.effectSequence}`, type, ...details };
    this.pendingEffects.push(effect);
    return effect;
  }

  _event(type, details = {}) {
    if (this.state.mode === 'author-playtest') return;
    this._effect('record-adventure-event', {
      event: {
        schemaVersion: 1,
        type,
        runId: this.state.runId,
        packageId: this.package.id,
        packageVersion: this.package.version,
        participantCount: this.state.participantIds.length,
        ...details,
      },
    });
  }

  _assignRoles(participantIds) {
    const configured = this.package.participantRules?.roleAssignments?.[participantIds.length];
    const assignments = configured ?? participantIds.map((_, index) => [COMBAT_ROLES[index]]);
    return Object.fromEntries(participantIds.map((id, index) => [id, [...(assignments[index] ?? [])]]));
  }

  _availableActions(node) {
    const actions = node.interaction.actions.filter((action) =>
      !action.caseId || !this.state.selectedCaseId || action.caseId === this.state.selectedCaseId
    );
    return actions.map((action) => ({ ...action }));
  }

  _enterNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown adventure node ${nodeId}`);
    if (node.safeNode && this.state.pendingDepartureIds.length) {
      const pending = new Set(this.state.pendingDepartureIds);
      const remaining = this.state.participantIds.filter((id) => !pending.has(id));
      if (remaining.length) this.state.participantIds = remaining;
      this.state.pendingDepartureIds = [];
      this.state.roleAssignments = this._assignRoles(this.state.participantIds);
    }
    if (node.interaction.type !== 'combat') {
      const participantIndex = this.state.navigationTurnCount % this.state.participantIds.length;
      this.state.navigatorParticipantId = this.state.participantIds[participantIndex];
      this.state.navigationTurnCount += 1;
    }
    this.state.visitedAnchorCount += 1;
    this.state.nodeId = node.id;
    this.state.segment = node.segment;
    this.state.status = 'awaiting-navigation';
    this.state.submissions = [];
    this.state.availableActions = [];
    this.state.voteCounts = {};
    this.state.evidenceDecisions = {};
    this.state.evidenceDecisionCounts = { use: 0, skip: 0 };
    this.state.failureCount = 0;
    this.state.navigation = { degraded: false, reason: null, fallbackId: null, matched: [] };
    this.state.streetViewLocked = node.interaction.type === 'combat';
    const effect = this._effect('navigate-street-view', {
      nodeId: node.id,
      target: structuredClone(node.streetViewTarget),
      navigatorParticipantId: this.state.navigatorParticipantId,
    });
    this.state.pendingNavigationEffectId = effect.id;
    this._effect('set-street-view-lock', {
      locked: this.state.streetViewLocked,
      managedNavigation: node.interaction.type !== 'combat',
      navigatorParticipantId: this.state.navigatorParticipantId,
    });
  }

  _noteContribution(participantId) {
    this.state.contributionSequence += 1;
    this.state.lastContribution = { participantId, sequence: this.state.contributionSequence };
  }

  _controlStreetView(input) {
    const commands = new Set(['turn-left', 'turn-right', 'step-forward']);
    if (this.state.streetViewLocked || this.state.status === 'complete' ||
        input.participantId !== this.state.navigatorParticipantId || !commands.has(input.command)) {
      return this.getState();
    }
    this._effect('control-street-view', {
      participantId: input.participantId,
      command: input.command,
    });
    return this.getState();
  }

  _refreshVoteCounts() {
    this.state.voteCounts = Object.fromEntries(this.state.availableActions.map((action) => [
      action.id,
      this.state.submissions.filter((submission) => submission.actionId === action.id).length,
    ]));
  }

  _removeParticipant(participantId) {
    if (!this.state.participantIds.includes(participantId) || this.state.participantIds.length === 1) {
      return this.getState();
    }
    const node = this.nodes.get(this.state.nodeId);
    if (!node.safeNode) {
      if (!this.state.pendingDepartureIds.includes(participantId)) {
        this.state.pendingDepartureIds.push(participantId);
      }
      if (this.state.status === 'awaiting-submissions') this._applyFallback('participant-departure');
      return this.getState();
    }
    this.state.participantIds = this.state.participantIds.filter((id) => id !== participantId);
    this.state.submissions = this.state.submissions.filter((item) => item.participantId !== participantId);
    this.state.roleAssignments = this._assignRoles(this.state.participantIds);
    if (!this.state.participantIds.includes(this.state.navigatorParticipantId)) {
      this.state.navigatorParticipantId = this.state.participantIds[0];
    }
    if (this.state.status === 'awaiting-evidence-tiebreak') {
      delete this.state.evidenceDecisions[participantId];
      const decisions = Object.values(this.state.evidenceDecisions);
      this.state.evidenceDecisionCounts = {
        use: decisions.filter(Boolean).length,
        skip: decisions.filter((decision) => !decision).length,
      };
      if (decisions.length === this.state.participantIds.length) {
        const { use, skip } = this.state.evidenceDecisionCounts;
        const navigatorDecision = this.state.evidenceDecisions[this.state.navigatorParticipantId];
        this._finalizeNode(this._resolveVoteWithPolicy(use === skip ? navigatorDecision : use > skip));
      }
    }
    this._refreshVoteCounts();
    if (this.state.status === 'awaiting-submissions' && node.interaction.type !== 'combat' &&
        this.state.submissions.length === this.state.participantIds.length) this._completeNode();
    return this.getState();
  }

  _recordFailure(reason = 'interaction-failed') {
    if (this.state.status !== 'awaiting-submissions') return this.getState();
    this.state.failureCount += 1;
    const node = this.nodes.get(this.state.nodeId);
    const maxAttempts = node.fallback.maxAttempts ?? 3;
    if (this.state.failureCount >= maxAttempts) this._applyFallback(reason);
    return this.getState();
  }

  _applyFallback(reason) {
    const node = this.nodes.get(this.state.nodeId);
    const action = this.state.availableActions.find((item) => item.id === node.fallback.actionId) ??
      this.state.availableActions[0];
    this.state.lastFallback = { id: node.fallback.id, reason };
    if (node.interaction.type === 'combat') {
      this.state.submissions = [];
      this._finalizeNode({
        winningActionId: action.id,
        strategy: 'authored-accessibility-fallback',
        voteCounts: Object.fromEntries(this.state.availableActions.map((item) => [item.id, 0])),
      });
      return;
    } else {
      this.state.submissions = this.state.participantIds.map((participantId) => ({
        participantId, actionId: action.id, fallback: true,
      }));
    }
    this._refreshVoteCounts();
    this._completeNode();
  }

  _resolveVote(node, evidence) {
    const actionOrder = this.state.availableActions.map((action) => action.id);
    const votes = new Map(actionOrder.map((actionId) => [actionId, 0]));
    for (const submission of this.state.submissions) {
      votes.set(submission.actionId, (votes.get(submission.actionId) ?? 0) + 1);
    }
    const maxVotes = Math.max(...votes.values());
    const tiedActionIds = actionOrder.filter((actionId) => votes.get(actionId) === maxVotes);
    let winningActionId = tiedActionIds[0];
    let strategy = tiedActionIds.length === 1 ? 'majority' : 'authored-order';
    for (const tieBreak of this.package.participantRules?.voting?.tieBreak ?? []) {
      if (tiedActionIds.length < 2) break;
      if (tieBreak === 'evidence') {
        const supported = node.interaction.actions.filter((action) =>
          tiedActionIds.includes(action.id) && action.tieBreakEvidenceId && evidence.has(action.tieBreakEvidenceId)
        );
        if (supported.length === 1) {
          winningActionId = supported[0].id;
          strategy = 'evidence';
          break;
        }
      }
      if (tieBreak === 'navigator') {
        const submission = this.state.submissions.find((item) =>
          item.participantId === this.state.navigatorParticipantId && tiedActionIds.includes(item.actionId)
        );
        if (submission) {
          winningActionId = submission.actionId;
          strategy = 'navigator';
          break;
        }
      }
    }
    return { winningActionId, strategy, voteCounts: Object.fromEntries(votes) };
  }

  _decideEvidenceTieBreak(input) {
    if (this.state.status !== 'awaiting-evidence-tiebreak' ||
        !this.state.participantIds.includes(input.participantId) ||
        typeof input.useEvidence !== 'boolean' ||
        Object.hasOwn(this.state.evidenceDecisions, input.participantId)) return this.getState();
    this.state.evidenceDecisions[input.participantId] = input.useEvidence;
    this.state.evidenceDecisionCounts[input.useEvidence ? 'use' : 'skip'] += 1;
    if (Object.keys(this.state.evidenceDecisions).length < this.state.participantIds.length) {
      return this.getState();
    }
    const { use, skip } = this.state.evidenceDecisionCounts;
    const navigatorDecision = this.state.evidenceDecisions[this.state.navigatorParticipantId];
    const useEvidence = use === skip ? navigatorDecision : use > skip;
    this._finalizeNode(this._resolveVoteWithPolicy(useEvidence));
    return this.getState();
  }

  _resolveVoteWithPolicy(useEvidence) {
    const node = this.nodes.get(this.state.nodeId);
    const evidence = new Set(this.state.evidenceIds);
    const actionOrder = this.state.availableActions.map((action) => action.id);
    const votes = new Map(actionOrder.map((actionId) => [actionId, 0]));
    for (const submission of this.state.submissions) {
      votes.set(submission.actionId, (votes.get(submission.actionId) ?? 0) + 1);
    }
    const maxVotes = Math.max(...votes.values());
    const tiedActionIds = actionOrder.filter((actionId) => votes.get(actionId) === maxVotes);
    if (tiedActionIds.length === 1) {
      return { winningActionId: tiedActionIds[0], strategy: 'majority', voteCounts: Object.fromEntries(votes) };
    }
    if (useEvidence) {
      const supported = node.interaction.actions.filter((action) =>
        tiedActionIds.includes(action.id) && action.tieBreakEvidenceId && evidence.has(action.tieBreakEvidenceId));
      if (supported.length === 1) {
        return { winningActionId: supported[0].id, strategy: 'evidence', voteCounts: Object.fromEntries(votes) };
      }
    }
    const navigatorVote = this.state.submissions.find((item) =>
      item.participantId === this.state.navigatorParticipantId && tiedActionIds.includes(item.actionId));
    return {
      winningActionId: navigatorVote?.actionId ?? tiedActionIds[0],
      strategy: navigatorVote ? 'navigator' : 'authored-order',
      voteCounts: Object.fromEntries(votes),
    };
  }

  _completeNode() {
    const node = this.nodes.get(this.state.nodeId);
    const evidence = new Set(this.state.evidenceIds);
    const resolution = this._resolveVote(node, evidence);
    const maxVotes = Math.max(...Object.values(resolution.voteCounts));
    const tiedCount = Object.values(resolution.voteCounts).filter((count) => count === maxVotes).length;
    if (node.interaction.type === 'vote' && tiedCount > 1 &&
        this.package.participantRules?.voting?.evidenceDecision === 'group') {
      this.state.status = 'awaiting-evidence-tiebreak';
      this.state.evidenceDecisions = {};
      this.state.evidenceDecisionCounts = { use: 0, skip: 0 };
      return;
    }
    this._finalizeNode(resolution);
  }

  _finalizeNode(resolution) {
    const node = this.nodes.get(this.state.nodeId);
    const evidence = new Set(this.state.evidenceIds);
    const winningAction = node.interaction.actions.find((action) =>
      action.id === resolution.winningActionId
    );
    for (const id of node.interaction.grantsEvidence ?? []) evidence.add(id);
    for (const id of winningAction?.grantsEvidence ?? []) evidence.add(id);
    this.state.evidenceIds = [...evidence];
    this.state.lastResolution = resolution;
    if (winningAction?.selectsCaseId) {
      this.state.selectedCaseId = winningAction.selectsCaseId;
      this._event('case-selected', { caseId: winningAction.selectsCaseId });
    }

    const outgoing = this.edges.get(node.id) ?? [];
    const nextEdge = outgoing.find((edge) => edge.actionId === resolution.winningActionId) ??
      outgoing.find((edge) => !edge.actionId) ??
      (outgoing.length === 1 ? outgoing[0] : null);
    if (nextEdge) {
      this._enterNode(nextEdge.to);
      return;
    }

    const ending = this.package.endings.find((candidate) =>
      (!this.state.selectedCaseId || candidate.caseId === this.state.selectedCaseId) &&
      candidate.requiresEvidence.every((id) => evidence.has(id))
    );
    if (!ending) throw new Error('No ending matches the collected evidence');
    this.state.status = 'complete';
    this.state.availableActions = [];
    this.state.voteCounts = {};
    this.state.endingId = ending.id;
    this.state.streetViewLocked = false;
    if (this.state.mode === 'author-playtest') return;
    this._effect('set-street-view-lock', { locked: false });
    this._event('adventure-completed', { caseId: ending.caseId, endingId: ending.id });
    this._effect('persist-discovery', {
      packageId: this.package.id,
      packageVersion: this.package.version,
      caseId: ending.caseId,
      endingId: ending.id,
      cultureCard: { id: ending.cultureCard.id, endingId: ending.id },
    });
  }

  _submitCompletionSignal(input) {
    const ending = this.package.endings.find((item) => item.id === this.state.endingId);
    const shared = { caseId: ending.caseId, endingId: ending.id };
    if (input?.type === 'culture-card-propagation' && PROPAGATION_METHODS.has(input.method)) {
      this._event('culture-card-propagated', { ...shared, method: input.method });
    } else if (input?.type === 'city-interest' &&
        !this.state.nextCityInterestId && this.package.nextCityIntentions?.includes(input.cityId)) {
      this.state.nextCityInterestId = input.cityId;
      this._event('next-city-interest', { ...shared, cityId: input.cityId });
    }
    return this.getState();
  }
}
