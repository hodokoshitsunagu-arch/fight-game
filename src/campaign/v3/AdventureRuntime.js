import { AdventureSession } from './AdventureSession.js';

export class AdventureRuntime {
  constructor({ adventurePackage, participantIds, streetView, discoveryStore, eventSink = null, hud }) {
    this.package = adventurePackage;
    this.participantIds = participantIds;
    this.streetView = streetView;
    this.discoveryStore = discoveryStore;
    this.eventSink = eventSink;
    this.hud = hud;
    this.session = new AdventureSession(adventurePackage);
    this.hud?.bind?.((input) => this.submit(input));
  }

  get state() {
    return this.session.getState();
  }

  plannedScene() {
    const node = this.package.graph.nodes.find((item) => item.id === this.package.graph.startNodeId);
    return node ? {
      id: node.id,
      name: node.title,
      lat: node.streetViewTarget.position.lat,
      lng: node.streetViewTarget.position.lng,
    } : null;
  }

  async start({ startNodeId = null, mode = 'player' } = {}) {
    this.session.start({ participantIds: this.participantIds, startNodeId, mode });
    this._render();
    await this._applyEffects();
  }

  async submit(input) {
    let resolvedInput = input;
    if (input?.type === 'participant-submission') {
      const state = this.session.getState();
      const node = this.package.graph.nodes.find((item) => item.id === state.nodeId);
      const action = state.availableActions.find((item) => item.id === input.actionId);
      if (!state.navigation.degraded && action?.streetViewInput) {
        const observation = this.streetView?.observe?.(node.streetViewTarget);
        resolvedInput = { ...input, streetViewMatched: observation?.matched ?? [] };
      }
    }
    this.session.submit(resolvedInput);
    this._render();
    await this._applyEffects();
  }

  async resume() {
    await this.start();
  }

  async startAuthorPlaytest(startNodeId) {
    await this.start({ startNodeId, mode: 'author-playtest' });
  }

  stop() {}
  update() {}
  noteScore() {}

  dispose() {
    this.hud?.dispose?.();
  }

  async _applyEffects() {
    let effects = this.session.takeEffects();
    while (effects.length) {
      effects.sort((left, right) =>
        Number(right.type === 'set-street-view-lock') - Number(left.type === 'set-street-view-lock'));
      for (const effect of effects) {
        if (effect.type === 'navigate-street-view') {
          const outcome = await this.streetView.navigate(effect);
          this.session.resolveEffect(outcome);
        } else if (effect.type === 'set-street-view-lock') {
          this.streetView?.setLocked?.(effect);
        } else if (effect.type === 'control-street-view') {
          this.streetView?.control?.(effect);
        } else if (effect.type === 'persist-discovery') {
          this.discoveryStore?.apply?.(effect, this.package);
        } else if (effect.type === 'record-adventure-event') {
          // Analytics can fail or be slow without becoming a story progression gate.
          void this.eventSink?.apply?.(effect);
        }
        this._render();
      }
      effects = this.session.takeEffects();
    }
  }

  _render() {
    const state = this.session.getState();
    const node = this.package.graph.nodes.find((item) => item.id === state.nodeId) ?? null;
    const ending = this.package.endings.find((item) => item.id === state.endingId) ?? null;
    const sourceIds = new Set(node?.sourceRefs ?? []);
    this.hud?.render?.({
      ...state,
      packageTitle: this.package.title,
      node,
      ending,
      eventDisclosure: this.eventSink?.disclosure ?? null,
      nextCityIntentions: [...(this.package.nextCityIntentions ?? [])],
      sources: this.package.sources.filter((source) => sourceIds.has(source.id)),
    });
  }
}
