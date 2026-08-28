/**
 * Frame timer.
 *
 * A three-line replacement for THREE.Clock (deprecated in recent releases) that
 * also owns the delta clamp: a background tab or a long shader compile must
 * never hand the simulation a multi-second step.
 */
export class Time {
  constructor(maxDelta = 1 / 20) {
    this.maxDelta = maxDelta;
    this.elapsed = 0;
    this.delta = 0;
    /**
     * Wall-clock seconds since the previous tick, clamped far more loosely.
     *
     * The simulation must never take a multi-second step, but a story card and
     * a fade are read by a person, not integrated by a solver — pacing them off
     * the clamped delta means they stretch out exactly when the frame rate
     * drops, which is when a shader is compiling or a panorama is loading and
     * the player is already waiting.
     */
    this.realDelta = 0;
    this._last = performance.now() / 1000;
  }

  /** @returns {number} clamped seconds since the previous tick */
  tick() {
    const now = performance.now() / 1000;
    const elapsed = now - this._last;
    // Still bounded: returning from a backgrounded tab should not fast-forward
    // through several beats at once.
    this.realDelta = Math.min(elapsed, 0.5);
    this.delta = Math.min(elapsed, this.maxDelta);
    this._last = now;
    this.elapsed += this.delta;
    return this.delta;
  }

  /** Call after a long pause (asset load, tab switch) to avoid a jump. */
  reset() {
    this._last = performance.now() / 1000;
    this.delta = 0;
    this.realDelta = 0;
  }
}
