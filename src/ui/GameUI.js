import { AnnouncementSystem } from './AnnouncementSystem.js';

function formatNumber(value) {
  return Math.round(value || 0).toLocaleString('en-US');
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export class GameUI {
  constructor({ onPlay, onRetry, onUpgrade } = {}) {
    this.onPlay = onPlay;
    this.onRetry = onRetry;
    this.onUpgrade = onUpgrade;
    this.root = document.createElement('div');
    this.root.className = 'game-ui';
    this.root.innerHTML = `
      <section class="game-menu is-visible" data-menu>
        <div class="game-menu__kicker">INFINITE HORDE SURVIVAL</div>
        <h1>RELIC: <span>LAST STAND</span></h1>
        <p lang="zh-CN">圣物守护 · 无限尸潮生存</p>
        <button type="button" data-play>PLAY <small>开始守护</small></button>
      </section>

      <section class="session-hud" data-session-hud>
        <div class="session-hud__top">
          <div class="session-stat"><span>WAVE / 波次</span><strong data-wave>0</strong></div>
          <div class="session-stat"><span>SCORE / 分数</span><strong data-score>0</strong></div>
        </div>
        <div class="health-panel health-panel--player">
          <div><span>PLAYER</span><b data-player-hp-text>300 / 300</b></div>
          <i><em data-player-hp></em></i>
        </div>
        <div class="health-panel health-panel--relic">
          <div><span>RELIC CORE / 圣物核心</span><b data-relic-hp-text>1000 / 1000</b></div>
          <i><em data-relic-hp></em></i>
        </div>
        <div class="session-hud__horde"><span>ALIVE <b data-alive>0</b></span><span>INCOMING <b data-pending>0</b></span></div>
      </section>

      <section class="downed-overlay" data-downed>
        <div>YOU HAVE FALLEN</div><strong data-respawn>8.0</strong><p>复活倒计时 · 尸潮正在转攻圣物</p>
      </section>

      <section class="upgrade-screen" data-upgrades>
        <div class="upgrade-screen__clear">WAVE CLEARED <span>波次完成</span></div>
        <h2>CHOOSE YOUR POWER</h2><p>选择你的力量</p>
        <div class="upgrade-grid" data-upgrade-grid></div>
      </section>

      <section class="game-over" data-game-over>
        <div class="game-over__kicker">LAST STAND</div>
        <h2>RELIC LOST</h2><p>圣物已失守</p>
        <div class="game-over__wave"><span>WAVE</span><strong data-final-wave>0</strong></div>
        <div class="game-over__stats">
          <div><span>SCORE</span><b data-final-score>0</b></div>
          <div><span>KILLS</span><b data-final-kills>0</b></div>
          <div><span>TIME</span><b data-final-time>00:00</b></div>
          <div><span>BEST WAVE</span><b data-best-wave>0</b></div>
        </div>
        <button type="button" data-retry>RETRY <small>再次守护</small></button>
      </section>

      <section class="debug-hud" data-debug></section>
    `;
    document.body.appendChild(this.root);
    this.announcement = new AnnouncementSystem(document.body);
    this.menu = this.root.querySelector('[data-menu]');
    this.sessionHud = this.root.querySelector('[data-session-hud]');
    this.downed = this.root.querySelector('[data-downed]');
    this.upgradeScreen = this.root.querySelector('[data-upgrades]');
    this.upgradeGrid = this.root.querySelector('[data-upgrade-grid]');
    this.gameOver = this.root.querySelector('[data-game-over]');
    this.debug = this.root.querySelector('[data-debug]');
    this.wave = this.root.querySelector('[data-wave]');
    this.score = this.root.querySelector('[data-score]');
    this.playerHP = this.root.querySelector('[data-player-hp]');
    this.playerHPText = this.root.querySelector('[data-player-hp-text]');
    this.relicHP = this.root.querySelector('[data-relic-hp]');
    this.relicHPText = this.root.querySelector('[data-relic-hp-text]');
    this.alive = this.root.querySelector('[data-alive]');
    this.pending = this.root.querySelector('[data-pending]');
    this.respawn = this.root.querySelector('[data-respawn]');
    this.root.querySelector('[data-play]').addEventListener('click', () => this.onPlay?.());
    this.root.querySelector('[data-retry]').addEventListener('click', () => this.onRetry?.());
  }

  bind(session) {
    this.session = session;
    this._offs = [
      session.on('game:start', () => {
        this.menu.classList.remove('is-visible');
        this.gameOver.classList.remove('is-visible');
        this.upgradeScreen.classList.remove('is-visible');
        this.downed.classList.remove('is-visible');
        this.sessionHud.classList.add('is-visible');
        this.announcement.show({ key: 'defend', main: 'DEFEND THE RELIC', zh: '守住圣物', tone: 'wave', duration: 1500, priority: 3 });
      }),
      session.on('wave:countdown', ({ countdown }) => this.announcement.show({ key: `count-${countdown}`, main: String(countdown), zh: '准备战斗', tone: 'wave', duration: 720, priority: 2 })),
      session.on('wave:intro', ({ wave, milestone }) => this.announcement.show({
        key: `wave-${wave}`, eyebrow: milestone ? 'ELITE MUTATION DETECTED' : 'THE HORDE IS COMING',
        main: `WAVE ${wave}`, zh: milestone ? `第 ${wave} 波 · 精英尸潮` : `第 ${wave} 波`,
        tone: milestone ? 'elite' : 'wave', duration: milestone ? 1800 : 1300, priority: milestone ? 5 : 3
      })),
      session.on('wave:complete', () => this.announcement.show({ key: 'wave-clear', main: 'WAVE CLEARED', zh: '尸潮已肃清', tone: 'clear', duration: 1150, priority: 4 })),
      session.on('elite:spawn', () => this.announcement.show({ key: 'elite-spawn', eyebrow: 'WARNING', main: 'ELITE MUTATION', zh: '精英变异体已抵达', tone: 'elite', duration: 1700, priority: 6 })),
      session.on('wave:upgrade', ({ offers }) => this.showUpgrades(offers)),
      session.on('upgrade:selected', ({ title, titleZh }) => {
        this.upgradeScreen.classList.remove('is-visible');
        this.announcement.show({ key: 'upgrade-selected', main: title, zh: `${titleZh} · 已获得`, tone: 'clear', duration: 1000, priority: 3 });
      }),
      session.on('relic:warning', ({ level }) => this.announcement.show(level === 'critical'
        ? { key: 'relic-critical', eyebrow: '20% ENERGY REMAINING', main: 'RELIC CRITICAL', zh: '圣物正在崩溃 · 立刻回防', tone: 'critical', duration: 2100, priority: 10 }
        : { key: 'relic-damaged', main: 'RELIC DAMAGED', zh: '圣物受损', tone: 'danger', duration: 1500, priority: 7 })),
      session.on('player:down', () => {
        this.downed.classList.add('is-visible');
        this.announcement.show({ key: 'player-down', main: 'YOU HAVE FALLEN', zh: '尸潮正在转攻圣物', tone: 'critical', duration: 1500, priority: 8 });
      }),
      session.on('player:respawn', () => {
        this.downed.classList.remove('is-visible');
        this.announcement.show({ key: 'respawn', main: 'BACK IN THE FIGHT', zh: '重返战场', tone: 'clear', duration: 950, priority: 4 });
      }),
      session.on('relic:lost', () => this.announcement.show({ key: 'relic-lost', main: 'RELIC LOST', zh: '圣物已失守', tone: 'critical', duration: 2200, priority: 20 })),
      session.on('game:over', (stats) => this.showGameOver(stats))
    ];
  }

  showUpgrades(offers) {
    this.upgradeGrid.replaceChildren();
    offers.forEach((offer, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'upgrade-card';
      button.innerHTML = `<span>${index + 1}</span><h3>${offer.title}</h3><h4>${offer.titleZh}</h4><p>${offer.description}</p><small>${offer.descriptionZh}</small>`;
      button.addEventListener('click', () => this.onUpgrade?.(offer.id), { once: true });
      this.upgradeGrid.appendChild(button);
    });
    this.upgradeScreen.classList.add('is-visible');
  }

  showGameOver(stats) {
    this.root.querySelector('[data-final-wave]').textContent = stats.wave;
    this.root.querySelector('[data-final-score]').textContent = formatNumber(stats.score);
    this.root.querySelector('[data-final-kills]').textContent = formatNumber(stats.kills);
    this.root.querySelector('[data-final-time]').textContent = formatTime(stats.time);
    this.root.querySelector('[data-best-wave]').textContent = stats.bestWave;
    this.gameOver.classList.add('is-visible');
  }

  update(session, enemies) {
    this.wave.textContent = session.wave.wave;
    this.score.textContent = formatNumber(session.score.score);
    this.playerHP.style.width = `${Math.max(0, session.player.healthPercent) * 100}%`;
    this.playerHPText.textContent = `${Math.ceil(session.player.currentHP)} / ${session.player.maxHP}`;
    this.relicHP.style.width = `${Math.max(0, session.relic.healthPercent) * 100}%`;
    this.relicHPText.textContent = `${Math.ceil(session.relic.currentHP)} / ${session.relic.maxHP}`;
    this.alive.textContent = enemies.aliveCount;
    this.pending.textContent = enemies.pendingSpawnCount;
    if (session.player.isDowned) this.respawn.textContent = session.player.respawnRemaining.toFixed(1);
    this.root.classList.toggle('is-relic-critical', session.relic.healthPercent < 0.2 && !session.relic.isDestroyed);
  }

  /**
   * Take the run-based UI off screen for the sandbox.
   *
   * None of it has a meaning without a session: there is no wave to count, no
   * relic to lose and nothing to upgrade. The title card is the loud one — it
   * ships visible and dims the whole scene behind it, so a sandbox that skips
   * `session.update()` would otherwise sit behind a PLAY button forever. The
   * debug panel stays, since F8 is still useful here.
   */
  setSandbox(enabled) {
    for (const section of [this.menu, this.sessionHud, this.downed, this.upgradeScreen, this.gameOver]) {
      if (!section) continue;
      section.classList.remove('is-visible');
      section.style.display = enabled ? 'none' : '';
    }
  }

  setDebugVisible(visible) {
    this.debug.classList.toggle('is-visible', visible);
  }

  updateDebug(info) {
    if (!this.debug.classList.contains('is-visible')) return;
    this.debug.textContent = [
      `FPS ${info.fps}   WAVE ${info.wave}   STATE ${info.state}`,
      `ALIVE ${info.alive}   QUEUE ${info.queue}   POOL ${info.poolActive}/${info.poolFree}`,
      `TARGET P${info.targets.player} R${info.targets.relic}   ATTACK ${info.targets.attacking}   CONTACT ${info.targets.attackEvents}`,
      `SCENE ${info.sceneObjects}   CALLS ${info.calls}   TRI ${formatNumber(info.triangles)}`,
      `GEO ${info.geometries}   TEX ${info.textures}   PROGRAMS ${info.programs}`,
      `AI ${info.aiCost.toFixed(2)}ms   COMBAT ${info.combatCost.toFixed(2)}ms`
    ].join('\n');
  }

  dispose() {
    for (const off of this._offs ?? []) off?.();
    this.announcement.dispose();
    this.root.remove();
  }
}
