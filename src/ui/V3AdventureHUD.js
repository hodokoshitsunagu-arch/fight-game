const SEGMENT_LABELS = {
  'shared-opening': '共享开场',
  case: '案件锚点',
  'final-reasoning': '最终推理',
};

export class V3AdventureHUD {
  constructor(parent = document.body) {
    this.wrapper = document.createElement('section');
    this.wrapper.className = 'v3-adventure-hud';
    this.wrapper.setAttribute('aria-live', 'polite');
    this.wrapper.innerHTML = `
      <div class="v3-adventure-hud__eyebrow"></div>
      <h2 class="v3-adventure-hud__title"></h2>
      <p class="v3-adventure-hud__status"></p>
      <p class="v3-adventure-hud__fact"></p>
      <p class="v3-adventure-hud__fantasy"></p>
      <p class="v3-adventure-hud__prompt"></p>
      <div class="v3-adventure-hud__actions"></div>
      <div class="v3-adventure-hud__sources"></div>
    `;
    parent.appendChild(this.wrapper);
    this.eyebrow = this.wrapper.querySelector('.v3-adventure-hud__eyebrow');
    this.title = this.wrapper.querySelector('.v3-adventure-hud__title');
    this.status = this.wrapper.querySelector('.v3-adventure-hud__status');
    this.fact = this.wrapper.querySelector('.v3-adventure-hud__fact');
    this.fantasy = this.wrapper.querySelector('.v3-adventure-hud__fantasy');
    this.prompt = this.wrapper.querySelector('.v3-adventure-hud__prompt');
    this.actions = this.wrapper.querySelector('.v3-adventure-hud__actions');
    this.sources = this.wrapper.querySelector('.v3-adventure-hud__sources');
    this.onSubmit = null;
    this.state = null;
    this._onKeyDown = (event) => this._handleKey(event);
    window.addEventListener('keydown', this._onKeyDown);
  }

  bind(onSubmit) {
    this.onSubmit = onSubmit;
  }

  render(state) {
    this.state = state;
    const node = state.node;
    this.eyebrow.textContent = `${state.packageTitle} · ${SEGMENT_LABELS[state.segment] ?? '准备'}`;
    this.title.textContent = state.status === 'complete'
      ? state.ending?.title ?? '冒险完成'
      : node?.title ?? '正在准备冒险';
    this.fact.textContent = node?.fact ? `史实｜${node.fact}` : '';
    this.fantasy.textContent = node?.fantasy ? `奇幻｜${node.fantasy}` : '';
    this.prompt.textContent = state.status === 'complete'
      ? '案件发现已保存；未完成局从未写入存档。'
      : node?.interaction?.prompt ?? '';
    if (state.status === 'awaiting-navigation') this.status.textContent = '正在校准街景语义目标…';
    else if (state.navigation.degraded) {
      this.status.textContent = `街景不可达（${state.navigation.reason}）；已使用确定性公开回退继续。`;
    } else if (state.status === 'complete') this.status.textContent = `结局：${state.endingId}`;
    else this.status.textContent = `${state.submissions.length}/${state.participantIds.length} 名参与者已提交`;
    this._renderActions(state);
    this._renderSources(state.sources);
  }

  _renderActions(state) {
    this.actions.replaceChildren();
    if (state.status !== 'awaiting-submissions') return;
    const submitted = new Set(state.submissions.map((item) => item.participantId));
    for (const [index, participantId] of state.participantIds.entries()) {
      const action = state.availableActions[0];
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = submitted.has(participantId);
      button.textContent = button.disabled
        ? `P${index + 1} 已提交`
        : `${index + 1}. P${index + 1} · ${action.label}`;
      button.addEventListener('click', () => this.onSubmit?.({
        type: 'participant-submission',
        participantId,
        actionId: action.id,
      }));
      this.actions.appendChild(button);
    }
  }

  _renderSources(sources) {
    this.sources.replaceChildren();
    for (const source of sources) {
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `来源｜${source.institution} · ${source.title} · ${source.verified}`;
      this.sources.appendChild(link);
    }
  }

  _handleKey(event) {
    const index = Number(event.key) - 1;
    const button = this.actions.querySelectorAll('button')[index];
    if (!button || button.disabled) return;
    event.preventDefault();
    button.click();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    this.wrapper.remove();
  }
}
