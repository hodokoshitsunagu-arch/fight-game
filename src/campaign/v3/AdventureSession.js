import { validateAdventurePackage } from './AdventurePackageValidator.js';

export class AdventureSession {
  constructor(adventurePackage) {
    const errors = validateAdventurePackage(adventurePackage, { level: 'development' });
    if (errors.length) throw new Error(`Invalid adventure package: ${errors.join('; ')}`);
    this.package = adventurePackage;
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
      status: 'idle',
      nodeId: null,
      segment: null,
      participantIds: [],
      submissions: [],
      availableActions: [],
      evidenceIds: [],
      navigation: { degraded: false, reason: null, fallbackId: null },
      endingId: null,
      mode: 'player',
    };
  }

  start({ participantIds, startNodeId = null, mode = 'player' }) {
    const unique = [...new Set(participantIds ?? [])];
    if (unique.length < 1 || unique.length > 4) throw new Error('Adventure sessions require 1–4 participants');
    if (!['player', 'author-playtest'].includes(mode)) throw new Error(`Unknown adventure mode ${mode}`);
    const firstNodeId = startNodeId ?? this.package.graph.startNodeId;
    if (!this.nodes.has(firstNodeId)) throw new Error(`Unknown adventure node ${firstNodeId}`);
    this.pendingEffects = [];
    this.state = { ...this._freshState(), participantIds: unique, mode };
    if (mode === 'author-playtest') {
      this.state.evidenceIds = [...(this.nodes.get(firstNodeId).interaction?.requiresEvidence ?? [])];
    }
    this._enterNode(firstNodeId);
    return this.getState();
  }

  submit(input) {
    if (input?.type !== 'participant-submission' || this.state.status !== 'awaiting-submissions') {
      return this.getState();
    }
    if (!this.state.participantIds.includes(input.participantId) ||
        !this.state.availableActions.some((action) => action.id === input.actionId) ||
        this.state.submissions.some((submission) => submission.participantId === input.participantId)) {
      return this.getState();
    }
    this.state.submissions.push({ participantId: input.participantId, actionId: input.actionId });
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
      ? { degraded: false, reason: null, fallbackId: null }
      : { degraded: true, reason: result.reason ?? 'navigation-failed', fallbackId: node.fallback.id };
    this.state.status = 'awaiting-submissions';
    this.state.availableActions = node.interaction.actions.map((action) => ({ ...action }));
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

  _enterNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown adventure node ${nodeId}`);
    this.state.nodeId = node.id;
    this.state.segment = node.segment;
    this.state.status = 'awaiting-navigation';
    this.state.submissions = [];
    this.state.availableActions = [];
    this.state.navigation = { degraded: false, reason: null, fallbackId: null };
    const effect = this._effect('navigate-street-view', {
      nodeId: node.id,
      target: structuredClone(node.streetViewTarget),
    });
    this.state.pendingNavigationEffectId = effect.id;
  }

  _completeNode() {
    const node = this.nodes.get(this.state.nodeId);
    const evidence = new Set(this.state.evidenceIds);
    for (const id of node.interaction.grantsEvidence ?? []) evidence.add(id);
    this.state.evidenceIds = [...evidence];
    const outgoing = this.edges.get(node.id) ?? [];
    const actionOrder = node.interaction.actions.map((action) => action.id);
    const votes = new Map(actionOrder.map((actionId) => [actionId, 0]));
    for (const submission of this.state.submissions) {
      votes.set(submission.actionId, (votes.get(submission.actionId) ?? 0) + 1);
    }
    const winningActionId = actionOrder.reduce((winner, actionId) =>
      (votes.get(actionId) ?? 0) > (votes.get(winner) ?? -1) ? actionId : winner
    , actionOrder[0]);
    const nextEdge = outgoing.find((edge) => edge.actionId === winningActionId) ??
      outgoing.find((edge) => !edge.actionId) ??
      (outgoing.length === 1 ? outgoing[0] : null);
    if (nextEdge) {
      this._enterNode(nextEdge.to);
      return;
    }

    const ending = this.package.endings.find((candidate) =>
      candidate.requiresEvidence.every((id) => evidence.has(id))
    );
    if (!ending) throw new Error('No ending matches the collected evidence');
    this.state.status = 'complete';
    this.state.availableActions = [];
    this.state.endingId = ending.id;
    if (this.state.mode === 'author-playtest') return;
    this._effect('persist-discovery', {
      packageId: this.package.id,
      packageVersion: this.package.version,
      caseId: ending.caseId,
      endingId: ending.id,
      cultureCard: { id: ending.cultureCard.id, endingId: ending.id },
    });
  }
}
