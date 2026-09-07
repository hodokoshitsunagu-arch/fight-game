import { AdventureSession } from './AdventureSession.js';

export class AdventureRuntime {
  constructor({ adventurePackage, participantIds, streetView, discoveryStore, hud }) {
    this.package = adventurePackage;
    this.participantIds = participantIds;
    this.streetView = streetView;
    this.discoveryStore = discoveryStore;
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
    this.session.submit(input);
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
      for (const effect of effects) {
        if (effect.type === 'navigate-street-view') {
          const outcome = await this.streetView.navigate(effect);
          this.session.resolveEffect(outcome);
        } else if (effect.type === 'persist-discovery') {
          this.discoveryStore.apply(effect, this.package);
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
      sources: this.package.sources.filter((source) => sourceIds.has(source.id)),
    });
  }
}
