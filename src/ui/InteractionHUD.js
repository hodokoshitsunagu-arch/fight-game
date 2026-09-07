import { sourcesForAnchor } from '../campaign/cityChapters.js';
import { answerOptions, interactionLabel, navigationBrief } from '../campaign/InteractionRegistry.js';

/** A single accessible surface for every non-spell campaign interaction. */
export class InteractionHUD {
  constructor(root = document.body) {
    this.root = root;
    this.wrapper = document.createElement('section');
    this.wrapper.className = 'interaction-hud is-hidden';
    this.wrapper.setAttribute('aria-live', 'polite');
    this.wrapper.innerHTML = `
      <div class="interaction-hud__panel" role="dialog" aria-modal="false" aria-labelledby="campaign-interaction-title">
        <div class="interaction-hud__topline">
          <span data-kind></span>
          <span class="interaction-hud__topline-actions">
            <span data-step></span>
            <button type="button" class="interaction-hud__collapse" data-collapse aria-expanded="true">收起</button>
          </span>
        </div>
        <h2 id="campaign-interaction-title" data-title></h2>
        <p class="interaction-hud__fact" data-fact></p>
        <p class="interaction-hud__fantasy" data-fantasy></p>
        <p class="interaction-hud__prompt" data-prompt></p>
        <div class="interaction-hud__choices" data-choices></div>
        <p class="interaction-hud__feedback" data-feedback></p>
        <button type="button" class="interaction-hud__recovery" data-recovery hidden>无法继续？跳过本场战斗</button>
        <div class="interaction-hud__source-row">
          <button type="button" class="interaction-hud__source-button" data-source-button aria-expanded="false">ⓘ 史实来源</button>
          <span data-route></span>
        </div>
        <aside class="interaction-hud__source" data-source hidden>
        </aside>
      </div>`;
    root.appendChild(this.wrapper);

    const q = (name) => this.wrapper.querySelector(`[data-${name}]`);
    this.kindEl = q('kind');
    this.stepEl = q('step');
    this.titleEl = q('title');
    this.factEl = q('fact');
    this.fantasyEl = q('fantasy');
    this.promptEl = q('prompt');
    this.choicesEl = q('choices');
    this.feedbackEl = q('feedback');
    this.collapseButton = q('collapse');
    this.recoveryButton = q('recovery');
    this.routeEl = q('route');
    this.sourceButton = q('source-button');
    this.sourceEl = q('source');
    this._submit = null;
    this.onSkipCombat = null;

    this.sourceButton.addEventListener('click', () => this.toggleSource());
    this.collapseButton.addEventListener('click', () => this.setCollapsed(!this.wrapper.classList.contains('is-collapsed')));
    this.recoveryButton.addEventListener('click', () => this.onSkipCombat?.());
    this.wrapper.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.wrapper.addEventListener('click', (event) => event.stopPropagation());
    this._onKeyDown = (event) => this._handleKey(event);
    window.addEventListener('keydown', this._onKeyDown);
  }

  present({ chapter, anchor, interaction = anchor?.interaction, followUp = null, attempt = 0, hint = '' }, onSubmit) {
    const task = followUp ?? interaction;
    this._combatInteraction = null;
    this._submit = onSubmit;
    this.wrapper.classList.remove('is-hidden', 'is-combat');
    this.wrapper.classList.toggle('is-question', ['dialogue', 'quiz', 'puzzle'].includes(task?.type));
    this._setStreetViewNavigation(true);
    this.setCollapsed(false);
    this.recoveryButton.hidden = true;
    this.kindEl.textContent = followUp?.label ?? (followUp ? '地点解谜' : interactionLabel(interaction));
    this.stepEl.textContent = `${chapter.order}/10 · ${anchor.order}/8`;
    this.titleEl.textContent = `${chapter.zh} · ${anchor.name}`;
    this.factEl.textContent = `史实｜${anchor.fact}`;
    this.fantasyEl.textContent = interaction?.legend ? `奇幻｜${interaction.legend}是遗物制造的异常化身。` : '';
    this.fantasyEl.hidden = !interaction?.legend;
    this.promptEl.textContent = task?.prompt ?? '';
    this.feedbackEl.textContent = hint || (attempt ? `第 ${attempt} 次提示` : '');
    this.feedbackEl.classList.remove('is-success');
    this.feedbackEl.classList.toggle('is-visible', Boolean(hint || attempt));
    this.routeEl.textContent = anchor.routeStatus === 'verified' ? '路线已核验' : '坐标待在线核验';
    this._renderChoices(task, interaction?.type === 'collect');
    this._setSources(sourcesForAnchor(chapter, anchor));
  }

