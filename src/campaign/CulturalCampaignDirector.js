import { settings } from '../config/settings.js';
import {
  CITY_CHAPTERS,
  sceneForChapter,
  unlockedForChapter
} from './cityChapters.js';
import {
  gradeFollowUp,
  gradeInteraction,
  hintFor,
  interactionMode,
  navigationBrief
} from './InteractionRegistry.js';
import {
  clearCulturalProgress,
  freshCulturalProgress,
  loadCulturalProgress,
  saveCulturalProgress
} from './CulturalCampaignSave.js';

export const CULTURAL_STATE = Object.freeze({
  IDLE: 'idle',
  INTRO: 'intro',
  NAVIGATING: 'navigating',
  INTERACTING: 'interacting',
  COMBAT: 'combat',
  RESOLVING: 'resolving',
  CROSSING: 'crossing',
  DONE: 'done'
});

export class CulturalCampaignDirector {
  constructor({
    dummies = null,
    streetView = null,
    scenes = [],
    hud = null,
    interactionHUD = null,
    storage,
    chapters = CITY_CHAPTERS,
    getCurrentSceneId = null
  } = {}) {
    this.dummies = dummies;
    this._streetView = streetView;
    this.scenes = scenes;
    this.hud = hud;
    this.interactionHUD = interactionHUD;
    this.storage = storage;
    this.chapters = chapters;
    this.getCurrentSceneId = getCurrentSceneId;

    this.chapterIndex = 0;
    this.anchorIndex = 0;
    this.state = CULTURAL_STATE.IDLE;
    this.progressData = freshCulturalProgress(chapters);
    this.attempt = 0;
    this.timer = 0;
    this._followUp = false;
    this._combatSkipped = false;
    this._routeResult = null;
    this._navigationToken = 0;
    this._waveRemaining = 0;

    this.onLocationChange = null;
    this.onUnlocks = null;
    if (this.dummies) this.dummies.onCleared = () => this._onCleared();
  }

  get streetView() {
    return typeof this._streetView === 'function' ? this._streetView() : this._streetView;
  }

  get chapter() { return this.chapters[this.chapterIndex] ?? null; }
  get anchor() { return this.chapter?.anchors?.[this.anchorIndex] ?? null; }
  get scene() {
    const id = this.chapter?.sceneId;
    return this.scenes.find((scene) => scene.id === id) ?? sceneForChapter(this.chapter);
  }
  get unlocked() { return unlockedForChapter(this.chapterIndex); }
  get progress() {
    return { done: this.chapterIndex * 8 + this.anchorIndex, total: this.chapters.length * 8 };
  }

  start({ resume = true } = {}) {
    this.dummies?.stop?.();
    this.progressData = resume
      ? loadCulturalProgress(this.storage, this.chapters)
      : freshCulturalProgress(this.chapters);
    this._restoreIndices();
    this._ensureScene();
    this._navigateToCurrent({ arriving: true });
  }

  resume() {
    // Free roam runs an endless dummy field. A non-combat anchor would not
    // otherwise replace that wave, leaving enemies active behind its dialogue.
    this.dummies?.stop?.();
    this._ensureScene();
    this._navigateToCurrent({ arriving: this.anchorIndex === 0 });
  }

  plannedScene() {
    const saved = loadCulturalProgress(this.storage, this.chapters);
    const chapter = this.chapters.find((item) => item.id === saved.chapterId) ?? this.chapters[0];
    const id = chapter?.sceneId;
    return this.scenes.find((scene) => scene.id === id) ?? sceneForChapter(chapter);
  }

  _restoreIndices() {
    this.chapterIndex = Math.max(0, this.chapters.findIndex((item) => item.id === this.progressData.chapterId));
    const chapter = this.chapters[this.chapterIndex];
    this.anchorIndex = Math.max(0, chapter.anchors.findIndex((item) => item.id === this.progressData.anchorId));
  }

  _ensureScene() {
    const scene = this.scene;
    if (!scene || this.getCurrentSceneId?.() === scene.id) return;
    this.onLocationChange?.(scene);
  }

  async _navigateToCurrent({ arriving = false } = {}) {
    const chapter = this.chapter;
    const anchor = this.anchor;
    if (!chapter || !anchor) return this._finish();

    const token = ++this._navigationToken;
    this.state = CULTURAL_STATE.NAVIGATING;
    this.hud?.setLevel?.(chapter, this.anchorIndex, this.scene);
    this.hud?.setProgress?.(this.progress);
    this.hud?.setObjective?.({ remaining: 0, shard: false });
    const previous = this.anchorIndex > 0 ? chapter.anchors[this.anchorIndex - 1] : null;
    const guidance = navigationBrief(anchor, previous);
    this.hud?.setHint?.(`${guidance.movement} ${guidance.nextTask}`);
    this.interactionHUD?.showNavigation?.({ chapter, anchor, fromAnchor: previous });
    this.onUnlocks?.(this.unlocked);
    let result = { ok: false, mode: 'degraded', reason: 'street-view-unavailable' };
    try {
      const view = this.streetView;
      if (view?.moveToAnchor) result = await view.moveToAnchor(anchor, { fromAnchor: previous });
      else if (view?.moveTo) {
        const ok = await view.moveTo(anchor.lat, anchor.lng, anchor.radius);
        result = { ok, mode: ok ? 'coordinate' : 'degraded', reason: ok ? null : 'coordinate-unavailable' };
      }
    } catch (error) {
      result = { ok: false, mode: 'degraded', reason: error?.message ?? 'navigation-error' };
    }
    if (token !== this._navigationToken || this.state === CULTURAL_STATE.IDLE) return;
    this._routeResult = result;
    this._enterAnchor({ arriving });
  }

