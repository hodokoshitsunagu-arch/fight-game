import { MathUtils, Vector3 } from 'three';
import { settings } from '../config/settings.js';

/**
 * FirstPersonView.js — the camera stops orbiting a body and becomes the eyes.
 *
 * `OrbitControls` cannot do this. It is defined by a target and a radius, and
 * first person is that radius going to zero, at which point its whole model —
 * derive angles from the offset, damp them, write the position back — divides by
 * nothing. So the look is owned here instead: yaw and pitch as plain numbers, a
 * camera placed at eye height, and no target at all.
 *
 * Roll is never written. A horizon that tilts against a photographed street
 * reads as broken instantly, and there is no gameplay reason to ever tilt it.
 *
 * The hard part is not the camera, it is the pointer. One finger has to both
 * look around and cast, and those cannot both fire on the same gesture — so a
 * press is held until it either moves far enough to be a drag, or lifts without
 * having moved, which is a tap. Everything below `DRAG_SLOP` is somebody trying
 * to cast with a slightly unsteady thumb.
 */

const DRAG_SLOP = 8; // pixels before a press counts as looking rather than tapping

export class FirstPersonView {
  /**
   * @param {import('three').PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   */
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = false;

    /** Radians. Yaw is free; pitch is clamped so the view cannot invert. */
    this.yaw = 0;
    this.pitch = 0;

    /** Where the eyes are, in world space. */
    this.position = new Vector3(0, settings.camera.eyeHeight, 0);

    /** Set by App: a press that turned out to be a tap, not a drag. */
    this.onTap = null;

    this._pointer = null;
    this._startX = 0;
    this._startY = 0;
    this._lastX = 0;
    this._lastY = 0;
    this._dragging = false;

    this._bind();
  }

  _bind() {
    this._onDown = (event) => {
      if (!this.enabled || this._pointer !== null) return;
      // Presses that begin on the HUD belong to the HUD.
      if (event.target !== this.dom) return;
      this._pointer = event.pointerId;
      this._startX = this._lastX = event.clientX;
      this._startY = this._lastY = event.clientY;
      this._dragging = false;
      try {
        this.dom.setPointerCapture(event.pointerId);
      } catch {
        /* capture is a nicety */
      }
    };

    this._onMove = (event) => {
      if (!this.enabled || event.pointerId !== this._pointer) return;

      if (!this._dragging) {
        const travelled = Math.hypot(event.clientX - this._startX, event.clientY - this._startY);
        if (travelled < DRAG_SLOP) return;
        this._dragging = true;
      }

      const dx = event.clientX - this._lastX;
      const dy = event.clientY - this._lastY;
      this._lastX = event.clientX;
      this._lastY = event.clientY;

      const speed = settings.camera.lookSpeed * 0.0022;
      this.yaw -= dx * speed;

      /*
       * Vertical drag is ignored while the pitch is locked.
       *
       * Not clamped to zero afterwards — ignored, so a diagonal swipe turns
       * cleanly instead of turning and then snapping back. Against a
       * photographed street the horizon belongs to the panorama, and pitching
       * away from it is what makes things standing on the ground look like they
       * are not.
       */
      if (!settings.camera.lockPitch) {
        this.pitch = MathUtils.clamp(
          this.pitch - dy * speed,
          MathUtils.degToRad(-settings.camera.pitchLimit),
          MathUtils.degToRad(settings.camera.pitchLimit)
        );
      }
    };

    this._onUp = (event) => {
      if (event.pointerId !== this._pointer) return;
      this._pointer = null;
      try {
        this.dom.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      // A press that never became a drag was somebody aiming, not looking.
      if (!this._dragging && this.enabled) this.onTap?.(event);
      this._dragging = false;
    };

    this.dom.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  /** Open on a heading, in degrees clockwise from north. */
  setHeading(degrees) {
    this.yaw = -MathUtils.degToRad(degrees);
  }

  /** Degrees clockwise from north — what Street View wants. */
  get headingDegrees() {
    return (((-this.yaw * 180) / Math.PI) % 360 + 360) % 360;
  }

  /** Flat forward, for driving movement from where the eyes point. */
  getForward(out = new Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1).normalize();
  }

  /**
   * Place the camera. Called after everything that could have moved the player.
   *
   * Order matters: the rotation is written from yaw and pitch directly rather
   * than through `lookAt`, because `lookAt` derives an up vector and can roll
   * the camera when the view approaches vertical.
   */
  update() {
    if (!this.enabled) return;
    const camera = this.camera;
    camera.position.copy(this.position);
    camera.position.y = settings.camera.eyeHeight;
    // Roll is never written, and pitch is zero while locked: the horizon stays
    // exactly where the panorama put it.
    camera.rotation.set(settings.camera.lockPitch ? 0 : this.pitch, this.yaw, 0, 'YXZ');
    camera.updateMatrixWorld(true);
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
  }
}
