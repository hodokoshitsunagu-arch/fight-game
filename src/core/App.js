import { Vector3, MathUtils } from 'three';

import { Renderer } from './Renderer.js';
import { Time } from './Time.js';
import { CameraRig } from './CameraRig.js';
import { frame } from './FrameUniforms.js';
import { PerformanceQualityController } from './PerformanceQualityController.js';

import { Environment } from '../world/Environment.js';
import { Ground } from '../world/Ground.js';
import { DustMotes } from '../world/DustMotes.js';
import { ContactShadows } from '../world/ContactShadows.js';

import { AssetLoader } from '../loaders/AssetLoader.js';
import { CharacterController } from '../animation/CharacterController.js';

import { InputManager } from '../input/InputManager.js';
import { AimController } from '../input/AimController.js';

import { ParticleEngine } from '../particles/ParticleEngine.js';
import { LightPool } from '../effects/LightPool.js';
import { DecalSystem } from '../effects/GroundDecals.js';
import { FissureSystem } from '../effects/GroundFissures.js';
import { BurstSystem } from '../effects/BurstSphere.js';
import { CameraShake } from '../effects/CameraShake.js';
import { ScreenFlash } from '../effects/ScreenFlash.js';

import { AbilityManager } from '../abilities/AbilityManager.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { CombatSystem } from '../gameplay/CombatSystem.js';
import { PlayerHitFeedback } from '../gameplay/PlayerHitFeedback.js';
import { SelfAbilitySystem } from '../gameplay/SelfAbilitySystem.js';
import { GameSession } from '../gameplay/GameSession.js';
import { WaveState } from '../gameplay/WaveManager.js';
import { RelicController } from '../gameplay/RelicController.js';
import { PostProcessing } from '../postprocessing/PostProcessing.js';

import { VoiceController } from '../voice/VoiceController.js';
import { DummyField } from '../sandbox/DummyField.js';
import { VoiceHUD } from '../ui/VoiceHUD.js';
import { HUD, LoadingScreen } from '../ui/HUD.js';
import { DamageNumbers } from '../ui/DamageNumbers.js';
import { Editor } from '../ui/Editor.js';
import { GameUI } from '../ui/GameUI.js';

import { settings, ELEMENTS } from '../config/settings.js';

const HDR_URL = './hdri/spruit_sunrise.hdr';
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Application root: owns every subsystem and the frame loop.
 *
 * The wiring is deliberately one-directional — App builds the systems, hands the
 * ability manager a context object of the shared services, and then does nothing
 * but order the per-frame updates. No subsystem reaches back into App.
 *
 * The interaction is a single loop: select and arm an ability (Q / E), swing the
 * ground arrow with the mouse, click to fire. `AimController` owns the targeting
 * and emits one `cast` event; App turns that into an ability, a heading for the
 * character and a cooldown.
 */
