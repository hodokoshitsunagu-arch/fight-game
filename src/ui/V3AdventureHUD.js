import { createCultureCardBlob } from './CultureCardArtifact.js';

const SEGMENT_LABELS = {
  'shared-opening': '共享开场',
  case: '案件锚点',
  'final-reasoning': '最终推理',
};

const NEXT_CITIES = {
  london: '伦敦', paris: '巴黎', rome: '罗马', cairo: '开罗', istanbul: '伊斯坦布尔',
  mumbai: '孟买', bangkok: '曼谷', tokyo: '东京', sydney: '悉尼',
};

export class V3AdventureHUD {
  constructor(parent = document.body) {
    document.body.classList.add('is-v3-adventure');
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
      <div class="v3-adventure-hud__votes" aria-label="公开票数"></div>
      <div class="v3-adventure-hud__actions"></div>
      <div class="v3-adventure-hud__completion"></div>
      <div class="v3-adventure-hud__disclosure"></div>
      <div class="v3-adventure-hud__sources"></div>
    `;
    parent.appendChild(this.wrapper);
    for (const name of ['eyebrow', 'title', 'status', 'fact', 'fantasy', 'prompt', 'votes', 'actions', 'completion', 'disclosure', 'sources']) {
      this[name] = this.wrapper.querySelector(`.v3-adventure-hud__${name}`);
    }
    this.onSubmit = null;
    this.state = null;
    this.lastEchoSequence = 0;
    this._onKeyDown = (event) => this._handleKey(event);
    window.addEventListener('keydown', this._onKeyDown);
  }

  bind(onSubmit) {
    this.onSubmit = onSubmit;
  }

  render(state) {
    this.state = state;
    const node = state.node;
    this.wrapper.classList.toggle('is-combat', state.streetViewLocked);
    document.body.classList.toggle('is-streetview-navigation', !state.streetViewLocked);
    this.eyebrow.textContent = `${state.packageTitle} · ${SEGMENT_LABELS[state.segment] ?? '准备'}`;
    this.title.textContent = state.status === 'complete'
      ? state.ending?.title ?? '冒险完成'
      : node?.title ?? '正在准备冒险';
    this.fact.textContent = node?.fact ? `史实｜${node.fact}` : '';
    this.fantasy.textContent = node?.fantasy ? `奇幻｜${node.fantasy}` : '';
    this.prompt.textContent = state.status === 'complete'
      ? '案件、结局和文化卡发现已保存在本设备；未完成局从未写入存档。'
      : node?.interaction?.prompt ?? '';
    if (state.status === 'awaiting-navigation') this.status.textContent = '正在校准街景语义目标…';
    else if (state.status === 'awaiting-evidence-tiebreak') {
      this.status.textContent = '案件票数平局 · 小组正在公开决定是否使用证据线索';
    }
    else if (state.streetViewLocked) this.status.textContent = state.navigation.degraded
      ? `战斗中街景已锁定；街景不可达（${state.navigation.reason}），使用确定性回退。`
      : '战斗中街景已锁定 · 四类职责共同保护案件证据';
    else if (state.status === 'complete') this.status.textContent = `结局：${state.endingId}`;
    else if (state.navigation.degraded) {
      this.status.textContent = `街景不可达（${state.navigation.reason}）；已使用确定性公开回退继续。`;
    } else {
      const navigatorIndex = state.participantIds.indexOf(state.navigatorParticipantId) + 1;
      this.status.textContent = `本锚点导航者 P${navigatorIndex} · ${state.submissions.length}/${state.participantIds.length} 人已提交`;
    }
    this._renderVotes(state);
    this._renderActions(state);
    this._renderCompletion(state);
    this._renderDisclosure(state.eventDisclosure);
    this._renderSources(state.sources);
  }

  _renderVotes(state) {
    this.votes.replaceChildren();
    if (state.status !== 'awaiting-submissions' || state.node?.interaction?.type !== 'vote') return;
    for (const action of state.availableActions) {
      const item = document.createElement('span');
      item.textContent = `${action.label.split('｜')[0]} ${state.voteCounts[action.id] ?? 0}`;
      this.votes.appendChild(item);
    }
  }

  _renderActions(state) {
    this.actions.replaceChildren();
    if (state.status === 'awaiting-evidence-tiebreak') {
      this._renderEvidenceTieBreak(state);
      return;
    }
    if (state.status !== 'awaiting-submissions') return;
    const combat = state.node?.interaction?.type === 'combat';
    for (const [index, participantId] of state.participantIds.entries()) {
      const zone = document.createElement('section');
      zone.className = 'v3-adventure-hud__zone';
      zone.dataset.participant = String(index + 1);
      const heading = document.createElement('strong');
      const roles = state.roleAssignments[participantId] ?? [];
      heading.textContent = combat
        ? `P${index + 1} · ${roles.join(' + ')}`
        : `P${index + 1}${participantId === state.navigatorParticipantId ? ' · 导航者' : ''}`;
      zone.appendChild(heading);

      if (!combat && participantId === state.navigatorParticipantId) {
        const controls = document.createElement('div');
        controls.className = 'v3-adventure-hud__navigator-controls';
        for (const [command, label] of [
          ['turn-left', '左转'], ['step-forward', '前进'], ['turn-right', '右转'],
        ]) {
          const control = document.createElement('button');
          control.type = 'button';
          control.dataset.navigationControl = 'true';
          control.textContent = label;
          control.addEventListener('click', () => this.onSubmit?.({
            type: 'navigator-command', participantId, command,
          }));
          controls.appendChild(control);
        }
        zone.appendChild(controls);
      }

      const submitted = state.submissions.filter((item) => item.participantId === participantId);
      const actions = combat
        ? state.availableActions.filter((action) => roles.includes(action.role))
        : state.availableActions;
      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = combat
          ? submitted.some((item) => item.role === action.role)
          : submitted.length > 0;
        const votes = state.node?.interaction?.type === 'vote'
          ? ` · ${state.voteCounts[action.id] ?? 0} 票` : '';
        button.textContent = button.disabled ? `已贡献 · ${action.label}` : `${action.label}${votes}`;
        button.addEventListener('click', () => {
          this.onSubmit?.({
            type: 'participant-submission',
            participantId,
            actionId: action.id,
            ...(action.role ? { role: action.role } : {}),
          });
        });
        zone.appendChild(button);
      }
      if (state.node?.safeNode && state.participantIds.length > 1) {
        const leave = document.createElement('button');
        leave.type = 'button';
        leave.className = 'v3-adventure-hud__leave';
        leave.textContent = `P${index + 1} 离场并重组`;
        leave.addEventListener('click', () => this.onSubmit?.({
          type: 'participant-departure', participantId,
        }));
        zone.appendChild(leave);
      }
      if (state.lastContribution?.participantId === participantId &&
          state.lastContribution.sequence > this.lastEchoSequence) {
        zone.classList.add('has-echo');
      }
      this.actions.appendChild(zone);
    }
    this.lastEchoSequence = Math.max(this.lastEchoSequence, state.lastContribution?.sequence ?? 0);
    const fallbackButton = document.createElement('button');
    fallbackButton.type = 'button';
    fallbackButton.className = 'v3-adventure-hud__fallback';
    fallbackButton.textContent = `无法完成 / 获取提示（${Math.min(3, state.failureCount + 1)}/3）`;
    fallbackButton.addEventListener('click', () => this.onSubmit?.({
      type: 'interaction-failure', reason: combat ? 'combat-unavailable' : 'missing-input',
    }));
    this.actions.appendChild(fallbackButton);
  }

  _renderEvidenceTieBreak(state) {
    const note = document.createElement('p');
    note.textContent = `案件票数平局。小组公开决定是否使用已发现证据：使用 ${state.evidenceDecisionCounts.use} / 不使用 ${state.evidenceDecisionCounts.skip}`;
    this.actions.appendChild(note);
    for (const [index, participantId] of state.participantIds.entries()) {
      const zone = document.createElement('section');
      zone.className = 'v3-adventure-hud__zone';
      const heading = document.createElement('strong');
      heading.textContent = `P${index + 1}${participantId === state.navigatorParticipantId ? ' · 导航者' : ''}`;
      zone.appendChild(heading);
      for (const [useEvidence, label] of [[true, '使用证据线索'], [false, '保留证据，交导航者裁决']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = Object.hasOwn(state.evidenceDecisions, participantId);
        button.textContent = label;
        button.addEventListener('click', () => this.onSubmit?.({
          type: 'evidence-tiebreak-decision', participantId, useEvidence,
        }));
        zone.appendChild(button);
      }
      this.actions.appendChild(zone);
    }
  }

  _renderCompletion(state) {
    this.completion.replaceChildren();
    if (state.status !== 'complete') return;
    const share = document.createElement('button');
    share.type = 'button';
    share.textContent = '系统分享文化卡';
    share.disabled = !navigator.share || typeof File === 'undefined';
    share.addEventListener('click', async () => {
      try {
        const blob = await createCultureCardBlob(state.ending);
        const file = new File([blob], `${state.endingId}-culture-card.png`, { type: 'image/png' });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) return;
        await navigator.share({ title: state.ending?.title, files: [file] });
        await this.onSubmit?.({ type: 'culture-card-propagation', method: 'system-share-success' });
      } catch {}
    });
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = '下载文化卡';
    download.addEventListener('click', async () => {
      const blob = await createCultureCardBlob(state.ending);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${state.endingId}-culture-card.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      await this.onSubmit?.({ type: 'culture-card-propagation', method: 'download-initiated' });
    });
    this.completion.append(share, download);
    const truth = document.createElement('p');
    truth.textContent = `案件客观谜底｜${state.ending?.caseTruth ?? ''}`;
    const mystery = document.createElement('p');
    mystery.textContent = `城市总谜团｜${state.ending?.cityMystery ?? ''}`;
    this.completion.append(truth, mystery);
    const cityTitle = document.createElement('p');
    cityTitle.textContent = '还想探索哪座城市？选择只记录意向，不会进入未验证城市。';
    this.completion.appendChild(cityTitle);
    if (state.nextCityInterestId) {
      const selected = document.createElement('p');
      selected.textContent = `${NEXT_CITIES[state.nextCityInterestId]} · 敬请期待。本局不会进入尚未验证的城市。`;
      this.completion.appendChild(selected);
      return;
    }
    const cities = document.createElement('div');
    cities.className = 'v3-adventure-hud__cities';
    for (const cityId of state.nextCityIntentions ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = NEXT_CITIES[cityId];
      button.addEventListener('click', () => this.onSubmit?.({ type: 'city-interest', cityId }));
      cities.appendChild(button);
    }
    this.completion.appendChild(cities);
  }

  _renderDisclosure(disclosure) {
    this.disclosure.replaceChildren();
    if (!disclosure) return;
    this.disclosure.textContent = `事件数据说明｜字段：${disclosure.fields}。目的：${disclosure.purpose}。保留：${disclosure.retention}。`;
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
    const zone = this.actions.querySelectorAll('.v3-adventure-hud__zone')[index];
    const button = [...(zone?.querySelectorAll('button:not([data-navigation-control])') ?? [])]
      .find((item) => !item.disabled);
    if (!button) return;
    event.preventDefault();
    button.click();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    document.body.classList.remove('is-streetview-navigation');
    document.body.classList.remove('is-v3-adventure');
    this.wrapper.remove();
  }
}