  _enterAnchor({ arriving = false } = {}) {
    this.attempt = 0;
    this._followUp = false;
    this._combatSkipped = false;
    if (arriving) {
      this.state = CULTURAL_STATE.INTRO;
      this.timer = settings.campaign.introSeconds;
      this.interactionHUD?.setVisible?.(false);
      this.hud?.showCard?.(this.anchor.name, this.chapter.theme, '八个地点将汇合为一张文化资料卡。');
      this.hud?.setHint?.(this._routeMessage());
      return;
    }
    this._beginInteraction();
  }

  _beginInteraction() {
    const interaction = this.anchor?.interaction;
    if (!interaction) return this._completeInteraction('此地点没有可用互动，已跳过。', 0);
    this.hud?.hideCard?.();

    if (interactionMode(interaction) === 'combat') {
      this.state = CULTURAL_STATE.COMBAT;
      const choice = this.progressData.choices[this.chapter.id];
      const insightAssist = this.anchor.order === 7 && choice?.effect === 'insight';
      const count = Math.max(1, interaction.count - (insightAssist ? 1 : 0));
      this._waveRemaining = count;
      this.hud?.setHint?.(insightAssist ? '先前倾听揭示了异常弱点：本场少一名敌人。' : this._routeMessage());
      this.hud?.setObjective?.({ remaining: count, shard: false });
      this.interactionHUD?.showCombat?.({ chapter: this.chapter, anchor: this.anchor, remaining: count });
      this.interactionHUD?.showRouteResult?.(this._routeResult);
      this.dummies?.startWave?.({ roster: interaction.roster, count });
      return;
    }

    this.state = CULTURAL_STATE.INTERACTING;
    this.hud?.setHint?.(this._routeMessage());
    this.interactionHUD?.present?.({ chapter: this.chapter, anchor: this.anchor, attempt: 0 }, (answer) => this.submit(answer));
    this.interactionHUD?.showRouteResult?.(this._routeResult);
  }

  submit(answer) {
    if (this.state !== CULTURAL_STATE.INTERACTING) return false;
    const interaction = this.anchor.interaction;
    const task = this._followUp ? interaction.followUp : interaction;
    const result = this._followUp ? gradeFollowUp(task, answer) : gradeInteraction(task, answer);
    if (!result.accepted) return false;

    if (result.correct) {
      if (interaction.type === 'dialogue') {
        this.progressData.choices[this.chapter.id] = {
          anchorId: this.anchor.id,
          choiceId: result.choiceId,
          effect: result.effect
        };
        if (result.effect === 'momentum') this.progressData.mastery += 1;
      }
      const mastery = this._followUp && this._combatSkipped ? 1 : this.attempt ? 1 : 2;
      return this._completeInteraction('解谜完成。通往下一街景的路线已开启。', mastery);
    }

    return this._registerFailure(task);
  }

  noteScore(result) {
    this.hud?.setScore?.(result);
  }

  _registerFailure(task) {
    this.attempt++;
    this.progressData.hintsUsed++;
    const hint = hintFor(task, this.attempt, this.anchor.fact);
    this.hud?.setHint?.(hint);
    this.hud?.flashHint?.();
    if (this.attempt >= 3) return this._completeInteraction(hint, 0);

    this.interactionHUD?.present?.({
      chapter: this.chapter,
      anchor: this.anchor,
      interaction: this.anchor.interaction,
      followUp: this._followUp ? task : null,
      attempt: this.attempt,
      hint
    }, (next) => this.submit(next));
    return true;
  }

  _onCleared() {
    if (this.state !== CULTURAL_STATE.COMBAT) return;
    this._waveRemaining = 0;
    this._combatSkipped = false;
    this._beginCombatFollowUp('异常已净化。现在根据地点线索解谜，开启下一段街景。');
  }

  _beginCombatFollowUp(message) {
    const followUp = this.anchor.interaction.followUp;
    if (followUp) {
      this.state = CULTURAL_STATE.INTERACTING;
      this._followUp = true;
      this.attempt = 0;
      this.hud?.setObjective?.({ remaining: 0, shard: false });
      this.hud?.setHint?.(message);
      this.interactionHUD?.present?.({ chapter: this.chapter, anchor: this.anchor, followUp }, (answer) => this.submit(answer));
      return true;
    }
    this._completeInteraction('异常化身已净化。', 2);
    return true;
  }

