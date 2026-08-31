/**
 * MiniMap.js — where you are, which way you are facing, and where you can go.
 *
 * Street View on its own tells you none of those. It is a sphere: it has no
 * horizon you can orient against, no sense of which of the six ways out of a
 * junction you already came from, and no indication that walking is possible at
 * all until you try it. The companion map is what makes the movement legible.
 *
 * Four things are drawn, and each answers a question the panorama cannot:
 *
 *   the marker    where am I
 *   the cone      which way am I looking
 *   the spokes    which ways can I walk — these are the panorama's own links,
 *                 so a junction with six exits shows six, and a dead end shows
 *                 one
 *   the trail     where have I been, which is the only way to tell one identical
 *                 stretch of pavement from another
 *
 * A direction pad used to live in here, then in the corner, and now nowhere:
 * were fighting for the same 150 pixels and the pad won, covering the street
 * layout that is the only thing a map this small has to say. Tapping an exit
 * directly still works, and is the precise version of what the pad does
 * roughly.
 *
 * The map stays centred on the panorama rather than moving a marker around it,
 * so the cone can be a fixed CSS element in the middle of the box rather than a
 * rotating overlay — the view turns under a stationary player, which is also
 * how it feels in the game.
 *
 * A `google.maps.Map` is a billed Dynamic Maps load, on top of the Street View
 * request. One per session, not one per scene change.
 */

const LINK_LENGTH_M = 18;
const TRAIL_LIMIT = 60;

/** Offset a coordinate by metres along a heading. */
function project(lat, lng, headingDeg, metres) {
  const rad = (headingDeg * Math.PI) / 180;
  const dLat = (metres * Math.cos(rad)) / 111320;
  const dLng = (metres * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

export class MiniMap {
  constructor(root = document.body) {
    this.map = null;
    this.ready = false;
    this.open = true;
    this._links = [];
    this._trail = [];
    this._trailLine = null;
    this._heading = null;

    this.element = document.createElement('div');
    this.element.className = 'minimap';
    this.element.innerHTML = `
      <div class="minimap__canvas" data-map></div>
      <div class="minimap__cone" data-cone aria-hidden="true"></div>
      <div class="minimap__pin" aria-hidden="true"></div>
      <button class="minimap__toggle" data-toggle type="button" aria-label="Toggle map">▾</button>
      <div class="minimap__label" data-label>—</div>
`;
    root.appendChild(this.element);

    /** Set by App: `(headingDeg) => void`, from tapping an exit. */
    this.onStepHeading = null;

    this.canvas = this.element.querySelector('[data-map]');
    this.cone = this.element.querySelector('[data-cone]');
    this.label = this.element.querySelector('[data-label]');

    const toggle = this.element.querySelector('[data-toggle]');
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(!this.open);
    });
    // Inside a pointer-events:none HUD, and taps must not fall through and cast.
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      this.element.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  /** @param {typeof google.maps} maps */
  attach(maps, position) {
    this.maps = maps;
    this.map = new maps.Map(this.canvas, {
      center: position,
      zoom: 18,
      // Every control off: this is a readout, not a map to browse. Google's
      // attribution is not a control and stays.
      disableDefaultUI: true,
      gestureHandling: 'none',
      keyboardShortcuts: false,
      clickableIcons: false,
      // Dark, because it sits over a night scene as often as a day one.
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#232833' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8d97a7' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#12151b' }] },
        // Roads noticeably lighter than the ground: at 132px across, the street
        // layout is the only thing on this map worth reading, and a dark theme
        // that hides it defeats the point.
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#525c6b' }] },
        { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1b26' }] }
      ]
    });

    this._trailLine = new maps.Polyline({
      map: this.map,
      path: [],
      strokeColor: '#7fd8ff',
      strokeOpacity: 0.85,
      strokeWeight: 3
    });

    this.ready = true;
    this.setPosition(position);
  }

  /** Recentre, redraw the walkable exits, and extend the trail. */
  setPosition(position, links = []) {
    if (!this.ready || !position) return;

    this.map.setCenter(position);
    // Three decimals is ~100m — enough to say where, short enough for one line.
    this.label.textContent = `${position.lat.toFixed(3)}, ${position.lng.toFixed(3)}`;

    // The trail is what tells one identical stretch of pavement from another.
    const last = this._trail[this._trail.length - 1];
    if (!last || Math.abs(last.lat - position.lat) > 1e-6 || Math.abs(last.lng - position.lng) > 1e-6) {
      this._trail.push({ ...position });
      if (this._trail.length > TRAIL_LIMIT) this._trail.shift();
      this._trailLine.setPath(this._trail);
    }

    // Spokes are the panorama's own links, so they are the truth about where
    // walking can actually go — not a guess from the road geometry.
    for (const line of this._links) line.setMap(null);
    this._links = links
      .filter((link) => typeof link?.heading === 'number')
      .map((link) => {
        const line = new this.maps.Polyline({
          map: this.map,
          path: [position, project(position.lat, position.lng, link.heading, LINK_LENGTH_M)],
          strokeColor: '#ffffff',
          strokeOpacity: 0.5,
          // Fat enough to hit with a thumb, which is why it is not 1px.
          strokeWeight: 5,
          clickable: true,
          zIndex: 2
        });
        // Tapping the exit itself is the precise version of the pad: the pad
        // snaps to the nearest of four, this goes exactly where you pointed.
        line.addListener('click', () => this.onStepHeading?.(link.heading));
        return line;
      });

    this.element.classList.toggle('is-stuck', links.length === 0);
  }

  /**
   * Turn the view cone.
   *
   * Called every frame, so it writes only when the angle has moved enough to
   * see — a style write per frame is a layout invalidation per frame.
   */
  setHeading(headingDeg) {
    if (!this.ready) return;
    if (this._heading !== null && Math.abs(headingDeg - this._heading) < 0.6) return;
    this._heading = headingDeg;
    this.cone.style.transform = `translate(-50%, -100%) rotate(${headingDeg}deg)`;
  }

  setOpen(open) {
    this.open = open;
    this.element.classList.toggle('is-collapsed', !open);
  }

  dispose() {
    for (const line of this._links) line.setMap(null);
    this._trailLine?.setMap(null);
    this.element.remove();
  }
}
