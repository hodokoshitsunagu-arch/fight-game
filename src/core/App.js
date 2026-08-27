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
import { StreetViewBackdrop } from '../world/StreetViewBackdrop.js';
import { SceneSelector } from '../ui/SceneSelector.js';
import { MiniMap } from '../ui/MiniMap.js';
import { DirectionPad } from '../ui/DirectionPad.js';
import { StatusBar } from '../ui/StatusBar.js';
import { FirstPersonView } from './FirstPersonView.js';
import { FirstPersonHands } from '../world/FirstPersonHands.js';
import { Mana } from '../gameplay/Mana.js';
import { SCENES, DEFAULT_SCENE, findScene } from '../config/scenes.js';
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
      this.mana = new Mana();
      this.statusBar = new StatusBar(document.body);

      /*
       * First person. The body comes off and the camera goes where its head
       * was — you cannot see your own model from inside it, and leaving it
       * rendered means looking at the inside of a torso.
       */
      if (settings.camera.firstPerson) {
        this.firstPerson = new FirstPersonView(this.camera, canvas);
        this.firstPerson.enabled = true;
        this.hands = new FirstPersonHands(this.camera);
        this.hands.setVisible(true);
        /*
         * The camera has to join the scene graph.
         *
         * three renders what is under the scene, and a camera is not under it by
         * default — so anything parented to the camera is never traversed and
         * never drawn. The hands were built, visible, and on a layer the camera
         * could see, and still nothing appeared.
         */
        this.scene.add(this.camera);
        this.character.root.visible = false;
        /*
         * And the relic goes. In third person it was the centrepiece the fight
         * happened around; in first person the camera stands exactly where it
         * is, so it renders as a cyan band across the middle of the view — you
         * are inside it.
         */
        this.relic.root.visible = false;
        // OrbitControls and a first-person look would fight over the same
        // pointer and the same camera every frame.
        this.rig.controls.enabled = false;
        // A press that never became a drag is an aim, not a look.
        this.firstPerson.onTap = () => this.aim.confirm();
        // Dummies arrive from wherever the view is pointing.
        this.dummies.getFacing = () => this.firstPerson.yaw + Math.PI;
      }
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
          this.mana?.spend();
          this.hands?.punch();
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
   * Put Street View behind the scene, or say clearly why it is not there.
   *
   * Failing to a black screen would be the worst outcome: a missing key, a
   * referer-restricted key and a location with no coverage all look identical
   * from the outside, and each needs a different fix. So a failure names itself
   * and the flat stage stays up.
   */
  async _startStreetView(key) {
    const env = settings.environment;
    this.streetView = new StreetViewBackdrop({
      key,
      position: { lat: env.streetViewLat, lng: env.streetViewLng }
    });

    const ok = await this.streetView.load();
    if (!ok) {
      // Keep the reason reachable. Disposing the object was destroying the only
      // evidence of why it failed, which made every failure look the same from
      // the console.
      this.streetViewError = this.streetView.error;
      this.streetView.dispose();
      this.streetView = null;
      console.warn('[streetview] not shown:', this.streetViewError);
      this._showStreetViewNotice(key ? 'failed' : 'no-key');
      return;
    }

    env.backgroundMode = 'streetview';
    env.parallax = false;
    // Clear to nothing so the viewer behind the canvas is what gets seen.
    this.renderer.gl.setClearAlpha(0);
    // The void's fog would paint a grey wall over a street that is genuinely
    // right there.
    env.fogEnabled = false;
    /*
     * Shadows only. The backdrop is genuinely behind the scene, so an opaque
     * floor is the one thing that can block it — and it blocked the whole
     * bottom of the frame. Kept large now that it is invisible, because its
     * only remaining job is to be big enough to catch what falls on it.
     */
    /*
     * The eyes go where the panorama's camera was.
     *
     * Street View projects its sphere from roughly 2.5m above the road, and the
     * game draws its ground at y = 0. The two grounds coincide only when the
     * camera stands the same height above y = 0 — at a person's 1.68m the plane
     * sits 0.8m above the photographed street, and everything standing on it
     * floats by exactly that much. Matching the capture height is what puts
     * their feet on the pavement.
     */
    settings.camera.eyeHeight = env.streetViewEyeHeight;

    env.floorShadowOnly = true;
    env.floorScale = 0.6;
    env.ambientIntensity = 0.45;
    settings.camera.distance = 10;

    /*
     * The relic's base is a 4.3-metre near-black disc, and it was the dark
     * shape still sitting around the player once the floor went transparent.
     * The core stays — it is the thing the spells are cast around — but a
     * plinth has no business standing in a real street.
     */
    if (env.streetViewHideRelicBase) this.relic.base.visible = false;

    this._alignCameraToStreet();
    this._buildSceneSelector();
    this._buildMiniMap();
  }

  /**
   * The companion map.
   *
   * Street View alone shows none of position, facing or exits — it is a sphere,
   * with no horizon to orient against and no sign that walking is possible until
   * you try it. Costs one Dynamic Maps load on top of the Street View request,
   * which is why it is created once for the session rather than per scene.
   */
  _buildMiniMap() {
    if (!window.google?.maps) return;
    this.miniMap = new MiniMap(document.body);
    const survey = this.streetView.survey();
    this.miniMap.attach(window.google.maps, survey?.position ?? {
      lat: settings.environment.streetViewLat,
      lng: settings.environment.streetViewLng
    });
    if (survey) this.miniMap.setPosition(survey.position, survey.links);
    this._miniMapPano = survey?.pano ?? null;

    // Tapping an exit on the map is the precise move; the pad below is the
    // coarse one. Both end up in the same `step`.
    this.miniMap.onStepHeading = (heading) => this.streetView.step(heading);

    this.directionPad = new DirectionPad(document.body);
    this.directionPad.onStep = (relative) => this.streetView.stepRelative(relative);
  }

  /**
   * Keep the map in step with the panorama.
   *
   * The heading is written every frame because turning is continuous; the
   * position only when the panorama id actually changes, since recentring a map
   * and rebuilding a set of polylines is not something to do sixty times a
   * second for a value that has not moved.
   */
  _updateMiniMap() {
    if (!this.miniMap?.ready) return;
    this.miniMap.setHeading(this.streetView.heading ?? 0);
    // Availability turns with the camera, not just with the panorama: the same
    // junction offers different forward/left/right depending on which way you
    // are looking.
    this.directionPad?.setAvailable(this.streetView.availableDirections());

    const survey = this.streetView.survey();
    if (!survey || survey.pano === this._miniMapPano) return;
    this._miniMapPano = survey.pano;
    this.miniMap.setPosition(survey.position, survey.links);
  }

  /**
   * The scene list, and what happens when one is chosen.
   *
   * Switching is not a camera move: the world changes, so everything that
   * belonged to the old one has to go. A spell mid-flight over Times Square has
   * no business arriving in Athens, and the dummies were standing on a street
   * that no longer exists. The banked walk goes too — it was distance down a
   * different road.
   */
  _buildSceneSelector() {
    this.sceneSelector = new SceneSelector(document.body);
    this.sceneSelector.setCurrent(this.scene_ ?? DEFAULT_SCENE);

    this.sceneSelector.onSelect = async (scene) => {
      const moved = await this.streetView.moveTo(scene.lat, scene.lng, 120);
      if (!moved) return false;

      this.scene_ = scene;
      settings.environment.streetViewLat = scene.lat;
      settings.environment.streetViewLng = scene.lng;

      this.clearEffects();
      this.combat.reset();
      this.damageNumbers.clear();
      this.character.position.set(0, this.character.position.y, 0);
      this.character.root.position.set(0, this.character.root.position.y, 0);
      this.rig.setAnchor(0, 0, 0);
      this.dummies?.start();
      this._alignCameraToStreet();
      return true;
    };
  }

  /**
   * Walking moves the street, not the player.
   *
   * The scene is pinned to the panorama's capture point, so a player who
   * actually walked away from it would drag the whole fight out of frame while
   * the backdrop stayed put. Instead the walk is spent on stepping to the next
   * panorama and the character is returned to the middle — a treadmill, with
   * the world doing the moving.
   *
   * Distance is banked rather than applied per frame because Street View is a
   * graph of capture points, not a continuous space: there is nowhere to be
   * between two of them, so the walk accumulates until it is worth a hop.
   */
  _walkTheStreet() {
    const character = this.character;
    const walked = Math.hypot(character.position.x, character.position.z);
    if (walked < 0.001) return;

    if (walked < settings.environment.streetViewStepMetres) return;

    // Heading in Street View's terms: clockwise from north.
    const heading = (Math.atan2(character.position.x, -character.position.z) * 180) / Math.PI;
    /*
     * Only recentre if the street actually moved. Resetting on a refused step
     * swallowed the walk silently: the distance banked, hit the threshold, was
     * thrown away, and the player stood in the same place having walked seven
     * metres. A refusal has to leave the banked distance alone so the next
     * heading gets a turn.
     */
    if (!this.streetView.step(heading)) return;

    character.position.set(0, character.position.y, 0);
    character.root.position.x = 0;
    character.root.position.z = 0;
    this.rig.setAnchor(0, 0, 0);
  }

  /**
   * Put the game's ground plane on the street.
   *
   * Two projections have to agree. Street View draws a sphere from a camera
   * about 2.5 metres above the road; the game draws a plane at y = 0. They line
   * up only when the game camera sits at that same height above its own plane
   * and looks along the same horizon — so height is pinned rather than derived
   * from the orbit, and pitch is held at a fixed shallow angle instead of
   * following the mouse.
   *
   * Roll is zero and stays zero: `OrbitControls` keeps +Y up, and a horizon that
   * tilts against a photographed street reads as broken instantly.
   *
   * Heading is deliberately left free — turning on the spot is the one camera
   * move that costs nothing here, because Street View turns with it.
   */
  _alignCameraToStreet() {
    const env = settings.environment;
    const rig = this.rig;
    const eye = env.streetViewEyeHeight;
    const camera = this.camera;

    // Whichever way it is already facing, and how far out it already is.
    const dx = camera.position.x - rig.anchor.x;
    const dz = camera.position.z - rig.anchor.z;
    const radius = Math.max(1, Math.hypot(dx, dz));
    const heading = Math.atan2(dx, dz);

    camera.position.set(
      rig.anchor.x + radius * Math.sin(heading),
      eye,
      rig.anchor.z + radius * Math.cos(heading)
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(
      rig.anchor.x,
      eye - radius * Math.tan((env.streetViewPitch * Math.PI) / 180),
      rig.anchor.z
    );
    /*
     * `controls.update()` is deliberately not called.
     *
     * OrbitControls does not store its angles — it re-derives them from the
     * camera's position, applies its own damped spherical state, and writes the
     * position back. Calling it here undid the assignment in the same frame:
     * measured at 3.9m and -14 degrees against the 2.5m and -6 asked for.
     * Writing after the rig has run, and leaving the controls alone, is what
     * makes the values stick.
     */
    camera.updateMatrixWorld(true);
  }

  /** An on-screen explanation, because a black backdrop explains nothing. */
  _showStreetViewNotice(reason) {
    const notice = document.createElement('div');
    notice.setAttribute(
      'style',
      `position:fixed; left:50%; top:18px; transform:translateX(-50%); z-index:60;
       max-width:min(560px, 92vw); padding:12px 16px; border-radius:10px;
       border:1px solid rgba(255,255,255,.16); background:rgba(12,16,24,.92);
       backdrop-filter:blur(10px); color:#dfe8f5; font:13px/1.6 system-ui,sans-serif;
       text-align:center;`
    );
    notice.innerHTML = reason === 'no-key'
      ? `<b>Street View needs a Google Maps API key.</b><br>
         Add <code>&amp;gmapskey=YOUR_KEY</code> to the address, with the
         Maps JavaScript API enabled for it.`
      : `<b>Street View could not load.</b><br>
         Usually the key is restricted to another referer, the Maps JavaScript
         API is not enabled on it, or billing is off.`;
    document.body.appendChild(notice);
    setTimeout(() => { notice.style.transition = 'opacity .6s'; notice.style.opacity = '0'; }, 15000);
  }

  /**
   * Re-stage the scene for a grounded panorama backdrop.
   *
   * The stage was tuned against a flat void: a 400-metre floor, fog reaching
   * 135, and a camera looking down at it, because there was nothing else to
   * look at. None of that survives contact with a backdrop that has a street
   * and a skyline in it — the floor buries the city, the fog paints it out, and
   * the camera points away from it.
   *
   * These are the values a panorama wants, applied only when one actually
   * loads, so the flat stage keeps the framing it was authored with. Every one
   * of them is still a control in the editor; this is a starting point, not a
   * lock.
   */
  _stageForPanorama() {
    Object.assign(settings.environment, {
      // Trim the floor to a plaza. Anything further was invisible under fog and
      // is now actively in the way of the city.
      floorScale: 0.1,
      // Fog has to finish *before* the floor's edge, or the edge shows as a
      // hard arc and the player appears to stand on a disc.
      fogNear: 6,
      fogFar: 18,
      // Read the fog colour off the road rather than the horizon, so the floor
      // fades into the street instead of into an overcast sky.
      fogHorizonOffset: 0.1,
      // Close enough to parallax convincingly, far enough to clear the floor.
      parallaxWorldScale: 4.5,
      backgroundIntensity: 1.1,
      // The void lit characters from behind; a lit city needs them to read as
      // more than silhouettes.
      ambientIntensity: 0.4
    });

    /*
     * Take the floor's colour from the panorama's own road.
     *
     * Fog hides where the floor stops, but only if the floor is already about
     * the right colour underneath — fading a slate-blue plaza into a wet-asphalt
     * street just produces a slate-blue smear. Matching the material first is
     * what turns the join from "a dark disc in front of a photo" into one
     * surface. The tint is lifted slightly so the floor keeps its own variation
     * rather than going flat.
     */
    const road = this.environment.roadColour();
    if (road) {
      // Lifted off the raw sample: the road in the panorama is already lit, and
      // the floor still has to survive this scene's own lighting on top.
      settings.environment.floorColor = App._lighten(road, 1.3);
      settings.environment.floorTint = App._lighten(road, 1.9);
    }

    settings.camera.distance = 14;
    // Tilted down enough to hold the crossing itself in frame, not just the
    // skyline above it.
    this.rig.setOrbit(1.12, 0.6);
  }

  /** `#rrggbb` scaled in sRGB, clamped. */
  static _lighten(hex, gain) {
    const n = parseInt(hex.slice(1), 16);
    const scale = (shift) =>
      Math.min(255, Math.round(((n >> shift) & 255) * gain))
        .toString(16)
        .padStart(2, '0');
    return `#${scale(16)}${scale(8)}${scale(0)}`;
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

    // The phone's push-to-talk: hold the mic button instead of a key.
    this.voiceHUD.onTalkStart = () => this.voice.pressToTalk();
    this.voiceHUD.onTalkEnd = () => this.voice.releaseToTalk();
    this.voiceHUD.onHelp = () => this.hud.toggleHelp();

    this.voiceHUD.setSupported(this.voice.supported);

    // Show the guide once, for a first-time visitor who has no idea a
    // microphone is the control scheme. After that it is behind the ? button.
    let seen = false;
    try {
      seen = localStorage.getItem('voice.onboarded') === '1';
      localStorage.setItem('voice.onboarded', '1');
    } catch {
      seen = false;
    }
    if (!seen) this.hud.toggleHelp();
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
      this._moveSpeed = 0;
      return;
    }
    const strafe = Number(this.input.isDown('KeyD')) - Number(this.input.isDown('KeyA'));
    const forward = Number(this.input.isDown('KeyW')) - Number(this.input.isDown('KeyS'));

    if (strafe === 0 && forward === 0) {
      this.character.setLocomotion('idle');
      this._moveSpeed = 0;
      return;
    }

    const running = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    // Drives the hands' stride swing. Taken here rather than asked of the
    // character, which reports an animation state rather than a speed.
    this._moveSpeed = running ? 1 : 0.55;
    this.character.setLocomotion(running ? 'run' : 'walk');

    // In first person the eyes are the body: forward is where you are looking,
    // taken from the look angles rather than from the camera matrix, which is
    // written later in the frame and would be one frame stale here.
    if (this.firstPerson) this.firstPerson.getForward(this._moveForward);
    else this.camera.getWorldDirection(this._moveForward);
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

    // A dedicated backdrop is optional and must never block the boot: a missing
    // or malformed panorama should cost you the sky, not the app.
    /*
     * `?streetview` puts Google Street View behind the scene, and takes every
     * other backdrop off: the generated panoramas and the flat void are both
     * replaced, not layered under it.
     *
     * The key is not committed. It arrives as `?gmapskey=...` or, for a build
     * that owns one, as `VITE_GOOGLE_MAPS_KEY` in `.env`.
     */
    const params = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

    if (params.has('streetview')) {
      const at = params.get('streetview');
      // Accepts a scene id (`?streetview=taj-mahal`) or a raw coordinate.
      const named = at ? findScene(at) : null;
      if (named) {
        this.scene_ = named;
        settings.environment.streetViewLat = named.lat;
        settings.environment.streetViewLng = named.lng;
      } else if (at && at.includes(',')) {
        const [lat, lng] = at.split(',').map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          settings.environment.streetViewLat = lat;
          settings.environment.streetViewLng = lng;
        }
      } else {
        this.scene_ = DEFAULT_SCENE;
        settings.environment.streetViewLat = DEFAULT_SCENE.lat;
        settings.environment.streetViewLng = DEFAULT_SCENE.lng;
      }
      this.loading.setProgress(0.15, 'Connecting Street View…');
      await this._startStreetView(
        params.get('gmapskey') || import.meta.env?.VITE_GOOGLE_MAPS_KEY || ''
      );
    }

    // `?panorama=./hdri/whatever.jpg` overrides the configured backdrop, so a
    // freshly generated panorama can be tried by dropping it in `public/` and
    // editing the address bar — no rebuild, no code change.
    const panoramaOverride =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('panorama')
        : null;
    if (panoramaOverride) settings.environment.panoramaUrl = panoramaOverride;

    if (settings.environment.panoramaUrl) {
      this.loading.setProgress(0.2, 'Loading backdrop…');
      try {
        this.environment.setBackdrop(await assets.loadPanorama(settings.environment.panoramaUrl));
        // A backdrop was asked for explicitly; show it rather than making the
        // caller also flip the mode.
        settings.environment.backgroundMode = 'panorama';

        /*
         * The depth map that turns the backdrop into geometry.
         *
         * Derived from the panorama's own name unless one is given, because
         * generators emit the pair together — `sky.png` / `sky_depth.png`. A
         * missing depth map is not an error: parallax simply stays off and the
         * panorama is drawn flat, which is the sensible thing to do rather than
         * failing a boot over an optional effect.
         */
        const base = settings.environment.panoramaUrl;
        /*
         * A depth map is very often a PNG even when the panorama is a JPEG,
         * because JPEG's block compression shows up in geometry as wobble along
         * every silhouette. So the sibling is tried in its own format and as a
         * PNG before giving up.
         */
        const candidates = settings.environment.depthUrl
          ? [settings.environment.depthUrl]
          : [
              // PNG first: a depth map is nearly always one, because JPEG's
              // block compression shows up in geometry as wobble along every
              // silhouette. Probing the panorama's own extension first meant a
              // 404 in the console on every single boot.
              base.replace(/(\.[a-z0-9]+)(\?|#|$)/i, '_depth.png$2'),
              base.replace(/(\.[a-z0-9]+)(\?|#|$)/i, '_depth$1$2')
            ];

        let loaded = false;
        for (const url of candidates) {
          try {
            this.environment.setDepthMap(await assets.loadTexture(url));
            settings.environment.parallax = true;
            loaded = true;
            break;
          } catch {
            /* try the next spelling */
          }
        }
        if (!loaded) console.info('[env] no depth map beside', base, '— backdrop stays flat');

        if (loaded) this._stageForPanorama();
      } catch (error) {
        console.warn('[env] backdrop failed to load, falling back to the probe', error);
      }
    }

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

    /*
     * The loaders may still be resolving textures against a blob URL after
     * their own promise has resolved, so the URLs are only released once every
     * queued request has settled — revoking earlier turns a texture into a
     * silent 404.
     */
    await assets.settled();
    assets.releaseBlobs();

    const { cached, fetched, bytes } = assets.stats;
    const mb = (bytes / 1024 / 1024).toFixed(1);
    this.loading.setProgress(1, cached && !fetched
      ? `Ready — ${mb}MB from cache`
      : `Ready — ${cached} cached, ${fetched} downloaded`);
    console.info(`[assets] ${cached} from cache, ${fetched} downloaded, ${mb}MB total`);
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

    // The backdrop is a DOM layer, so it is turned rather than rendered: the
    // viewer is told where the camera looks and draws its own pixels.
    if (this.sandbox) {
      this.dummies.update(raw);
      this.mana.update(raw);
      this.statusBar.update(
        { current: this.session.player.currentHP, max: this.session.player.maxHP },
        { current: this.mana.current, max: this.mana.max }
      );
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

    /*
     * After the rig, not before: `rig.update` is the last thing that moves the
     * camera, and it damps toward its own idea of where the camera belongs.
     * Aligning first meant being overwritten in the same frame — measured at
     * 3.96m and -14.5 degrees against the 2.5m and -6 that were asked for.
     */
    if (this.firstPerson) {
      this.firstPerson.position.set(this.character.position.x, 0, this.character.position.z);
      this.firstPerson.update();
      this.hands?.update(raw, this._moveSpeed ?? 0);
    }

    if (this.streetView) {
      this._walkTheStreet();
      if (!this.firstPerson) this._alignCameraToStreet();
      this.streetView.sync(this.camera);
      this._updateMiniMap();
    }

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
    this.hands?.dispose();
    this.firstPerson?.dispose();
    this.statusBar?.dispose();
    this.directionPad?.dispose();
    this.miniMap?.dispose();
    this.sceneSelector?.dispose();
    this.streetView?.dispose();
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
