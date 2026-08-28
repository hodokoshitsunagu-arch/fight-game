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

import { settings } from '../config/settings.js';

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

  /*
   * Loaded with `callback=`, not `loading=async`.
   *
   * `loading=async` defers the bootstrap past the script's own `onload`, so at
   * that moment `google.maps` exists but `StreetViewPanorama` does not — and
   * neither does `importLibrary`, which is what that mode expects you to wait
   * on. Measured, not assumed: the script returns 200 and the namespace is
   * there, and the class is still missing. The callback parameter is the one
   * signal that actually means ready.
   */
  const promise = new Promise((resolve, reject) => {
    const callbackName = '__fightGameMapsReady';
    const timeout = setTimeout(() => reject(new Error('maps-api-timeout')), 20000);

    window[callbackName] = () => {
      clearTimeout(timeout);
      delete window[callbackName];
      if (window.google?.maps?.StreetViewPanorama) resolve(window.google.maps);
      else reject(new Error('maps-api-incomplete'));
    };

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&callback=${callbackName}`;
    // A blocked script never reaches the callback; a bad key does, and reports
    // itself through the API's own console error instead.
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('script-blocked'));
    };
    document.head.appendChild(script);
  });

  // Stamped after construction, not inside the executor: the executor runs
  // synchronously, while `promise` is still in its temporal dead zone, and
  // touching it there throws before the script tag has a chance to matter.
  document.getElementById(SCRIPT_ID)._promise = promise;
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

    /*
     * Two viewers, not one.
     *
     * `setPano` on a live viewer blanks it while the new tiles arrive —
     * measured at a full second of black between the old panorama vanishing and
     * the new one appearing, with the game still rendering on top of nothing.
     *
     * So the incoming panorama loads in a second viewer that nobody is looking
     * at, and the two cross-fade once it is ready. The wait is the same length;
     * it is just spent looking at where you were instead of at black.
     *
     * Note what this is *not*: nothing is pre-fetched or stored. Both viewers
     * are Google's own, rendering their own pixels on demand, which is the only
     * arrangement the Maps terms allow.
     */
    this.element = document.createElement('div');
    this.element.id = 'streetview';
    // Behind the canvas, and deaf to input: the game owns the pointer, and a
    // viewer that swallowed drags would fight the orbit controls for them.
    this.element.setAttribute(
      'style',
      // Explicit width/height rather than `inset:0`: measured at 960x0 with the
      // shorthand, so the viewer was loading its imagery into an element with no
      // height and nothing could ever show.
      'position:fixed; top:0; left:0; width:100vw; height:100vh;' +
        ' z-index:0; pointer-events:none; background:#0a0d12;'
    );
    this.panes = [0, 1].map((index) => {
      const pane = document.createElement('div');
      pane.className = 'streetview__pane';
      pane.setAttribute(
        'style',
        'position:absolute; inset:0; opacity:' + (index === 0 ? '1' : '0') +
          '; transition:opacity .28s ease;'
      );
      this.element.appendChild(pane);
      return pane;
    });
    this.viewers = [null, null];
    this.active = 0;

    document.body.insertBefore(this.element, document.body.firstChild);

    this._heading = 0;
    this._pitch = 0;
    this._zoom = 1;
  }

  /** @returns {Promise<boolean>} whether imagery is actually on screen. */
  async load() {
    try {
      const maps = await loadMapsApi(this.key);

      /*
       * Resolve an official panorama before showing anything.
       *
       * Handing a coordinate straight to the viewer takes whatever is nearest,
       * and in a place as photographed as Times Square that is usually somebody's
       * uploaded photosphere. Those are standalone: `getLinks()` comes back
       * empty, because they are not part of the road graph — measured at zero
       * links, which is to say nowhere to walk. Google's car coverage is
       * connected, so asking the service for `OUTDOOR` is what makes movement
       * possible at all, quite apart from being the better image.
       */
      const service = new maps.StreetViewService();
      let pano = null;
      try {
        const { data } = await service.getPanorama({
          location: this.position,
          radius: 80,
          source: maps.StreetViewSource?.OUTDOOR ?? undefined
        });
        pano = data?.location?.pano ?? null;
        if (data?.location?.latLng) {
          this.position = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
        }
        this.resolved = pano ? 'outdoor' : 'none';
        this.resolvedPano = pano;
      } catch (error) {
        // No outdoor coverage within reach; fall back to whatever is nearest,
        // which still shows a street even if it cannot be walked.
        this.resolved = `failed: ${error?.message ?? error}`.slice(0, 120);
      }

      const options = {
        ...(pano ? { pano } : { position: this.position }),
        pov: { heading: 0, pitch: 0 },
        // Google's own car imagery, not a user-uploaded photosphere. Times
        // Square has plenty of both, and the nearest pano to a coordinate is
        // often somebody's phone panorama — lower resolution, arbitrary date,
        // and a personal copyright line in the attribution.
        source: maps.StreetViewSource?.OUTDOOR ?? undefined,
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
      };

      this.viewers = this.panes.map((pane, index) =>
        new maps.StreetViewPanorama(pane, index === 0 ? options : { ...options, visible: false })
      );
      // `panorama` stays the one on screen, so everything reading it — the map,
      // the pad, the survey — needs no knowledge that there are two.
      this.panorama = this.viewers[0];

      // `status` is how a location with no coverage reports itself; the
      // constructor succeeds regardless.
      await new Promise((resolve) => {
        const listener = this.panorama.addListener('status_changed', () => {
          listener.remove();
          resolve();
        });
        setTimeout(resolve, 6000);
      });

      /*
       * Re-assert the resolved panorama.
       *
       * Observed intermittently landing back on a standalone photosphere even
       * after the service returned an outdoor pano — the viewer settles on its
       * own nearest match while the constructor options are still being
       * applied. Setting it again once the viewer is up makes it stick.
       */
      if (pano && this.panorama.getPano?.() !== pano) {
        this.panorama.setPano(pano);
        await new Promise((resolve) => {
          const once = this.panorama.addListener('pano_changed', () => { once.remove(); resolve(); });
          setTimeout(resolve, 3000);
        });
      }

      /*
       * Prove the viewer actually works before declaring it ready.
       *
       * A key the API rejects still yields a `StreetViewPanorama` object — it
       * is simply hollow, and every accessor on it throws from inside Google's
       * code. Reading back the position is the cheapest call that touches the
       * same machinery, so a rejected key fails here, inside the guard, rather
       * than three frames later in the render loop.
       */
      if (typeof this.panorama.getPosition !== 'function' || !this.panorama.getPosition()) {
        this.error = 'viewer did not initialise (check the key\'s referrer restrictions)';
        return false;
      }

      this.ready = true;
      this.walkable = (this.panorama.getLinks?.() ?? []).length > 0;

      /*
       * Self-heal onto walkable coverage.
       *
       * Resolving an outdoor panorama up front works most of the time and not
       * all of the time — observed landing back on a standalone photosphere on
       * some loads with the identical code path, which is a race inside the
       * viewer rather than anything reachable from here. Rather than chase it,
       * the outcome is checked: no links means no road graph, which means
       * nowhere to walk, so the service is asked again and the answer applied
       * to a viewer that is now fully up.
       */
      if (!this.walkable) {
        await this.moveTo(this.position.lat, this.position.lng, 80);
        await new Promise((r) => setTimeout(r, 900));
        this.walkable = (this.panorama.getLinks?.() ?? []).length > 0;
      }

      this.finalPano = this.panorama.getPano?.() ?? null;
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
    // Read by the mini map, which draws the same angle as a cone.
    this.heading = heading;
    this.panorama.setPov({ heading, pitch });
    this.panorama.setZoom(zoom);
  }

  /**
   * Step to the neighbouring panorama nearest a heading.
   *
   * Uses the links the viewer already has rather than asking the service for a
   * location, which costs nothing extra and is what "walking down the street"
   * actually is — Street View is a graph of capture points, not a continuous
   * space, so movement is a hop to the next node in roughly the right
   * direction. Refuses when the nearest link is off by more than a quarter
   * turn: stepping sideways into a different street because nothing better was
   * on offer is worse than not moving.
   *
   * @param {number} heading degrees clockwise from north
   * @returns {boolean} whether a step was taken
   */
  step(heading) {
    if (!this.ready || !this.panorama || this._stepping) return false;

    const links = this.panorama.getLinks?.() ?? [];
    if (!links.length) return false;

    let best = null;
    let bestOffset = Infinity;
    for (const link of links) {
      if (typeof link?.heading !== 'number' || !link.pano) continue;
      // Signed difference folded into [-180, 180], then magnitude.
      const offset = Math.abs(((link.heading - heading + 540) % 360) - 180);
      if (offset < bestOffset) {
        bestOffset = offset;
        best = link;
      }
    }

    if (!best || bestOffset > 90) return false;

    this._stepping = true;
    // Through the buffer, so the street being left stays on screen until the
    // one being arrived at is ready to replace it.
    this._swapTo(best.pano).finally(() => { this._stepping = false; });
    return true;
  }

  /**
   * Step to the nearest exit, whatever direction it is in.
   *
   * `step()` refuses a link more than a quarter turn off, which is right for a
   * player pressing a direction: walking sideways into another street because
   * nothing better was on offer is worse than not moving. It is wrong for the
   * campaign, where the alternative to moving is being stuck on a node forever.
   *
   * So this is the same search with the tolerance removed. It only fails when
   * the panorama genuinely has no exits.
   *
   * @param {number} heading degrees clockwise from north to prefer
   * @returns {boolean} whether a step was started
   */
  stepNearest(heading) {
    if (!this.ready || !this.panorama || this._stepping) return false;

    const links = this.panorama.getLinks?.() ?? [];
    const current = this.panorama.getPano?.() ?? null;

    let best = null;
    let bestOffset = Infinity;
    for (const link of links) {
      if (typeof link?.heading !== 'number' || !link.pano) continue;
      // A link pointing at the panorama already showing would report success
      // and change nothing, which reads exactly like the bug it causes.
      if (link.pano === current) continue;
      const offset = Math.abs(((link.heading - heading + 540) % 360) - 180);
      if (offset < bestOffset) {
        bestOffset = offset;
        best = link;
      }
    }

    if (!best) return false;

    this._stepping = true;
    this._swapTo(best.pano).finally(() => { this._stepping = false; });
    return true;
  }

  /**
   * Step relative to where the camera is facing.
   *
   * "Forward" has no meaning to Street View, which only knows compass bearings,
   * so the player's frame of reference has to be converted into one. This is
   * what makes a forward/back/left/right control possible at all.
   *
   * @param {number} relativeDeg 0 forward, 90 right, 180 back, -90 left
   */
  stepRelative(relativeDeg) {
    return this.step(((this.heading ?? 0) + relativeDeg + 360) % 360);
  }

  /**
   * Which of the four relative directions actually lead somewhere.
   *
   * A control that offers four ways out of a street with two is worse than no
   * control: the player learns the buttons lie. So availability is computed from
   * the panorama's own links, and a direction with nothing within the tolerance
   * comes back false and is drawn disabled.
   *
   * @returns {{forward:boolean,right:boolean,back:boolean,left:boolean}}
   */
  availableDirections(toleranceDeg = 55) {
    const links = this.ready ? this.panorama?.getLinks?.() ?? [] : [];
    const heading = this.heading ?? 0;
    const has = (relative) => {
      const want = (heading + relative + 360) % 360;
      return links.some((link) => {
        if (typeof link?.heading !== 'number') return false;
        return Math.abs(((link.heading - want + 540) % 360) - 180) <= toleranceDeg;
      });
    };
    return { forward: has(0), right: has(90), back: has(180), left: has(-90) };
  }

  /**
   * Jump somewhere else entirely.
   *
   * Goes through `StreetViewService` rather than assigning the coordinate
   * directly: an arbitrary lat/lng usually has no panorama exactly on it, and
   * the viewer would land on whatever happens to be nearest — including indoor
   * and user-submitted spheres. This asks for outdoor coverage within a radius
   * and reports honestly when there is none.
   *
   * @returns {Promise<boolean>}
   */
  async moveTo(lat, lng, radius = 60) {
    if (!this.ready || !window.google?.maps) return false;
    const maps = window.google.maps;
    this._service ??= new maps.StreetViewService();
    try {
      const { data } = await this._service.getPanorama({
        location: { lat, lng },
        radius,
        source: maps.StreetViewSource?.OUTDOOR ?? undefined
      });
      if (!data?.location?.pano) return false;
      await this._swapTo(data.location.pano);
      this.position = { lat, lng };
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Current position and the exits from it.
   *
   * Both come from the viewer rather than being tracked alongside it: a step
   * lands when the tiles do, and anything mirroring that state would be a frame
   * or two stale exactly when it matters.
   */
  survey() {
    if (!this.ready || !this.panorama) return null;
    const p = this.panorama.getPosition?.();
    if (!p) return null;
    return {
      position: { lat: p.lat(), lng: p.lng() },
      links: this.panorama.getLinks?.() ?? [],
      pano: this.panorama.getPano?.() ?? null
    };
  }

  /** The viewer nobody is looking at, which is where the next one loads. */
  get _idle() {
    return this.viewers[1 - this.active];
  }

  /**
   * Bring a panorama up behind the current one, then cross-fade.
   *
   * Resolves when the swap is done, or immediately if a swap is already in
   * flight — two transitions racing would leave whichever finished second
   * showing while `panorama` pointed at the other.
   */
  async _swapTo(panoId) {
    if (!panoId || this._swapping) return false;
    this._swapping = true;

    const incoming = this._idle;
    try {
      /*
       * Wake it first.
       *
       * The idle viewer is created with `visible: false` so it costs nothing
       * while nobody is looking at it — and a viewer that is not visible does
       * not render, so fading a pane onto it lands on an empty layer. Measured
       * as the screen going dark and staying dark, which looked exactly like
       * the bug this whole change was meant to fix.
       */
      incoming.setVisible(true);

      /*
       * If the idle viewer is already showing this panorama, it was preloaded
       * and there is nothing to wait for — the swap becomes a cross-fade over
       * pixels that are already there.
       */
      const preloaded = incoming.getPano?.() === panoId;
      // Match the current view before it becomes visible, or the cross-fade
      // lands on a different heading than the one being left.
      incoming.setPov(this.panorama.getPov());
      incoming.setZoom(this.panorama.getZoom());
      if (!preloaded) incoming.setPano(panoId);

      if (!preloaded) await new Promise((resolve) => {
        const listener = incoming.addListener('pano_changed', () => {
          listener.remove();
          resolve();
        });
        // Tiles keep arriving after the id changes; a short settle buys the
        // first sharp frame rather than fading onto a blur.
        setTimeout(resolve, 2500);
      });
      if (!preloaded) await new Promise((r) => setTimeout(r, 260));

      const outgoing = this.active;
      this.active = 1 - this.active;
      this.panes[this.active].style.opacity = '1';
      this.panes[outgoing].style.opacity = '0';
      this.panorama = this.viewers[this.active];

      const p = this.panorama.getPosition?.();
      if (p) this.position = { lat: p.lat(), lng: p.lng() };
      this.walkable = (this.panorama.getLinks?.() ?? []).length > 0;

      // Put the one behind back to sleep once the fade has finished, so only
      // one viewer is ever actually rendering.
      setTimeout(() => {
        this.viewers[outgoing].setVisible(false);
        this._preloadAhead();
      }, 450);
      return true;
    } catch {
      return false;
    } finally {
      this._swapping = false;
    }
  }

  /**
   * Bring the most likely next panorama up in the idle viewer.
   *
   * "Most likely" is the exit nearest the way the camera is pointing, which is
   * where walking goes and where the forward button goes. Exactly one, because
   * each of these is a billed load that is wasted if the player turns instead.
   */
  _preloadAhead() {
    if (!settings.environment.streetViewPreloadAhead) return;
    if (!this.ready || this._swapping) return;

    const links = this.panorama.getLinks?.() ?? [];
    if (!links.length) return;

    const heading = this.heading ?? 0;
    let best = null;
    let bestOffset = Infinity;
    for (const link of links) {
      if (typeof link?.heading !== 'number' || !link.pano) continue;
      const offset = Math.abs(((link.heading - heading + 540) % 360) - 180);
      if (offset < bestOffset) {
        bestOffset = offset;
        best = link;
      }
    }
    if (!best || bestOffset > 90) return;

    const idle = this._idle;
    if (idle.getPano?.() === best.pano) return;
    // Loaded but left invisible: it renders nothing until a swap wakes it.
    idle.setPano(best.pano);
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
