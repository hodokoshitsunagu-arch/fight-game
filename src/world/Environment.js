import {
  Scene,
  Fog,
  Vector3,
  Object3D,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  EquirectangularReflectionMapping,
  PMREMGenerator,
  DataUtils,
  MathUtils,
  LinearSRGBColorSpace
} from 'three';
import { settings } from '../config/settings.js';
import { getColor } from '../utils/color.js';
import { SkyDome } from './SkyDome.js';
import { frame } from '../core/FrameUniforms.js';
import { patchOnBeforeCompile } from '../utils/shaderPatch.js';

const _sunDir = new Vector3();

/** Half-width of the shadowed area, in metres, centred on the action. */
const SHADOW_EXTENT = 26;

/**
 * Scene, atmosphere and lighting.
 *
 * The look is a dark cinematic stage rather than an outdoor field: a warm key
 * light, a cool rim from behind, almost no fill, and a fog whose colour matches
 * the flat backdrop so the floor dissolves into the void at the edges. The HDR
 * probe is still loaded, but only as (dim) image-based lighting and as the
 * reflection source for the water / wind shaders — never as the visible sky.
 *
 * Sun shadows use one directional light whose orthographic shadow camera is
 * re-centred on the character every frame and fitted tightly to the play area.
 * At 4096² over a 52 m box that is ~1.3 cm per texel — sharper than a three
 * cascade split would give here, without the cost or the complexity.
 *
 * (An earlier revision used the CSM addon. It replaces three's
 * `lights_fragment_begin` chunk *globally*, which means every material in the
 * scene silently loses all directional lighting unless it is explicitly
 * registered with CSM — a footgun that is not worth it for a play area this
 * small.)
 */
export class Environment {
  /**
   * @param {import('../core/Renderer.js').Renderer} renderer
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;

    this.scene = new Scene();
    // Flat dark backdrop, kept in a Color we own so the editor can drive it.
    this._bgColor = getColor(settings.environment.backgroundColor).clone();
    this.scene.background = this._bgColor;

    /*
     * The parallax backdrop. Built up front and left invisible: it is one mesh
     * and one material, and creating it lazily would mean a shader compile on
     * the frame someone flips the toggle.
     */
    this.skyDome = new SkyDome();
    this.scene.add(this.skyDome.object3D);
    // Kept in a Fog we own so the editor can drive its colour and range, and so
    // it can be switched off entirely by detaching it from the scene.
    this._fog = new Fog(
      getColor(settings.environment.fogColor).clone(),
      settings.environment.fogNear,
      settings.environment.fogFar
    );
    this.scene.fog = settings.environment.fogEnabled ? this._fog : null;

    this.ambient = new AmbientLight(
      getColor(settings.environment.ambientColor).clone(),
      settings.environment.ambientIntensity
    );
    this.hemi = new HemisphereLight(
      getColor(settings.environment.hemiSkyColor).clone(),
      getColor(settings.environment.hemiGroundColor).clone(),
      settings.environment.hemiIntensity
    );

    this.sun = new DirectionalLight(
      getColor(settings.environment.sunColor).clone(),
      settings.environment.sunIntensity
    );
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = settings.environment.shadowBias;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = settings.environment.shadowRadius;

    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_EXTENT;
    shadowCamera.right = SHADOW_EXTENT;
    shadowCamera.top = SHADOW_EXTENT;
    shadowCamera.bottom = -SHADOW_EXTENT;
    shadowCamera.near = 0.5;
    shadowCamera.far = 140;
    shadowCamera.updateProjectionMatrix();

    /** The light aims at this; both are moved together to follow the action. */
    this.sunTarget = new Object3D();

    /**
     * Cool separation light coming from behind the stage. No shadows: it exists
     * purely to draw a bright edge around the character and the effects so they
     * do not merge into the dark backdrop.
     */
    this.rim = new DirectionalLight(
      getColor(settings.environment.rimColor).clone(),
      settings.environment.rimIntensity
    );
    this.rimTarget = new Object3D();
    this.rim.target = this.rimTarget;

    this.scene.add(this.ambient, this.hemi, this.sun, this.sunTarget, this.rim, this.rimTarget);
    this.sun.target = this.sunTarget;

