import { LoadingManager, TextureLoader, EquirectangularReflectionMapping, SRGBColorSpace } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { readAsset, writeAsset } from './AssetCache.js';

/**
 * A 1×1 opaque white PNG.
 *
 * Authoring tools bake absolute local texture paths into FBX files (this model
 * points at `C:/Users/.../textures/...`). Those requests can never resolve from
 * a web server, so they are redirected here: the material keeps a neutral map
 * instead of a permanently pending texture, and the console stays clean.
 */
export const PLACEHOLDER_TEXTURE_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/** Matches a drive-letter or UNC path that leaked into an asset reference. */
const ABSOLUTE_LOCAL_PATH = /(^|\/)[A-Za-z]:[\\/]|^\\\\/;

/**
 * Central asset loading with a single progress stream.
 *
 * Every loader shares one LoadingManager so the boot screen can report real
 * aggregate progress instead of guessing.
 */
export class AssetLoader {
  constructor() {
    this.manager = new LoadingManager();
    this.manager.setURLModifier((url) =>
      ABSOLUTE_LOCAL_PATH.test(url) ? PLACEHOLDER_TEXTURE_URL : url
    );

    this.fbx = new FBXLoader(this.manager);
    this.hdr = new HDRLoader(this.manager);
    this.texture = new TextureLoader(this.manager);

    this._onProgress = null;
    this._loaded = 0;
    this._total = 0;
    this._settleWaiters = [];

    /** Blob URLs handed to the loaders, released once loading is done. */
    this._blobs = [];
    /** Counts for the boot readout. */
    this.stats = { cached: 0, fetched: 0, bytes: 0 };

    this.manager.onStart = (url, loaded, total) => {
      this._loaded = loaded;
      this._total = total;
    };
    this.manager.onProgress = (url, loaded, total) => {
      this._loaded = loaded;
      this._total = total;
      this._onProgress?.(total ? loaded / total : 0, url);
    };
    this.manager.onLoad = () => {
      this._loaded = this._total;
      this._settleWaiters.splice(0).forEach((resolve) => resolve());
    };
    this.manager.onError = (url) => console.error(`[AssetLoader] failed: ${url}`);
  }

  onProgress(callback) {
    this._onProgress = callback;
  }

  /**
   * Resolves once every queued request has settled.
   *
   * Loaders resolve as soon as the *model* is parsed; its textures are still in
   * flight at that point, so anything that inspects `texture.image` has to wait
   * for this first or it will read a half-initialised texture.
   */
  settled() {
    if (this._total === 0 || this._loaded >= this._total) return Promise.resolve();
    return new Promise((resolve) => this._settleWaiters.push(resolve));
  }

  /**
   * The bytes for `url`, from IndexedDB if they are there.
   *
   * Returns a blob URL rather than the buffer, because that lets every loader
   * stay exactly as it is: `FBXLoader`, `HDRLoader` and `TextureLoader` all know
   * how to load a URL, and none of them would need the same treatment to be
   * handed a buffer. The cost is that a blob URL has no directory, which
   * matters only for FBX — see `loadFBX`.
   *
   * A miss streams the download so the boot screen keeps moving on a 28MB file,
   * then stores it. Storage failing is not an error: the bytes are already in
   * hand and the load proceeds.
   *
   * @returns {Promise<{href: string, cached: boolean}>}
   */
  async _cachedUrl(url) {
    const key = encodeURI(url);

    const stored = await readAsset(key);
    if (stored) {
      this.stats.cached++;
      this.stats.bytes += stored.byteLength;
      return { href: this._blobUrl(stored), cached: true };
    }

    const response = await fetch(key);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);

    const expected = Number(response.headers.get('content-length')) || 0;
    let bytes;

    if (response.body && expected) {
      // Streamed so a large model reports real progress instead of sitting at
      // zero and then jumping to done.
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        this._onProgress?.(received / expected, url);
      }
      const joined = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      bytes = joined.buffer;
    } else {
      bytes = await response.arrayBuffer();
    }

    this.stats.fetched++;
    this.stats.bytes += bytes.byteLength;
    await writeAsset(key, bytes);
    return { href: this._blobUrl(bytes), cached: false };
  }

  _blobUrl(bytes) {
    const href = URL.createObjectURL(new Blob([bytes]));
    this._blobs.push(href);
    return href;
  }

  /**
   * Release the blob URLs.
   *
   * Held until now on purpose: a loader may still be resolving textures against
   * one after its own promise has resolved, and revoking early turns that into
   * a silent missing-texture.
   */
  releaseBlobs() {
    for (const href of this._blobs.splice(0)) URL.revokeObjectURL(href);
  }

  /** @returns {Promise<THREE.Group>} */
  async loadFBX(url) {
    const { href } = await this._cachedUrl(url);
    // A blob URL has no directory, so textures the FBX names relative to itself
    // would resolve against `blob:` and 404. Point the loader at the real
    // folder instead. (Most of this model's texture paths are absolute Windows
    // paths and get redirected to the placeholder anyway, but not all of them.)
    this.fbx.setResourcePath(url.slice(0, url.lastIndexOf('/') + 1));
    return new Promise((resolve, reject) => {
      this.fbx.load(href, resolve, undefined, reject);
    });
  }

  /** @returns {Promise<THREE.Texture>} */
  async loadTexture(url) {
    // Data URIs are already bytes in hand; caching them would store a copy of
    // something the bundle carries anyway.
    if (url.startsWith('data:')) {
      return new Promise((resolve, reject) => this.texture.load(url, resolve, undefined, reject));
    }
    const { href } = await this._cachedUrl(url);
    return new Promise((resolve, reject) => {
      this.texture.load(href, resolve, undefined, reject);
    });
  }

  /** @returns {Promise<THREE.DataTexture>} */
  async loadHDR(url) {
    const { href } = await this._cachedUrl(url);
    return new Promise((resolve, reject) => {
      this.hdr.load(href, resolve, undefined, reject);
    });
  }

  /**
   * Load an equirectangular panorama, picking the loader from the extension.
   *
   * Backdrops arrive in both kinds: a generated `.hdr` carries real range and
   * can also light a scene, while an 8K `.jpg` is the practical way to get a
   * sky that holds up at full screen without a 100MB download. Both end up as
   * an equirect-mapped texture; only the colour space differs.
   */
  async loadPanorama(url) {
    const isHDR = isHighDynamicRange(url);
    const texture = isHDR ? await this.loadHDR(url) : await this.loadTexture(url);
    texture.mapping = EquirectangularReflectionMapping;
    if (!isHDR) texture.colorSpace = SRGBColorSpace;
    return texture;
  }
}

/**
 * Whether a panorama URL points at high-dynamic-range data.
 *
 * Exported because the branch decides both which loader runs and which colour
 * space the texture gets, and both are wrong in ways that are hard to see: an
 * HDR read as sRGB comes out black, an sRGB read as linear comes out washed
 * out. A query string is common on generated assets (`?v=2`, signed URLs), so
 * the extension is matched before it, not at the end of the string.
 */
export function isHighDynamicRange(url) {
  return /\.(hdr|exr)(\?|#|$)/i.test(String(url ?? ''));
}