  showNavigation({ chapter, anchor, fromAnchor = null }) {
    const guidance = navigationBrief(anchor, fromAnchor);
    this._combatInteraction = null;
    this._submit = null;
    this.wrapper.classList.remove('is-hidden', 'is-combat', 'is-question');
    this._setStreetViewNavigation(true);
    this.setCollapsed(false);
    this.recoveryButton.hidden = true;
    this.kindEl.textContent = '地点移动';
    this.stepEl.textContent = `${chapter.order}/10 · ${anchor.order}/8`;
    this.titleEl.textContent = fromAnchor
      ? `${fromAnchor.name} → ${anchor.name}`
      : `抵达 ${chapter.zh} · ${anchor.name}`;
    this.factEl.textContent = guidance.movement;
    this.fantasyEl.hidden = true;
    this.fantasyEl.textContent = '';
    this.promptEl.textContent = guidance.nextTask;
    this.choicesEl.replaceChildren();
    this.feedbackEl.textContent = '正在定位街景；失败时仍会进入下一任务，不会锁关。';
    this.feedbackEl.classList.remove('is-success');
    this.feedbackEl.classList.add('is-visible');
    this.routeEl.textContent = anchor.routeStatus === 'verified' ? '路线已核验' : '坐标待在线核验';
    this._setSources(sourcesForAnchor(chapter, anchor));
  }

  showCombat({ chapter, anchor, remaining }) {
    const interaction = anchor.interaction;
    this._combatInteraction = interaction;
    this._submit = null;
    this.wrapper.classList.remove('is-hidden');
    this.wrapper.classList.add('is-combat');
    this.wrapper.classList.remove('is-question');
    this._setStreetViewNavigation(false);
    this.setCollapsed(false);
    this.kindEl.textContent = interactionLabel(interaction);
    this.stepEl.textContent = `${chapter.order}/10 · ${anchor.order}/8`;
    this.titleEl.textContent = `${chapter.zh} · ${anchor.name}`;
    this.factEl.textContent = `史实｜${anchor.fact}`;
    this.fantasyEl.hidden = false;
    this.fantasyEl.textContent = `奇幻｜${interaction.legend}是遗物制造的异常化身；战斗代表净化。`;
    this.promptEl.textContent = `${interaction.prompt} · 剩余 ${remaining}`;
    this.feedbackEl.textContent = '本地点最多 2 只怪物。选择右侧已解锁法术，再点击场景攻击；清场后完成地点谜题才能前进。HP 归零后 8 秒自动复活。';
    this.feedbackEl.classList.remove('is-success');
    this.feedbackEl.classList.add('is-visible');
    this.choicesEl.replaceChildren();
    this.recoveryButton.hidden = false;
    this.routeEl.textContent = anchor.routeStatus === 'verified' ? '路线已核验' : '坐标待在线核验';
    this._setSources(sourcesForAnchor(chapter, anchor));
  }

  showFeedback(text, { success = false } = {}) {
    this.recoveryButton.hidden = true;
    this.feedbackEl.textContent = text ?? '';
    this.feedbackEl.classList.toggle('is-visible', Boolean(text));
    this.feedbackEl.classList.toggle('is-success', success);
  }

  updateCombatRemaining(remaining) {
    const interaction = this._combatInteraction;
    if (interaction) this.promptEl.textContent = `${interaction.prompt} · 剩余 ${remaining}`;
  }

