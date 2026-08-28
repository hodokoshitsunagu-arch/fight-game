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
        <div class="ability-card__glyph">${SELF_ABILITY_SIGILS[id] ?? ''}</div>
        <div class="ability-card__label">
          <span>${meta.label}</span>
          <span class="ability-card__label-zh" lang="zh-CN">${meta.zhLabel}</span>
        </div>
      </div>`;

    root.innerHTML = `
      <div class="hud__panel hud__title">
        RELIC: LAST STAND
        <span data-blurb>Protect the core. Survive the horde.</span>
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
        <div class="hud__help-title">\u600e\u4e48\u73a9 \xb7 HOW TO PLAY</div>

        <div class="hud__help-step">
          <b>1</b><span>\u957f\u6309\u5e95\u90e8\u9ea6\u514b\u98ce\uff0c\u8bf4\u51fa\u6cd5\u672f\u540d</span>
        </div>
        <div class="hud__help-zh">Hold the mic button and say a spell name</div>
        <div class="hud__help-say">\u201cfrost lance\u201d \xb7 \u201cstorm lance\u201d \xb7 \u201ccinder fall\u201d</div>

        <div class="hud__help-step">
          <b>2</b><span>\u52a0\u4fee\u9970\u8bcd\uff0c\u6cd5\u672f\u4f1a\u8ddf\u7740\u53d8</span>
        </div>
        <div class="hud__help-zh">Add a modifier and the spell changes with it</div>
        <div class="hud__help-say">\u201cgreater crimson frost lance\u201d</div>
        <div class="hud__help-note">
          \u4fee\u9970\u8bcd\u8bf4\u5728\u540e\u9762\u4e5f\u7b97 \u2014 \u6cd5\u672f\u98de\u51fa\u53bb\u4e86\u8fd8\u80fd\u53d8\u8272\u3001\u53d8\u5927\u3002
        </div>

        <div class="hud__help-step">
          <b>3</b><span>\u70b9\u53f3\u4fa7\u6280\u80fd\u6761\u4e5f\u53ef\u4ee5\u9009\u6cd5\u672f\uff0c\u518d\u70b9\u753b\u9762\u65bd\u653e</span>
        </div>
        <div class="hud__help-zh">Or tap a spell on the right, then tap the ground to cast</div>

        <div class="hud__help-note" style="margin-top:8px">
          \u5355\u6307\u62d6\u52a8\u65cb\u8f6c\u955c\u5934 \xb7 \u53cc\u6307\u634f\u5408\u7f29\u653e<br>
          \u70b9\u53f3\u4e0a\u89d2\u201c\u6280\u80fd\u201d\u6807\u9898\u53ef\u6536\u8d77\u5217\u8868
        </div>
        <div class="hud__help-note">
          \u9700\u8981 Chrome / Edge \u5e76\u5141\u8bb8\u9ea6\u514b\u98ce\u6743\u9650\u3002
        </div>
      </div>

      <div class="hud__abilities" data-abilities>
        <button class="hud__abilities-header" data-abilities-toggle
                type="button" aria-expanded="true">
          <span>\u6280\u80fd \xb7 SPELLS</span>
          <i class="hud__abilities-chevron" aria-hidden="true"></i>
        </button>
        <div class="hud__abilities-body" data-abilities-body>
          ${ELEMENT_GROUPS.classic.map(renderAbilityCard).join('')}
          ${ELEMENT_GROUPS.numeric.map(renderAbilityCard).join('')}
          <span class="hud__ability-divider" aria-hidden="true"></span>
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
        if (card.classList.contains('is-locked')) return;
        this.onAbility?.(card.dataset.element);
      });
    }
    /**
     * Spells the campaign has taught so far; `null` is free roam, where
     * everything is available.
     */
    this._unlocked = null;

    this.selfCards = new Map();
    for (const card of root.querySelectorAll('.ability-card[data-self-ability]')) {
      this.selfCards.set(card.dataset.selfAbility, card);
      card.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        this.onSelfAbility?.(card.dataset.selfAbility);
      });
    }

    /*
     * The campaign hands over two spells a level. A locked card stays visible
     * rather than being removed — seeing what is coming is part of what makes
     * the progression legible — but it is dimmed and does not respond, so it
     * cannot be selected and then silently refuse to cast.
     */
    this.setUnlocked = (unlocked) => {
      this._unlocked = unlocked ?? null;
      for (const [element, card] of this.cards) {
        const locked = this._unlocked ? !this._unlocked.has(element) : false;
        card.classList.toggle('is-locked', locked);
      }
    };

    this.stats = {
      fps: root.querySelector('[data-stat="fps"]'),
      enemies: root.querySelector('[data-stat="enemies"]'),
      kills: root.querySelector('[data-stat="kills"]'),
      particles: root.querySelector('[data-stat="particles"]'),
      spikes: root.querySelector('[data-stat="spikes"]'),
      calls: root.querySelector('[data-stat="calls"]')
    };
    this.help = root.querySelector('.hud__help');
    this.help.classList.add('is-hidden');
    this.statsPanel = root.querySelector('.hud__stats');
    this.statsPanel.classList.add('is-hidden');
    this.toast = root.querySelector('[data-toast]');
    this.pausedBadge = root.querySelector('[data-paused]');
    this.abilityBar = root.querySelector('.hud__abilities');

    /*
     * Collapsing the spell list.
     *
     * On a phone the list eats a real share of a small screen, and the point of
     * this build is to watch the effects — so the header folds it away. State is
     * remembered across reloads: someone who collapsed it once meant it.
     */
    this.abilitiesBody = root.querySelector('[data-abilities-body]');
    this.abilitiesToggle = root.querySelector('[data-abilities-toggle]');
    this.abilitiesToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setAbilitiesCollapsed(!this.abilityBar.classList.contains('is-collapsed'));
    });
    // The header is a button inside a pointer-events:none overlay; stop taps on
    // it from reaching the canvas and firing a cast underneath.
    for (const type of ['pointerdown', 'pointerup']) {
      this.abilitiesToggle.addEventListener(type, (event) => event.stopPropagation());
    }

    let collapsed = false;
    try {
      collapsed = localStorage.getItem('hud.abilities.collapsed') === '1';
    } catch {
      /* private mode, or storage blocked — default to open */
    }
    this.setAbilitiesCollapsed(collapsed);
  }

  setAbilitiesCollapsed(collapsed) {
    this.abilityBar.classList.toggle('is-collapsed', collapsed);
    this.abilitiesToggle.setAttribute('aria-expanded', String(!collapsed));
    try {
      localStorage.setItem('hud.abilities.collapsed', collapsed ? '1' : '0');
    } catch {
      /* nothing to remember it with */
    }
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

  setDebugVisible(visible) {
    this.statsPanel.classList.toggle('is-hidden', !visible);
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
