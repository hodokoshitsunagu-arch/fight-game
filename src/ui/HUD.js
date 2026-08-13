import { ELEMENTS, ELEMENT_GROUPS, ELEMENT_META, SELF_ABILITY_META } from '../config/settings.js';
import { ELEMENT_SIGILS, SELF_ABILITY_SIGILS } from './glyphs.js';

/**
 * Heads-up display: the ability bar, controls, live stats and toasts.
 *
 * Plain DOM — no framework. The bar is built from `ELEMENTS`, so a new ability
 * appears in it on its own; the slots are the only interactive part, and they
 * mirror the keyboard shortcuts through `onAbility`.
 *
 * The cooldown sweep is a `conic-gradient` driven by a CSS custom property, so
 * updating it every frame is one `setProperty` call and never touches layout.
 */
export class HUD {
  constructor(root) {
    this.root = root;
    this.onAbility = null;
    this.onSelfAbility = null;
    this._toastTimer = 0;
    this._statsAccumulator = 0;
    this._frames = 0;
    this._fps = 0;
    /** Last sweep ratio pushed to the DOM, per element. */
    this._cooldownShown = new Map();
    this._armedShown = null;

    const renderAbilityCard = (element) => {
      const meta = ELEMENT_META[element];
      return `
        <div class="ability-card" data-element="${element}" style="--accent:${meta.accent}"
             title="${meta.label}&#10;${meta.zhLabel}&#10;${meta.description}&#10;${meta.zhDescription}">
          <div class="ability-card__sweep" data-sweep></div>
          <div class="ability-card__cooldown" data-cooldown aria-hidden="true">
            <strong data-cooldown-value>0.0</strong>
            <small>CD</small>
          </div>
          <div class="ability-card__key">${meta.key}</div>
          <div class="ability-card__glyph">${ELEMENT_SIGILS[element] ?? ''}</div>
          <div class="ability-card__label">
            <span>${meta.label}</span>
            <span class="ability-card__label-zh" lang="zh-CN">${meta.zhLabel}</span>
          </div>
        </div>`;
    };
    const renderSelfAbilityCard = ([id, meta]) => `
      <div class="ability-card ability-card--self" data-self-ability="${id}" style="--accent:${meta.accent}"
           title="${meta.label}&#10;${meta.zhLabel}&#10;${meta.description}&#10;${meta.zhDescription}">
        <div class="ability-card__sweep" data-sweep></div>
        <div class="ability-card__cooldown" data-cooldown aria-hidden="true">
          <strong data-cooldown-value>0.0</strong>
          <small>CD</small>
        </div>
        <div class="ability-card__key">${meta.key}</div>
        <div class="ability-card__glyph">${SELF_ABILITY_SIGILS[id] ?? ''}</div>
        <div class="ability-card__label">
          <span>${meta.label}</span>
          <span class="ability-card__label-zh" lang="zh-CN">${meta.zhLabel}</span>
        </div>
      </div>`;

    root.innerHTML = `
      <div class="hud__panel hud__title">
        Horde Combat Demo
        <span data-blurb>Move, gather the horde, then erase it with an ability.</span>
      </div>

      <div class="hud__panel hud__stats">
        <div>FPS <b data-stat="fps">—</b></div>
        <div>Enemies <b data-stat="enemies">0</b></div>
        <div>Kills <b data-stat="kills">0</b></div>
        <div>Particles <b data-stat="particles">0</b></div>
        <div>Instances <b data-stat="spikes">0</b></div>
        <div>Draw calls <b data-stat="calls">0</b></div>
      </div>

      <div class="hud__panel hud__help">
        <div><strong>Q</strong> — Frost Lance · Freezing cone &nbsp; <strong>E</strong> — Storm Lance · Lightning stagger</div>
        <div class="hud__help-zh"><strong>Q</strong> — 冰霜长枪 · 锥形冻结 &nbsp; <strong>E</strong> — 雷霆长枪 · 雷击硬直</div>
        <div><strong>R</strong> — Cinder Fall · Meteor impact &nbsp; <strong>F</strong> — Nova Beam · Sustained beam</div>
        <div class="hud__help-zh"><strong>R</strong> — 烬火天降 · 陨石冲击 &nbsp; <strong>F</strong> — 新星光束 · 持续光束</div>
        <div><strong>V</strong> — Voltaic Snare · Slow field &nbsp; <strong>X</strong> — Glacial Crown · Freeze burst</div>
        <div class="hud__help-zh"><strong>V</strong> — 伏特陷阱 · 减速力场 &nbsp; <strong>X</strong> — 冰川王冠 · 冻结爆发</div>
        <div><strong>1</strong> — Rift Sever · Linear cleave &nbsp; <strong>2</strong> — Solar Phoenix · Explosion</div>
        <div class="hud__help-zh"><strong>1</strong> — 裂隙斩 · 直线斩击 &nbsp; <strong>2</strong> — 太阳凤凰 · 爆炸冲击</div>
        <div><strong>3</strong> — Gravity Singularity · Pull &nbsp; <strong>4</strong> — Worldroot Bloom · Root</div>
        <div class="hud__help-zh"><strong>3</strong> — 引力奇点 · 引力牵引 &nbsp; <strong>4</strong> — 世界树绽放 · 自然定身</div>
        <div><strong>5</strong> — Force Repulse · Launch &nbsp; <strong>6</strong> — Verdant Heal · Recover</div>
        <div class="hud__help-zh"><strong>5</strong> — 力场震退 · 范围弹飞 &nbsp; <strong>6</strong> — 翠绿治愈 · 模拟恢复</div>
        <div class="hud__help-note">3, 4, V and X use a targeting circle.</div>
        <div class="hud__help-zh">3、4、V、X 使用范围瞄准圈。</div>
        <div><strong>W A S D</strong> — Move &nbsp; <strong>Shift</strong> — Run</div>
        <div class="hud__help-zh"><strong>W A S D</strong> — 移动 &nbsp; <strong>Shift</strong> — 奔跑</div>
        <div><strong>Mouse</strong> — Aim &nbsp; <strong>Left click</strong> — Cast</div>
        <div class="hud__help-zh"><strong>鼠标</strong> — 瞄准 &nbsp; <strong>左键</strong> — 施放</div>
        <div><strong>Esc / right click</strong> — Cancel &nbsp; <strong>Right drag / Scroll</strong> — Camera</div>
        <div class="hud__help-zh"><strong>Esc / 右键</strong> — 取消 &nbsp; <strong>右键拖动 / 滚轮</strong> — 镜头</div>
        <div style="margin-top:6px">
          <kbd>G</kbd> editor &nbsp; <kbd>P</kbd> pause &nbsp; <kbd>C</kbd> clear effects
        </div>
        <div><kbd>B</kbd> spawn 50 Monsters &nbsp; <kbd>H</kbd> hide this</div>
        <div class="hud__help-note">Paused still applies every editor change.</div>
      </div>

      <div class="hud__abilities">
        <div class="hud__ability-row">
          ${ELEMENT_GROUPS.classic.map(renderAbilityCard).join('')}
        </div>
        <div class="hud__ability-row hud__ability-row--numeric">
          ${ELEMENT_GROUPS.numeric.map(renderAbilityCard).join('')}
          <span class="hud__ability-gap" aria-hidden="true"></span>
          ${Object.entries(SELF_ABILITY_META).map(renderSelfAbilityCard).join('')}
        </div>
      </div>

      <div class="hud__toast" data-toast></div>
      <div class="hud__paused" data-paused>Paused</div>
    `;

    this.cards = new Map();
    for (const card of root.querySelectorAll('.ability-card[data-element]')) {
      this.cards.set(card.dataset.element, card);
      card.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        this.onAbility?.(card.dataset.element);
      });
    }
    this.selfCards = new Map();
    for (const card of root.querySelectorAll('.ability-card[data-self-ability]')) {
      this.selfCards.set(card.dataset.selfAbility, card);
      card.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        this.onSelfAbility?.(card.dataset.selfAbility);
      });
    }

    this.stats = {
      fps: root.querySelector('[data-stat="fps"]'),
      enemies: root.querySelector('[data-stat="enemies"]'),
      kills: root.querySelector('[data-stat="kills"]'),
      particles: root.querySelector('[data-stat="particles"]'),
      spikes: root.querySelector('[data-stat="spikes"]'),
      calls: root.querySelector('[data-stat="calls"]')
    };
    this.help = root.querySelector('.hud__help');
    this.toast = root.querySelector('[data-toast]');
    this.pausedBadge = root.querySelector('[data-paused]');
    this.abilityBar = root.querySelector('.hud__abilities');
  }

  /** @param {{silent?: boolean}} [options] */
  setElement(element, options = {}) {
    for (const [key, card] of this.cards) {
      card.classList.toggle('is-active', key === element);
    }
    const meta = ELEMENT_META[element];
    if (meta && !options.silent) {
      this.showToast(`${meta.hint} selected\n已选择：${meta.zhLabel}`);
    }
  }

  /** Highlight the slot while a cast is armed. */
  setArmed(armed) {
    if (armed === this._armedShown) return;
    this._armedShown = armed;
    this.abilityBar.classList.toggle('is-armed', armed);
  }

  /**
   * Drive one slot's cooldown sweep. Cooldowns are per ability, so this is
   * called once per element each frame.
   *
   * @param {string} element
   * @param {number} remaining seconds left
   * @param {number} total     the full cooldown, for the sweep angle
   */
  setCooldown(element, remaining, total) {
    const card = this.cards.get(element);
    if (!card) return;
    this._setCardCooldown(card, element, remaining, total);
  }

  setSelfCooldown(id, remaining, total) {
    const card = this.selfCards.get(id);
    if (!card) return;
    this._setCardCooldown(card, `self:${id}`, remaining, total);
  }

  _setCardCooldown(card, key, remaining, total) {
    const safeRemaining = Math.max(0, remaining);
    const ratio = Math.max(0, Math.min(1, safeRemaining / Math.max(total, 0.001)));
    const cooling = safeRemaining > 0.001;
    const display = safeRemaining >= 10
      ? String(Math.ceil(safeRemaining))
      : safeRemaining.toFixed(1);
    const previous = this._cooldownShown.get(key);

    if (!previous || Math.abs(ratio - previous.ratio) >= 0.005 || cooling !== previous.cooling) {
      card.style.setProperty('--cooldown', ratio);
      card.classList.toggle('is-cooling', cooling);
    }
    if (!previous || display !== previous.display) {
      const value = card.querySelector('[data-cooldown-value]');
      if (value) value.textContent = display;
    }

    // A short, one-off confirmation at zero makes readiness readable without
    // adding a permanent animation to twelve cards.
    if (previous?.cooling && !cooling) {
      card.classList.remove('is-ready');
      void card.offsetWidth;
      card.classList.add('is-ready');
    }
    this._cooldownShown.set(key, { ratio, cooling, display });
  }

  setPaused(paused) {
    this.pausedBadge.classList.toggle('is-visible', paused);
  }

  toggleHelp() {
    this.help.classList.toggle('is-hidden');
  }

  showToast(message, duration = 1600) {
    this.toast.textContent = message;
    this.toast.classList.add('is-visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toast.classList.remove('is-visible'), duration);
  }

  /**
   * @param {number} dt
   * @param {() => {particles:number, spikes:number, calls:number}} collect
   *   Called only when the readout actually refreshes, so gathering the numbers
   *   (which means walking the particle pools) stays off the hot path.
   */
  update(dt, collect) {
    this._frames++;
    this._statsAccumulator += dt;
    if (this._statsAccumulator < 0.4) return;

    this._fps = Math.round(this._frames / this._statsAccumulator);
    this._frames = 0;
    this._statsAccumulator = 0;

    const info = collect();
    this.stats.fps.textContent = this._fps;
    this.stats.enemies.textContent = info.enemies ?? 0;
    this.stats.kills.textContent = info.kills ?? 0;
    this.stats.particles.textContent = info.particles;
    this.stats.spikes.textContent = info.spikes;
    this.stats.calls.textContent = info.calls;
  }
}

/** Boot screen helper. */
export class LoadingScreen {
  constructor() {
    this.element = document.getElementById('loader');
    this.fill = document.getElementById('loader-fill');
    this.status = document.getElementById('loader-status');
  }

  setProgress(ratio, message) {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
    if (message) this.status.textContent = message;
  }

  hide() {
    this.setProgress(1);
    setTimeout(() => this.element.classList.add('is-hidden'), 220);
  }

  fail(message) {
    this.status.textContent = message;
    this.status.style.color = '#ff7a6a';
  }
}