  showChapterCard({ chapter, mastery, hintsUsed }) {
    this._combatInteraction = null;
    this._submit = null;
    this.wrapper.classList.remove('is-hidden', 'is-combat', 'is-question');
    this._setStreetViewNavigation(true);
    this.setCollapsed(false);
    this.recoveryButton.hidden = true;
    this.kindEl.textContent = '文化资料卡已生成';
    this.stepEl.textContent = `${chapter.order}/10 · 8/8`;
    this.titleEl.textContent = chapter.zh;
    this.factEl.textContent = chapter.theme;
    this.fantasyEl.hidden = false;
    this.fantasyEl.textContent = `异常处理｜${chapter.legend.treatment}`;
    this.promptEl.textContent = `掌握度 ${mastery} · 已用提示 ${hintsUsed}`;
    this.choicesEl.replaceChildren();
    this.feedbackEl.textContent = '八个地点的分支已汇合，可以前往下一座城市。';
    this.feedbackEl.classList.add('is-visible', 'is-success');
    this.routeEl.textContent = '章节完成';
    this._setSources(chapter.sources);
  }

  showRouteResult(result) {
    if (!result) return;
    this.routeEl.textContent = result.ok
      ? result.mode === 'walk' ? '已沿街景连接抵达' : '已通过坐标转场抵达'
      : `街景不可达，已安全转场（${result.reason ?? '未知原因'}）`;
  }

  setVisible(visible) {
    this.wrapper.classList.toggle('is-hidden', !visible);
    if (!visible) {
      this._submit = null;
      this._combatInteraction = null;
      this._setStreetViewNavigation(false);
    }
  }

  setCollapsed(collapsed) {
    this.wrapper.classList.toggle('is-collapsed', collapsed);
    this.collapseButton.textContent = collapsed ? '展开' : '收起';
    this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
  }

  toggleSource(force) {
    const open = typeof force === 'boolean' ? force : this.sourceEl.hidden;
    this.sourceEl.hidden = !open;
    this.sourceButton.setAttribute('aria-expanded', String(open));
  }

  _setStreetViewNavigation(enabled) {
    document.body?.classList.toggle('is-streetview-navigation', enabled);
  }

  _renderChoices(task, collect) {
    this.choicesEl.replaceChildren();
    const options = collect
      ? [{ id: 'collect', label: task.actionLabel ?? '收集地点线索' }]
      : answerOptions(task);
    options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'interaction-hud__choice';
      button.dataset.answer = option.id;
      button.textContent = `${index + 1}. ${option.label}`;
      button.addEventListener('click', () => this._submit?.(option.id));
      this.choicesEl.appendChild(button);
    });
  }

  _setSources(sources) {
    this.sourceEl.replaceChildren();
    for (const source of sources ?? []) {
      const item = document.createElement('div');
      const institution = document.createElement('strong');
      const link = document.createElement('a');
      const date = document.createElement('span');
      institution.textContent = source.institution;
      link.textContent = source.title;
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      date.textContent = `最后核验：${source.verified}`;
      item.append(institution, link, date);
      this.sourceEl.appendChild(item);
    }
    this.toggleSource(false);
  }

  _handleKey(event) {
    if (this.wrapper.classList.contains('is-hidden')) return;
    if (event.key === 'Escape') {
      if (!this.sourceEl.hidden) this.toggleSource(false);
      else this.setCollapsed(!this.wrapper.classList.contains('is-collapsed'));
      return;
    }
    const index = Number(event.key) - 1;
    const buttons = [...this.choicesEl.querySelectorAll('button')];
    if (Number.isInteger(index) && buttons[index]) {
      event.preventDefault();
      buttons[index].click();
    }
  }

  dispose() {
    this.onSkipCombat = null;
    this._setStreetViewNavigation(false);
    window.removeEventListener('keydown', this._onKeyDown);
    this.wrapper.remove();
  }
}