  /** Accessibility/failure escape: a combat encounter may never hard-lock a chapter. */
  skipCombat() {
    if (this.state !== CULTURAL_STATE.COMBAT) return false;
    this.dummies?.stop?.();
    this._waveRemaining = 0;
    this.progressData.hintsUsed++;
    this._combatSkipped = true;
    return this._beginCombatFollowUp('已跳过战斗；完成地点线索解谜后即可进入下一街景。');
  }

  _completeInteraction(message, mastery = 1) {
    this.progressData.mastery += mastery;
    this.progressData.relicFragments++;
    this.state = CULTURAL_STATE.RESOLVING;
    const chapterComplete = this.anchor?.order === 8;
    this.timer = chapterComplete ? 4 : 1.15;
    this.hud?.setObjective?.({ remaining: 0, shard: false });
    this.hud?.showBeat?.(message);
    if (chapterComplete) {
      this.interactionHUD?.showChapterCard?.({
        chapter: this.chapter,
        mastery: this.progressData.mastery,
        hintsUsed: this.progressData.hintsUsed
      });
    } else {
      this.interactionHUD?.showFeedback?.(message, { success: true });
    }
    this._saveAtCurrent();
    return true;
  }

  _advance() {
    if (this.anchorIndex < this.chapter.anchors.length - 1) {
      this.anchorIndex++;
      this._syncProgressLocation();
      this._navigateToCurrent({ arriving: false });
      return;
    }

    if (!this.progressData.completedChapters.includes(this.chapter.id)) {
      this.progressData.completedChapters.push(this.chapter.id);
    }
    if (this.chapterIndex >= this.chapters.length - 1) return this._finish();

    this.chapterIndex++;
    this.anchorIndex = 0;
    this._syncProgressLocation();
    this.state = CULTURAL_STATE.CROSSING;
    this.timer = settings.campaign.transitionSeconds;
    this.hud?.fade?.(true);
    this.interactionHUD?.setVisible?.(false);
    this._ensureScene();
  }

  _crossTo() {
    this.hud?.fade?.(false);
    this._navigateToCurrent({ arriving: true });
  }

  _finish() {
    this.state = CULTURAL_STATE.DONE;
    this.hud?.showDone?.(this.progressData.relicFragments, {
      title: '十城文化战役完成',
      body: `已完成 ${this.progressData.completedChapters.length} 座城市，文化掌握度 ${this.progressData.mastery}。`
    });
    this.interactionHUD?.setVisible?.(false);
    this._saveAtCurrent();
  }

  _routeMessage() {
    if (!this._routeResult) return '';
    if (this._routeResult.ok) return this._routeResult.mode === 'walk' ? '已沿街景连接抵达。' : '已通过坐标转场抵达。';
    return `街景未能定位（${this._routeResult.reason ?? '未知原因'}），剧情已启用确定性回退，不会锁关。`;
  }

  _remaining() {
    const alive = this.dummies?.enemies?.aliveCount ?? 0;
    const queued = this.dummies?.pending?.length ?? 0;
    const unsent = Number.isFinite(this.dummies?.quota) ? this.dummies.quota : 0;
    return alive + queued + unsent;
  }

  _syncProgressLocation() {
    this.progressData.chapterId = this.chapter?.id ?? null;
    this.progressData.anchorId = this.anchor?.id ?? null;
    this._saveAtCurrent();
  }

  _saveAtCurrent() {
    saveCulturalProgress(this.progressData, this.storage, this.chapters);
  }

  update(dt) {
    switch (this.state) {
      case CULTURAL_STATE.INTRO:
        this.timer -= dt;
        if (this.timer <= 0) this._beginInteraction();
        break;
      case CULTURAL_STATE.COMBAT: {
        const remaining = this._remaining();
        this.hud?.setObjective?.({ remaining, shard: false });
        if (remaining !== this._waveRemaining) {
          this._waveRemaining = remaining;
          this.interactionHUD?.updateCombatRemaining?.(remaining);
        }
        break;
      }
      case CULTURAL_STATE.RESOLVING:
        this.timer -= dt;
        if (this.timer <= 0) this._advance();
        break;
      case CULTURAL_STATE.CROSSING:
        this.timer -= dt;
        if (this.timer <= 0) this._crossTo();
        break;
      default:
        break;
    }
  }

  reset() {
    clearCulturalProgress(this.storage);
    this.progressData = freshCulturalProgress(this.chapters);
    this.chapterIndex = 0;
    this.anchorIndex = 0;
  }

  stop() {
    this._navigationToken++;
    this.state = CULTURAL_STATE.IDLE;
    this.dummies?.stop?.();
    this.interactionHUD?.setVisible?.(false);
  }

  dispose() {
    this.stop();
    if (this.dummies) this.dummies.onCleared = null;
  }
}