export class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = new Time();
    this.elapsed = 0;
    this.paused = false;
    this.hitStopRemaining = 0;
    this._raf = 0;

    /**
     * Sandbox is the default: a spell playground driven by voice, with practice
     * dummies and no waves. `?game` restores Relic: Last Stand.
     *
     * Nothing about the horde game is deleted to get here — spoken casting has
     * a recogniser latency floor of several hundred milliseconds, which is fine
     * in a playground and wrong in a wave-survival loop, so the two modes want
     * different hosts rather than one compromised one.
     */
    this.sandbox =
      typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('game');

    /**
     * Seconds left before each ability can be armed again. Per element, so
     * spending one slot never locks the other out.
     */
    this.cooldowns = new Map(ELEMENTS.map((element) => [element, 0]));
    this.selfCooldowns = new Map([['repulse', 0], ['heal', 0]]);

    /* ---- core ---- */
    this.renderer = new Renderer(canvas);
    this.rig = new CameraRig(canvas);
    this.camera = this.rig.camera;

    this.environment = new Environment(this.renderer, this.camera);
    this.scene = this.environment.scene;

    /* ---- world ---- */
    this.ground = new Ground(this.environment);
    this.dust = new DustMotes();
    this.contactShadows = new ContactShadows(this.renderer, { size: 2.6, height: 2.4, blur: 2.0 });

    this.scene.add(this.ground.mesh, this.dust.points, this.contactShadows.group);
    this.dust.setPixelRatio(this.renderer.gl.getPixelRatio());

    /* ---- shared VFX services ---- */
    this.particles = new ParticleEngine(this.scene);
    this.lights = new LightPool(this.scene);
    this.decals = new DecalSystem(this.scene);
    this.fissures = new FissureSystem(this.scene);
    this.bursts = new BurstSystem(this.scene);
    this.shake = new CameraShake(this.rig);
    this.flash = new ScreenFlash();

    this.relic = new RelicController(this.scene, {
      bursts: this.bursts,
      shake: this.shake,
      flash: this.flash,
      particles: this.particles
    });

    /* ---- enemies & gameplay ---- */
    this.enemies = new EnemyManager(this.scene, this.camera, this.environment);
    this.damageNumbers = new DamageNumbers(this.camera);
    this.combat = new CombatSystem(this.enemies, this.particles, {
      damageNumbers: this.damageNumbers,
      decals: this.decals,
      requestHitStop: (duration) => {
        this.hitStopRemaining = Math.min(0.05, Math.max(this.hitStopRemaining, duration));
      }
    });

    this.abilities = new AbilityManager({
      scene: this.scene,
      camera: this.camera,
      environment: this.environment,
      particles: this.particles,
      lights: this.lights,
      decals: this.decals,
      fissures: this.fissures,
      bursts: this.bursts,
      shake: this.shake,
      flash: this.flash,
      combat: this.combat
    });

    /* ---- character ---- */
    this.character = new CharacterController(this.environment);
    this.scene.add(this.character.root);
    this.playerHitFeedback = new PlayerHitFeedback(this.character, {
      flash: this.flash,
      shake: this.shake,
      damageNumbers: this.damageNumbers
    });
    this.selfAbilities = new SelfAbilitySystem(this.character, this.enemies, {
      particles: this.particles,
      bursts: this.bursts,
      decals: this.decals,
      shake: this.shake,
      flash: this.flash,
      damageNumbers: this.damageNumbers,
      requestHitStop: (duration) => {
        this.hitStopRemaining = Math.min(0.05, Math.max(this.hitStopRemaining, duration));
      }
    });

    /* ---- input & targeting ---- */
    this.input = new InputManager(canvas);
    this.aim = new AimController(this.camera);
    this.scene.add(this.aim.object3D);

    /* ---- post ---- */
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);

    /* ---- UI ---- */
    this.loading = new LoadingScreen();
    this.hud = new HUD(document.getElementById('hud'));
    this.editor = new Editor({
      onClear: () => this.clearEffects(),
      onSpawnHorde: (count) => this.spawnHorde(count),
      onClearEnemies: () => this.clearEnemies(),
      onToast: (message) => this.hud.showToast(message)
    });
    this.editor.toggle();

    this.gameUI = new GameUI({
      onPlay: () => this.session?.start(),
      onRetry: () => this.session?.start(),
      onUpgrade: (id) => this.session?.selectUpgrade(id)
    });

    this.session = new GameSession({
      enemies: this.enemies,
      relic: this.relic,
      character: this.character,
      playerHitFeedback: this.playerHitFeedback,
      callbacks: {
        cancelControl: () => {
          this.aim.cancel();
          this.abilities.clear();
        },
        resetRuntime: () => this.resetRuntime(),
        waveCleanup: () => {
          this.clearEffects();
          this.combat.reset();
          this.damageNumbers.clear();
        }
      }
    });
    /* ---- sandbox: dummies + voice ---- */
    if (this.sandbox) {
      this.gameUI.setSandbox(true);
      this.dummies = new DummyField(this.enemies);
      this.voiceHUD = new VoiceHUD(document.body);
      this.voice = new VoiceController({
        abilities: this.abilities,
        camera: this.camera,
        enemies: this.enemies,
        character: this.character,
        canCast: (element) => this.canControl && (this.cooldowns.get(element) ?? 0) <= 0,
        // Reuse the keyboard cast's own follow-through, so a spoken cast throws
        // the body and burns the cooldown exactly like a clicked one.
        onCast: (element) => {
          this.selectAbility(element);
          this.cooldowns.set(element, this._cooldownFor(element));
          this.character.setFacing(this.voice.targets.yaw);
          this.character.playCast(settings[element].castAnim);
          this.character.castLunge();
        }
      });
      this._bindVoice();
    }

    this.combat.setUpgradeManager(this.session.upgrades);
    this.selfAbilities.setUpgradeManager(this.session.upgrades);
    this.gameUI.bind(this.session);
    this.performanceQuality = new PerformanceQualityController((quality) => {
      this.hud.showToast(`Performance profile: ${quality.toUpperCase()}\n性能画质已自动调整`);
    });

    this._bindEvents();
    this.selectAbility(ELEMENTS[0], { silent: true });

    this._focusPoint = new Vector3();
    this._moveForward = new Vector3();
    this._moveRight = new Vector3();
    this._moveDirection = new Vector3();
    this._debugSpawnPosition = new Vector3();
    this.debugVisible = false;
    this.debugAccumulator = 0;
    this.debugSceneObjects = 0;
  }

  /** The ability currently in the slot. */
  get element() {
    return this.abilities.selected;
  }

  /*
   * Session gating, routed through one place.
   *
   * The sandbox runs without a `GameSession`, and an unstarted session reports
   * `canControl === false` and `simulationScale === 0` — correct for a game
   * waiting on its Play button, and completely wrong for a spell playground.
   * Reading these three through the app instead of the session is what lets
   * sandbox mode opt out without a conditional at every call site.
   */

  /** Whether the player may cast right now. */
  get canControl() {
    return this.sandbox ? true : this.session.canControl;
  }

  /** Simulation time multiplier; the sandbox always runs. */
  get simulationScale() {
    return this.sandbox ? 1 : this.session.simulationScale;
  }

  get isRunning() {
    return this.sandbox ? true : this.session.isRunning;
  }

  /* ------------------------------------------------------------------ */

  _bindEvents() {
    this.renderer.onResize((width, height, pixelRatio) => {
      this.rig.resize(width, height);
      this.post.setSize(width, height, pixelRatio);
      this.dust.setPixelRatio(pixelRatio);
    });

    this.input.on('pointer:move', (pointer) => this.aim.point(pointer));
    this.input.on('pointer:confirm', (pointer) => {
      this.aim.point(pointer);
      this.aim.confirm();
    });
    this.input.on('action', (action, slot) => this._handleAction(action, slot));

    this.aim.on('cast', (origin, direction, distance) => this._cast(origin, direction, distance));
    this.aim.on('reject', () => this.hud.showToast('Too close — aim further out'));
    this._offWaveState = this.session.on('wave:state', ({ state }) => {
      this.input.setMode(state === WaveState.UPGRADE ? 'upgrade' : 'gameplay');
    });

    this.hud.onAbility = (element) => this.armAbility(element);
    this.hud.onSelfAbility = (id) => this.castSelfAbility(id);
  }

  _handleAction(action, abilityId) {
    if (action === 'toggleDebug') {
      this.debugVisible = Boolean(abilityId);
      this.gameUI.setDebugVisible(this.debugVisible);
      this.hud.setDebugVisible(this.debugVisible);
      this.hud.showToast(this.debugVisible ? 'Debug controls enabled · 调试模式开启' : 'Debug controls disabled');
      return;
    }
    if (action === 'debug') {
      this._handleDebugAction(abilityId);
      return;
    }
    if (action === 'upgradeChoice') {
      const offer = this.session.upgrades.currentOffers[abilityId];
      if (offer) this.session.selectUpgrade(offer.id);
      return;
    }

    switch (action) {
      case 'ability': {
        if (!this.canControl) return;
        const element = ELEMENTS.includes(abilityId) ? abilityId : this.element;
        // Pressing the *same* key again puts an armed cast away, as it does in a
        // MOBA; pressing a different one swaps the slot without disarming.
        if (this.aim.isArmed && element === this.element) this.aim.cancel();
        else this.armAbility(element);
        break;
      }
      case 'selfAbility':
        if (!this.canControl) return;
        this.castSelfAbility(abilityId);
        break;
      case 'cancel':
        this.aim.cancel();
        break;
      case 'toggleHelp':
        this.hud.toggleHelp();
        break;
      case 'toggleEditor':
        this.editor.toggle();
        break;
      case 'clear':
        this.clearEffects();
        this.hud.showToast('Effects cleared');
        break;
      case 'togglePause':
        if (!this.isRunning) return;
        this.paused = !this.paused;
        this.hud.setPaused(this.paused);
        this.hud.showToast(this.paused ? 'Paused — the editor still applies' : 'Resumed');
        break;
      case 'spawnHorde':
        if (this.isRunning) this.spawnHorde(50);
        break;
      default:
        break;
    }
  }

  _handleDebugAction(action) {
    switch (action) {
      case 'skipWave': this.session.wave.skip(); break;
      case 'killAll': this.enemies.killAll({ amount: 999999, element: 'debug', ignoreShield: true }); break;
      case 'damageRelic': this.relic.damage(200, { debug: true }); break;
      case 'healRelic': this.relic.heal(200); break;
      case 'spawnElite':
        this._debugSpawnPosition.copy(this.relic.position).addScalar(6).setY(0);
        this.enemies.spawn(this._debugSpawnPosition, { archetype: 'elite', traits: ['berserk', 'shielded'], wave: this.session.wave.wave });
        break;
      case 'openUpgrade': this.session.wave.forceUpgrade(); break;
      case 'gameOver': this.relic.damage(this.relic.maxHP, { debug: true }); break;
      default: break;
    }
  }

  /**
   * Put an ability in the slot. The aim indicator and the HUD both follow,
   * because `range` and `minRange` are the ability's, not the app's.
   */
  selectAbility(element, options = {}) {
    if (!ELEMENTS.includes(element)) return;
    this.abilities.select(element);
    this.aim.setElement(element);
    this.hud.setElement(element, options);
  }

  /**
   * Voice, the HUD and the push-to-talk key.
   *
   * Push-to-talk rather than always-on listening: an open microphone in a room
   * where people are talking fires spells at conversation, and a demo that
   * misfires is worse than one that needs a key held.
   */
  _bindVoice() {
    const key = settings.voice.pushToTalkKey;

    this._onVoiceKeyDown = (event) => {
      if (event.code !== key || event.repeat) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault(); // Space would otherwise scroll the page
      this.voice.pressToTalk();
    };
    this._onVoiceKeyUp = (event) => {
      if (event.code !== key) return;
      this.voice.releaseToTalk();
    };

    window.addEventListener('keydown', this._onVoiceKeyDown);
    window.addEventListener('keyup', this._onVoiceKeyUp);

    this.voice.on('listening', (listening) => this.voiceHUD.setListening(listening));
    this.voice.on('transcript', (text) => this.voiceHUD.setTranscript(text));
    this.voice.on('cast', (element, modifiers) => this.voiceHUD.showCast(element, modifiers));
    this.voice.on('mutate', (modifier) => this.voiceHUD.showMutation(modifier));
    this.voice.on('miss', (text) => this.voiceHUD.showMiss(text));
    this.voice.on('error', (kind) => {
      if (kind === 'unsupported') this.voiceHUD.setSupported(false);
      else this.hud.showToast(`Voice: ${kind}`);
    });

    this.voiceHUD.setSupported(this.voice.supported);
  }

  /** Select an ability and arm it, unless it is still cooling down. */
  armAbility(element = this.element) {
    if (!this.canControl) return;
    if ((this.cooldowns.get(element) ?? 0) > 0) {
      this.hud.showToast('Not ready');
      return;
    }
    // Selecting before arming means the arrow is already drawn to the new
    // ability's range on the frame it appears.
    if (element !== this.element) this.selectAbility(element);
    this.aim.arm();
  }

  _cast(origin, direction, distance) {
    if (!this.canControl) return;
    const element = this.element;
    this.abilities.cast(origin, direction, distance, element);
    this.cooldowns.set(element, this._cooldownFor(element));

    // Snap onto the shot and throw the body into it. Which clip that is belongs
    // to the ability, so each spell can be cast with its own gesture.
    this.character.setFacing(this.aim.facing);
    this.character.playCast(settings[element].castAnim);
    this.character.castLunge();
  }

  castSelfAbility(id) {
    if (!this.canControl) return;
    if (!this.selfCooldowns.has(id)) return;
    if ((this.selfCooldowns.get(id) ?? 0) > 0) {
      this.hud.showToast('Ability not ready');
      return;
    }
    this.aim.cancel();
    const result = this.selfAbilities.cast(id);
    if (!result) {
      this.hud.showToast('Recovering — try again');
      return;
    }

    const c = settings.selfAbilities;
    const baseCooldown = id === 'repulse' ? c.repulseCooldown : c.healCooldown;
    this.selfCooldowns.set(id, baseCooldown * this.session.upgrades.cooldownMultiplier);
    this.playerHitFeedback.grantImmunity(
      id === 'repulse' ? c.repulseProtection : c.healProtection
    );
    if (id === 'heal') {
      const healed = this.session.player.heal(result.amount);
      const relicHealed = this.session.healRelicFromLink();
      result.amount = healed;
      result.relicAmount = relicHealed;
    }
    this.hud.showToast(
      id === 'repulse'
        ? `Force Repulse — ${result.affected} launched\n力场震退 — 弹飞 ${result.affected} 个敌人`
        : `Verdant Heal +${Math.round(result.amount)}${result.relicAmount ? ` · Relic +${Math.round(result.relicAmount)}` : ''}\n翠绿治愈 +${Math.round(result.amount)}`
    );
  }

  _cooldownFor(element) {
    return Math.max(0, settings[element].cooldown * this.session.upgrades.cooldownMultiplier);
  }

  clearEffects() {
    this.aim.cancel();
    this.abilities.clear();
    this.particles.reset();
    this.decals.clear();
    this.fissures.clear();
    this.bursts.clear();
    this.lights.reset();
    this.shake.reset();
    this.flash.reset();
    this.playerHitFeedback.reset();
    this.selfAbilities.clear();
  }

  resetRuntime() {
    this.paused = false;
    this.hitStopRemaining = 0;
    this.hud.setPaused(false);
    this.clearEffects();
    this.combat.reset();
    this.enemies.clearEnemies({ resetKills: true });
    this.damageNumbers.clear();
    for (const element of ELEMENTS) this.cooldowns.set(element, 0);
    for (const id of this.selfCooldowns.keys()) this.selfCooldowns.set(id, 0);
  }

  spawnHorde(count) {
    this.enemies.spawnHorde(count);
    this.hud.showToast(`Spawning ${count} Monsters`);
  }

  clearEnemies() {
    this.enemies.clearEnemies({ resetKills: true });
    this.damageNumbers.clear();
    this.hud.showToast('Enemies cleared');
  }

  /** Camera-relative WASD movement, with Shift selecting the run cycle. */
  _updateMovement(dt) {
    if (!this.canControl) {
      this.character.setLocomotion('idle');
      return;
    }
    const strafe = Number(this.input.isDown('KeyD')) - Number(this.input.isDown('KeyA'));
    const forward = Number(this.input.isDown('KeyW')) - Number(this.input.isDown('KeyS'));

    if (strafe === 0 && forward === 0) {
      this.character.setLocomotion('idle');
      return;
    }

    const running = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    this.character.setLocomotion(running ? 'run' : 'walk');

    this.camera.getWorldDirection(this._moveForward);
    this._moveForward.y = 0;
    if (this._moveForward.lengthSq() < 1e-6) this._moveForward.set(0, 0, -1);
    else this._moveForward.normalize();

    this._moveRight.crossVectors(this._moveForward, WORLD_UP).normalize();
    this._moveDirection
      .copy(this._moveForward)
      .multiplyScalar(forward)
      .addScaledVector(this._moveRight, strafe)
      .normalize();

    const c = settings.character;
    this.character.position.addScaledVector(
      this._moveDirection,
      (running ? c.runSpeed : c.walkSpeed) * dt
    );
    this.character.position.x = MathUtils.clamp(
      this.character.position.x,
      -c.moveBoundary,
      c.moveBoundary
    );
    this.character.position.z = MathUtils.clamp(
      this.character.position.z,
      -c.moveBoundary,
      c.moveBoundary
    );

    // Aiming and casting own the heading. Otherwise face travel, including
    // natural diagonal movement relative to the orbit camera.
    if (!this.aim.isArmed && !this.character.isCasting && !this.character.isReacting) {
      const yaw = Math.atan2(this._moveDirection.x, this._moveDirection.z);
      this.character.turnToward(yaw, c.moveTurnRate, dt);
    }
  }

  /* ------------------------------------------------------------------ */

  /** Load assets, warm the shader cache, then start the loop. */
  async load() {
    const assets = new AssetLoader();

    this.loading.setProgress(0.05, 'Loading environment…');
    const hdr = await assets.loadHDR(HDR_URL);
    await this.environment.loadEnvironment(hdr);
    frame.uEnvMap.value = this.environment.equirect;

    this.loading.setProgress(0.35, 'Loading floor…');
    await this.ground.loadTextures(assets);

    this.loading.setProgress(0.5, 'Loading character…');
    await this.character.load(assets);

    this.loading.setProgress(0.66, 'Raising the horde…');
    await this.enemies.load(assets, (message) => this.loading.setProgress(0.72, message));

    this.loading.setProgress(0.9, 'Compiling shaders…');
    // Compile everything up front so the first cast never stutters.
    this.enemies.setCompileVisible(true);
    try {
      await this.renderer.gl.compileAsync(this.scene, this.camera);
    } finally {
      this.enemies.setCompileVisible(false);
    }

    this.loading.setProgress(1, 'Ready');
    this.loading.hide();

    this.start();
  }

  start() {
    this.time.reset();
    if (this.sandbox) this.dummies.start();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
  }

  /* ------------------------------------------------------------------ */

  frame() {
    const gl = this.renderer.gl;
    gl.info.reset();

    const raw = this.time.tick();
    if (!this.sandbox) this.session.update(raw);
    this.performanceQuality.update(raw, this.isRunning && !this.paused);
    const hitStopped = this.hitStopRemaining > 0;
    this.hitStopRemaining = Math.max(0, this.hitStopRemaining - raw);
    const dt = this.paused || hitStopped ? 0 : raw * settings.global.timeScale * this.simulationScale;
    this.elapsed += dt;

    /* ---- shared uniforms ---- */
    frame.uTime.value = this.elapsed;
    frame.uDelta.value = dt;
    frame.uShaderIntensity.value = settings.global.shaderIntensity;
    frame.uGlobalGlow.value = settings.global.glow;
    frame.uCameraNear.value = this.camera.near;
    frame.uCameraFar.value = this.camera.far;

    /* ---- simulation ---- */
    this.renderer.syncSettings();

    this._updateMovement(dt);

    this.environment.setFocus(this.character.position.x, this.character.position.z);
    this.environment.update();

    // Targeting runs on *real* time so the arrow keeps sweeping and animating
    // while the sandbox is paused — pausing freezes the effects, not the UI.
    this.aim.setOrigin(this.character.position);
    this.aim.update(raw);

    if (settings.character.turnToAim && this.aim.isArmed) {
      this.character.turnToward(this.aim.facing, settings.character.turnRate, raw);
    }
    this.character.update(dt);

    for (const [element, remaining] of this.cooldowns) {
      if (remaining > 0) this.cooldowns.set(element, Math.max(0, remaining - raw));
    }
    for (const [id, remaining] of this.selfCooldowns) {
      if (remaining > 0) this.selfCooldowns.set(id, Math.max(0, remaining - raw));
    }

    this.ground.update(this.elapsed);
    this.dust.update(this.elapsed, this.character.position);

    if (this.sandbox) {
      this.dummies.update(raw);
      // Real time, deliberately: the window for a trailing modifier is a
      // property of how fast someone talks, not of the simulation clock.
      this.voice.update(raw);
      this.voiceHUD.update(raw);
    }

    this.enemies.update(dt, raw);
    this.combat.update(dt);
    this.abilities.update(dt);
    this.selfAbilities.update(dt);
    this.particles.flush();
    this.decals.update(dt);
    this.fissures.update(dt);
    this.bursts.update(dt);
    this.lights.update(dt);
    this.relic.update(raw * Math.max(0.18, this.simulationScale));

    /* ---- camera ---- */
    const focus = this.abilities.focus;
    if (focus) this.rig.lookAt(focus.position, MathUtils.clamp(1 - focus.u * 0.4, 0, 1));
    this.rig.setAnchor(this.character.position.x, 0, this.character.position.z);
    this.shake.update(raw);
    this.flash.update(raw);
    this.playerHitFeedback.update(raw);
    this.rig.update(raw);

    this.contactShadows.setPosition(this.character.position.x, this.character.position.z);
    this.contactShadows.render(this.scene);

    /* ---- render ---- */
    // Exactly one cascade shadow update per frame (see Renderer).
    gl.shadowMap.needsUpdate = true;
    this.post.sync(this.elapsed, this.flash);
    this.post.render();

    /* ---- readouts ---- */
    for (const element of ELEMENTS) {
      this.hud.setCooldown(element, this.cooldowns.get(element) ?? 0, this._cooldownFor(element));
    }
    this.hud.setSelfCooldown(
      'repulse',
      this.selfCooldowns.get('repulse') ?? 0,
      settings.selfAbilities.repulseCooldown * this.session.upgrades.cooldownMultiplier
    );
    this.hud.setSelfCooldown(
      'heal',
      this.selfCooldowns.get('heal') ?? 0,
      settings.selfAbilities.healCooldown * this.session.upgrades.cooldownMultiplier
    );
    this.hud.setArmed(this.aim.isArmed);
    this.hud.update(raw, () => ({
      particles: this.particles.countLive(this.elapsed),
      calls: gl.info.render.calls,
      spikes: this.abilities.active.reduce((total, ability) => total + ability.instanceCount, 0),
      abilities: this.abilities.active.length,
      enemies: this.enemies.aliveCount,
      kills: this.enemies.kills
    }));
    this.damageNumbers.update(raw);
    if (!this.sandbox) this.gameUI.update(this.session, this.enemies);
    this._updateDebug(raw, gl);
  }

  _updateDebug(raw, gl) {
    if (!this.debugVisible) return;
    this.debugAccumulator += raw;
    if (this.debugAccumulator < 0.5) return;
    this.debugAccumulator = 0;
    let sceneObjects = 0;
    this.scene.traverse(() => sceneObjects++);
    this.debugSceneObjects = sceneObjects;
    this.gameUI.updateDebug({
      fps: this.hud._fps ?? 0,
      wave: this.session.wave.wave,
      state: this.session.state,
      alive: this.enemies.aliveCount,
      queue: this.enemies.pendingSpawnCount,
      poolActive: this.enemies.active.length,
      poolFree: this.enemies.pool?.free.length ?? 0,
      targets: this.enemies.debugTargetStats(),
      sceneObjects,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
      aiCost: this.enemies.aiCost ?? 0,
      combatCost: this.combat.queryCost ?? 0
    });
  }

  /* ------------------------------------------------------------------ */

  dispose() {
    this.stop();
    if (this.sandbox) {
      window.removeEventListener('keydown', this._onVoiceKeyDown);
      window.removeEventListener('keyup', this._onVoiceKeyUp);
      this.voice.dispose();
      this.voiceHUD.dispose();
      this.dummies.dispose();
    }
    this.input.dispose();
    this.aim.dispose();
    this.abilities.dispose();
    this.combat.dispose();
    this.selfAbilities.dispose();
    this._offWaveState?.();
    this.session.dispose();
    this.gameUI.dispose();
    this.playerHitFeedback.dispose();
    this.enemies.dispose();
    this.relic.dispose();
    this.damageNumbers.dispose();
    this.particles.dispose();
    this.decals.dispose();
    this.fissures.dispose();
    this.bursts.dispose();
    this.lights.dispose();
    this.character.dispose();
    this.ground.dispose();
    this.dust.dispose();
    this.contactShadows.dispose();
    this.post.dispose();
    this.environment.dispose();
    this.editor.dispose();
    this.rig.dispose();
    this.renderer.dispose();
  }
}
