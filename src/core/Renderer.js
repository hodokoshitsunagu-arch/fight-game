import {
  WebGLRenderer,
  PCFSoftShadowMap,
  ACESFilmicToneMapping,
  SRGBColorSpace
} from 'three';
import { settings } from '../config/settings.js';
import { qualityProfile } from './Quality.js';
import { measureViewport } from './Viewport.js';

/**
 * Thin wrapper around WebGLRenderer that owns canvas sizing, pixel-ratio
 * budgeting and the render-quality knobs the rest of the app never touches.
 */
export class Renderer {
  constructor(canvas) {
    this.gl = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      // Transparent so a DOM backdrop (Street View) can show through. The
      // context's alpha cannot be changed after creation, so it is always on;
      // opaque modes just clear with alpha 1.
      alpha: true,
      /*
       * Not premultiplied.
       *
       * The last pass writes straight colour and a separate alpha, which is
       * exactly what non-premultiplied means. Left at the default the browser
       * would read that colour as already multiplied, and every pixel with
       * partial coverage composites far too bright — figures over a backdrop
       * come out as white silhouettes.
       */
      premultipliedAlpha: false
    });

    const { width, height } = measureViewport(canvas);
    const pixelRatio = this.targetPixelRatio();
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(width, height, false);
    this._lastWidth = width;
    this._lastHeight = height;
    this._lastPixelRatio = pixelRatio;

    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    // The frame renders the scene several times (depth prepass, distortion,
    // contact shadows, main pass). Automatic updates would rebuild the cascade
    // shadow maps for every one of them, so the app flags a single update per
    // frame instead.
    this.gl.shadowMap.autoUpdate = false;

    // Tone mapping is executed by the post pipeline's OutputPass, which reads
    // these two properties from the renderer.
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = settings.post.exposure;
    this.gl.outputColorSpace = SRGBColorSpace;

    this.gl.info.autoReset = false;

    this._onResize = null;
    this._resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(this.handleResize)
      : null;
  }

  /** Cap the pixel ratio: 4K + heavy transparency is not worth the fill rate. */
  targetPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, qualityProfile().pixelRatio);
  }

  get domElement() {
    return this.gl.domElement;
  }

  get size() {
    return this.gl.getSize({ width: 0, height: 0 });
  }

  onResize(callback) {
    this._onResize = callback;
    window.addEventListener('resize', this.handleResize, { passive: true });
    window.visualViewport?.addEventListener('resize', this.handleResize, { passive: true });
    this._resizeObserver?.observe(this.domElement);
    callback?.(this._lastWidth, this._lastHeight, this._lastPixelRatio);
  }

  handleResize = () => {
    const { width, height } = measureViewport(this.domElement);
    const pixelRatio = this.targetPixelRatio();
    if (
      width === this._lastWidth &&
      height === this._lastHeight &&
      Math.abs(pixelRatio - this._lastPixelRatio) <= 0.001
    ) return;

    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(width, height, false);
    this._lastWidth = width;
    this._lastHeight = height;
    this._lastPixelRatio = pixelRatio;
    this._onResize?.(width, height, pixelRatio);
  };

  /** Called once per frame before rendering so the editor can drive exposure. */
  syncSettings() {
    this.gl.toneMappingExposure = settings.post.exposure;
    const wanted = this.targetPixelRatio();
    if (Math.abs(wanted - this.gl.getPixelRatio()) > 0.001) this.handleResize();
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    window.visualViewport?.removeEventListener('resize', this.handleResize);
    this._resizeObserver?.disconnect();
    this.gl.dispose();
  }
}
