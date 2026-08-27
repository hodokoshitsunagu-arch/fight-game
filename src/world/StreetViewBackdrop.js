/**
 * StreetViewBackdrop.js — Google Street View as the backdrop.
 *
 * The imagery is *not* fetched, decoded or stored by us, and that is the whole
 * design. Google's Maps Platform terms forbid pre-fetching, indexing, storing or
 * caching Street View content — which rules out the obvious approach of pulling
 * a panorama and using it as a texture, and rules out this project's own asset
 * cache touching it.
 *
 * What the terms do allow is the official viewer. So `StreetViewPanorama`
 * renders into a DOM element of its own, behind a WebGL canvas made
 * transparent, and Google serves, decodes and attributes its own pixels. The
 * game camera drives the viewer's point of view, so it reads as a background
 * rather than as an embedded map. Google's logo and Terms link stay on screen,
 * because attribution is required and removing it is not ours to do.
 *
 * Consequences worth knowing, rather than discovering later:
 *
 *  - **It is DOM, not GL.** Nothing in the scene can occlude it, receive light
 *    from it, or be reflected in it. It is strictly behind everything.
 *  - **No depth, so no parallax.** The viewer projects its own sphere; we can
 *    turn it, not move through it.
 *  - **It needs a key and it bills.** Every load is a Street View request
 *    against someone's account.
 *  - **It needs the network, every session.** Nothing is cached, by design.
 */

const SCRIPT_ID = 'google-maps-js';

/** Times Square, on the pedestrian island at the middle of the bowtie. */
export const TIMES_SQUARE = { lat: 40.758, lng: -73.9855 };

/**
 * Load the Maps JavaScript API once.
 *
 * Resolves with the `google.maps` namespace, or rejects — a missing key, a
 * referer restriction and an offline machine all land here, and the caller has
 * to be able to say so rather than showing a black screen.
 */
function loadMapsApi(key) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google.maps);
  if (!key) return Promise.reject(new Error('no-key'));

  const existing = document.getElementById(SCRIPT_ID);
  if (existing?._promise) return existing._promise;

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async`;
    script.onload = () =>
      window.google?.maps?.StreetViewPanorama
        ? resolve(window.google.maps)
        : reject(new Error('maps-api-incomplete'));
    script.onerror = () => reject(new Error('script-blocked'));
    document.head.appendChild(script);
    script._promise = promise;
  });

  return promise;
}

export class StreetViewBackdrop {
  /**
   * @param {object} options
   * @param {string} options.key    Maps JavaScript API key
   * @param {{lat:number,lng:number}} options.position
   */
  constructor({ key, position = TIMES_SQUARE } = {}) {
    this.key = key;
    this.position = position;
    this.panorama = null;
    this.ready = false;
    this.error = null;

    this.element = document.createElement('div');
    this.element.id = 'streetview';
    // Behind the canvas, and deaf to input: the game owns the pointer, and a
    // viewer that swallowed drags would fight the orbit controls for them.
    this.element.setAttribute(
      'style',
      'position:fixed; inset:0; z-index:0; pointer-events:none; background:#0a0d12;'
    );
    document.body.insertBefore(this.element, document.body.firstChild);

    this._heading = 0;
    this._pitch = 0;
    this._zoom = 1;
  }

  /** @returns {Promise<boolean>} whether imagery is actually on screen. */
  async load() {
    try {
      const maps = await loadMapsApi(this.key);
      this.panorama = new maps.StreetViewPanorama(this.element, {
        position: this.position,
        pov: { heading: 0, pitch: 0 },
        // Every control off: the game camera is the only thing that should move
        // this. The Google logo and Terms link are not controls and stay — they
        // are the attribution the terms require.
        addressControl: false,
        linksControl: false,
        panControl: false,
        zoomControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        enableCloseButton: false,
        showRoadLabels: false,
        clickToGo: false,
        scrollwheel: false,
        disableDoubleClickZoom: true
      });

      // `status` is how a location with no coverage reports itself; the
      // constructor succeeds regardless.
      await new Promise((resolve) => {
        const listener = this.panorama.addListener('status_changed', () => {
          listener.remove();
          resolve();
        });
        setTimeout(resolve, 6000);
      });

      this.ready = true;
      return true;
    } catch (error) {
      this.error = error.message;
      return false;
    }
  }

  /**
   * Point the viewer where the camera is looking.
   *
   * Street View measures heading clockwise from north and pitch upward from the
   * horizon, and expresses field of view as a zoom level, so all three are
   * converted rather than passed through. Writes are skipped when nothing moved
   * enough to see: `setPov` crosses into the viewer's own render loop and is not
   * free at 60Hz.
   *
   * @param {import('three').Camera} camera
   */
  sync(camera) {
    if (!this.ready || !this.panorama) return;

    const m = camera.matrixWorld.elements;
    // Third basis column negated: the direction a camera looks down.
    const dx = -m[8];
    const dy = -m[9];
    const dz = -m[10];

    const heading = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const pitch = (Math.asin(Math.max(-1, Math.min(1, dy))) * 180) / Math.PI;
    // The viewer's zoom is a halving of field of view per step.
    const zoom = Math.log2(180 / Math.max(10, camera.fov));

    if (
      Math.abs(heading - this._heading) < 0.15 &&
      Math.abs(pitch - this._pitch) < 0.15 &&
      Math.abs(zoom - this._zoom) < 0.02
    ) {
      return;
    }

    this._heading = heading;
    this._pitch = pitch;
    this._zoom = zoom;
    this.panorama.setPov({ heading, pitch });
    this.panorama.setZoom(zoom);
  }

  setPosition(position) {
    this.position = position;
    this.panorama?.setPosition(position);
  }

  setVisible(visible) {
    this.element.style.display = visible ? '' : 'none';
  }

  dispose() {
    this.panorama = null;
    this.element.remove();
  }
}