    this.focus = new Vector3();
    this._envMap = null;
    this._pmrem = null;
    this._rimDir = new Vector3();
  }

  /**
   * Load the HDR probe. It lights the scene (IBL) but is deliberately *not*
   * used as the background — the stage keeps its flat dark backdrop.
   */
  async loadEnvironment(hdrTexture) {
    this._pmrem = new PMREMGenerator(this.renderer.gl);
    this._pmrem.compileEquirectangularShader();

    hdrTexture.mapping = EquirectangularReflectionMapping;
    const target = this._pmrem.fromEquirectangular(hdrTexture);

    this._envMap = target.texture;
    this.scene.environment = this._envMap;
    this.scene.environmentIntensity = settings.environment.envIntensity;

    // Kept as an equirect source for the cheap fake reflections inside the
    // custom water / wind shaders (they cannot use the PMREM cube directly) —
    // and, now, as the panorama backdrop.
    this.equirect = hdrTexture;
    // The probe doubles as the backdrop until a dedicated panorama is set.
    this._backdrop = hdrTexture;
    this._horizonColor = this._sampleHorizon(hdrTexture);

    this._pmrem.dispose();
    this._pmrem = null;
  }

  /**
   * Use a dedicated panorama as the backdrop, leaving the lighting probe alone.
   *
   * The horizon colour is re-read from whatever is actually on screen, since
   * that is what the fog has to match. An LDR source is already tone-mapped, so
   * its horizon needs no exposure compensation the way the probe's does — the
   * flag records which kind we have.
   *
   * @param {import('three').Texture|null} texture null restores the probe.
   */
  setBackdrop(texture) {
    this._backdrop = texture ?? this.equirect;
    this._backdropIsLDR = Boolean(texture) && texture !== this.equirect
      && !(texture.image?.data instanceof Uint16Array || texture.image?.data instanceof Float32Array);
    const sampled = this._sampleHorizon(this._backdrop) ?? this._sampleCanvasHorizon(this._backdrop);
    if (sampled) this._horizonColor = sampled;
    this._fogRoad = null;
    this.skyDome.setTextures(this._backdrop, this._depthMap ?? null);
  }

  /**
   * The backdrop's road colour, as a `#rrggbb` string.
   *
   * The play floor and the panorama's street are two different surfaces that
   * have to read as one material. Fog hides the join, but only if the floor is
   * already about the right colour underneath — fade a slate-blue plaza into a
   * wet-asphalt street and the fog just makes a slate-blue smear.
   *
   * Sampled well below the horizon, which in an equirectangular image is the
   * ground close to the camera: the part that is genuinely the same surface the
   * player is standing on, rather than the haze-tinted far street.
   *
   * @param {number} offset fraction of image height below the equator
   * @returns {string|null} null when the backdrop's pixels cannot be read
   */
  roadColour(offset = 0.28) {
    const backdrop = this._backdrop ?? this.equirect;
    // 0.06 linear is about sRGB 70: dark asphalt passes, white paint does not.
    const linear = this._sampleHorizon(backdrop, offset, 0.06)
      ?? this._sampleCanvasHorizon(backdrop, offset, 0.06);
    if (!linear) return null;

    // Back to sRGB, which is the space `floorColor` and friends are written in.
    const channel = (v) => {
      const encoded = Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
      return Math.round(encoded * 255).toString(16).padStart(2, '0');
    };
    return `#${channel(linear.r)}${channel(linear.g)}${channel(linear.b)}`;
  }

  /**
   * Attach the depth map that turns the backdrop into geometry.
   * Without one the dome is just a distant shell, indistinguishable from the
   * flat background — so parallax silently stays off rather than half-working.
   */
  setDepthMap(texture) {
    this._depthMap = texture ?? null;
    this._fogRoad = null;
    this.skyDome.setTextures(this._backdrop ?? this.equirect, this._depthMap);
  }

  /**
   * Horizon colour for a panorama that lives in an ImageBitmap rather than a
   * typed array — every `.jpg` / `.png` backdrop. Drawing it to a canvas is the
   * only way to read those pixels back, so it is done once, at a size that
   * costs nothing.
   */
  _sampleCanvasHorizon(texture, offset = settings.environment.fogHorizonOffset, ceiling = 1) {
    const image = texture?.image;
    if (!image || typeof document === 'undefined') return null;
    if (!(image.width > 0 && image.height > 0)) return null;

    try {
      const w = 256;
      const h = 128;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, w, h);

      const band = Math.max(1, Math.round(h * 0.05));
      const centre = h / 2 + h * offset;
      const start = Math.max(0, Math.min(h - band, Math.round(centre - band / 2)));
      const { data } = ctx.getImageData(0, start, w, band);

      let r = 0;
      let g = 0;
      let b = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        // sRGB -> linear, so it matches the space the fog colour is set in.
        // Road markings are paint, not surface. Clamping each sample keeps a
        // crossing full of white stripes from reporting the asphalt as grey.
        r += Math.min((data[i] / 255) ** 2.2, ceiling);
        g += Math.min((data[i + 1] / 255) ** 2.2, ceiling);
        b += Math.min((data[i + 2] / 255) ** 2.2, ceiling);
      }
      return { r: r / n, g: g / n, b: b / n };
    } catch {
      // A cross-origin image taints the canvas; fall back to the authored fog.
      return null;
    }
  }

  /**
   * Average colour of the probe's horizon band.
   *
   * Sampled a little *below* the equator by default. The fog's job is to hide
   * where the play floor stops, and the floor stops into the panorama's ground,
   * not into its sky. On a backdrop with a bright overcast horizon, matching the
   * sky instead paints the floor pale grey and it reads as a hill rising out of
   * the street.
   *
   * This is what the fog fades the floor into. Against the flat void the
   * authored fog colour matches the backdrop exactly and the floor edge
   * dissolves; against a panorama the same colour leaves a visible ring where
   * the ground stops, because the two no longer agree. Reading the horizon off
   * the panorama itself keeps that join invisible whatever probe is loaded.
   *
   * Samples are clamped before averaging so a sun sitting on the horizon does
   * not drag the whole result to white.
   *
   * @returns {{r:number,g:number,b:number}|null} linear RGB, or null if the
   *   texture cannot be read on the CPU (a compressed or GPU-only source).
   */
  _sampleHorizon(texture, offset = settings.environment.fogHorizonOffset, ceiling = 4) {
    const image = texture?.image;
    const data = image?.data;
    if (!data || !image.width || !image.height) return null;

    const { width, height } = image;
    const components = Math.round(data.length / (width * height));
    if (components < 3) return null;

    const half = data instanceof Uint16Array;
    // A band either side of the equator, which is the horizon in an
    // equirectangular projection.
    const band = Math.max(1, Math.round(height * 0.05));
    // Offset below the equator: see `fogHorizonOffset`.
    const centre = height / 2 + height * offset;
    const start = Math.max(0, Math.min(height - band, Math.round(centre - band / 2)));
    const stride = Math.max(1, Math.round(width / 256));

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;

    for (let y = start; y < Math.min(height, start + band); y++) {
      for (let x = 0; x < width; x += stride) {
        const i = (y * width + x) * components;
        const cr = half ? DataUtils.fromHalfFloat(data[i]) : data[i];
        const cg = half ? DataUtils.fromHalfFloat(data[i + 1]) : data[i + 1];
        const cb = half ? DataUtils.fromHalfFloat(data[i + 2]) : data[i + 2];
        if (!Number.isFinite(cr) || !Number.isFinite(cg) || !Number.isFinite(cb)) continue;
        // The sun is orders of magnitude brighter than the sky it sits in.
        r += Math.min(cr, ceiling);
        g += Math.min(cg, ceiling);
        b += Math.min(cb, ceiling);
        n++;
      }
    }

    if (!n) return null;
    return { r: r / n, g: g / n, b: b / n };
  }

  /**
   * Opt a material into the scene's shadow setup.
   *
   * Nothing is required any more — standard materials receive the sun by
   * default — but the hook is kept so callers do not need to care whether the
   * shadow implementation changes again.
   */
  registerShadowCaster(material) {
    return material;
  }

  /** Register a material and inject custom shader code into it. */
  registerShadowCasterWithPatch(material, patch) {
    patchOnBeforeCompile(material, patch);
    return material;
  }

  /** Keep the shadow volume centred on the action. */
  setFocus(x, z) {
    this.focus.set(x, 0, z);
  }

  /** Direction a light travels (from the light toward the scene). */
  _computeLightDirection(out, azimuth, elevation) {
    const cosE = Math.cos(elevation);
    out.set(-Math.cos(azimuth) * cosE, -Math.sin(elevation), -Math.sin(azimuth) * cosE);
    return out.normalize();
  }

  update() {
    const env = settings.environment;

    this._computeLightDirection(_sunDir, env.sunAzimuth, env.sunElevation);

    // Park the light up-sun from the focus point so the shadow frustum always
    // contains the play area.
    this.sunTarget.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(_sunDir, -70);

    // Hand the key direction to the custom shaders that fake their own normals.
    frame.uLightDir.value.copy(_sunDir).negate();

    this.sun.intensity = env.sunIntensity;
    this.sun.color.copy(getColor(env.sunColor));
    this.sun.shadow.radius = env.shadowRadius;
    this.sun.shadow.bias = env.shadowBias;

    this._computeLightDirection(this._rimDir, env.rimAzimuth, env.rimElevation);
    this.rimTarget.position.copy(this.focus);
    this.rim.position.copy(this.focus).addScaledVector(this._rimDir, -40);
    this.rim.intensity = env.rimIntensity;
    this.rim.color.copy(getColor(env.rimColor));

    this.ambient.intensity = env.ambientIntensity;
    this.ambient.color.copy(getColor(env.ambientColor));
    this.hemi.intensity = env.hemiIntensity;
    this.hemi.color.copy(getColor(env.hemiSkyColor));
    this.hemi.groundColor.copy(getColor(env.hemiGroundColor));

    this.scene.environmentIntensity = env.envIntensity;

    this._bgColor.copy(getColor(env.backgroundColor));

    /* ---- backdrop ---- */
    const backdrop = this._backdrop ?? this.equirect;
    const streetview = env.backgroundMode === 'streetview';
    const panorama = env.backgroundMode === 'panorama' && backdrop;
    // Parallax needs a depth map; without one the dome would just be a more
    // expensive way to draw the same flat sky.
    const parallax = panorama && env.parallax && Boolean(this._depthMap);
    this.skyDome.sync(env, parallax);

    /*
     * The dome has to fit inside the view frustum.
     *
     * The stage ships with `camera.far = 400`, which is generous for a 200-metre
     * floor and nowhere near enough for a city pushed out past it — the sky
     * shell lands beyond the far plane and is clipped away entirely, which on
     * screen is indistinguishable from the feature not working. So the camera is
     * extended to cover whatever the dome needs, and put back when it is off,
     * rather than shipping a far plane sized for a mode nobody may turn on.
     */
    this._baseFar ??= this.camera.far;
    const wantedFar = parallax ? Math.max(this._baseFar, this.skyDome.farDistance * 1.06) : this._baseFar;
    if (Math.abs(this.camera.far - wantedFar) > 1) {
      this.camera.far = wantedFar;
      this.camera.updateProjectionMatrix();
    }

    // With the dome on, the flat colour stays behind it as the clear — the dome
    // covers every pixel, so this is only ever seen if it fails to draw.
    // Assigning the same object every frame is a no-op in three; only a real
    // change touches the renderer.
    /*
     * `null` in Street View mode, so nothing is painted and the canvas clears
     * transparent onto the viewer behind it. Setting a colour here was the
     * reason the imagery loaded correctly and still showed as black: the clear
     * alpha was zero, and then a scene background painted straight over it.
     */
    this.scene.background = streetview ? null : (panorama && !parallax ? backdrop : this._bgColor);
    this.scene.backgroundIntensity = panorama && !parallax ? env.backgroundIntensity : 1;
    this.scene.backgroundBlurriness = panorama && !parallax ? env.backgroundBlur : 0;
    if (panorama && !parallax) {
      this.scene.backgroundRotation.y = MathUtils.degToRad(env.backgroundRotation);
      this.scene.backgroundRotation.x = MathUtils.degToRad(env.backgroundTilt);
    }

    // Attaching / detaching the fog flips the FOG shader define, so the switch
    // costs one recompile — fine for an editor toggle, and free while it stays on.
    this.scene.fog = env.fogEnabled ? this._fog : null;

    /*
     * On a grounded backdrop the floor fades into the road, so the fog has to be
     * the road's colour — the same sample the floor's own material takes, taken
     * the same way. Reading the horizon line instead picks up sky and crowd
     * lights, and the far floor turns pale against the near floor: a mound.
     *
     * A sky-only probe has no road, and there the horizon is the right answer.
     */
    if (parallax && env.fogFromHorizon) {
      this._fogRoad ??= this.roadColour();
      if (this._fogRoad) this._fog.color.copy(getColor(this._fogRoad));
      else this._fog.color.copy(getColor(env.fogColor));
    } else if (panorama && env.fogFromHorizon && this._horizonColor) {
      // Match the fog to the backdrop it fades into, scaled by the same
      // exposure the backdrop is drawn at, so the floor edge stays invisible.
      const h = this._horizonColor;
      const k = this._backdropIsLDR ? 1 : env.backgroundIntensity;
      this._fog.color.setRGB(
        Math.min(1, h.r * k),
        Math.min(1, h.g * k),
        Math.min(1, h.b * k),
        LinearSRGBColorSpace
      );
    } else {
      this._fog.color.copy(getColor(env.fogColor));
    }

    this._fog.near = env.fogNear;
    this._fog.far = env.fogFar;
  }

  dispose() {
    this.skyDome.dispose();
    this._depthMap?.dispose();
    this._envMap?.dispose();
    this.equirect?.dispose();
    this.sun.shadow.dispose();
  }
}
