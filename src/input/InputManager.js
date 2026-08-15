import { Vector2 } from 'three';
import { EventEmitter } from '../utils/EventEmitter.js';

/**
 * Normalises pointer + keyboard input into a small event vocabulary.
 *
 * Events:
 *   `pointer:move` (ndc)          — every move, armed or not
 *   `pointer:confirm` (ndc)       — left click on the viewport
 *   `action` (name, element)      — everything else, already named by intent.
 *                                   `ability` carries a stable ability id.
 *
 * Pointer events that begin on top of DOM UI (the editor, the HUD) are ignored
 * so dragging a slider never fires the ability.
 */
export class InputManager extends EventEmitter {
  constructor(domElement) {
    super();
    this.dom = domElement;
    this.pointer = new Vector2(); // NDC
    this.keys = new Set();
    this.enabled = true;
    this.mode = 'gameplay';
    this.debugContext = false;

    this._bind();
  }

  _bind() {
    this.dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.dom.addEventListener('contextmenu', this._onContextMenu);
  }

  _onContextMenu = (event) => event.preventDefault();

  _updatePointer(event) {
    this.pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
  }

  _onPointerDown = (event) => {
    if (!this.enabled) return;
    if (event.target !== this.dom) return; // started on UI

    this._updatePointer(event);

    if (event.button === 0) {
      this.emit('pointer:confirm', this.pointer);
    } else if (event.button === 2) {
      // Right button also orbits (OrbitControls owns the drag); putting an armed
      // cast away on the same press is the convention players expect.
      this.emit('action', 'cancel');
    }
  };

  _onPointerMove = (event) => {
    this._updatePointer(event);
    this.emit('pointer:move', this.pointer);
  };

  _onKeyDown = (event) => {
    if (event.repeat) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    this.keys.add(event.code);

    if (event.code === 'F8') {
      this.debugContext = !this.debugContext;
      this.emit('action', 'toggleDebug', this.debugContext);
      event.preventDefault();
      return;
    }

    if (this.mode === 'upgrade' && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
      this.emit('action', 'upgradeChoice', Number(event.code.slice(-1)) - 1);
      event.preventDefault();
      return;
    }

    if (this.debugContext) {
      const debugActions = {
        KeyN: 'skipWave', KeyK: 'killAll', KeyJ: 'damageRelic', KeyH: 'healRelic',
        KeyE: 'spawnElite', KeyU: 'openUpgrade', KeyG: 'gameOver'
      };
      const action = debugActions[event.code];
      if (action) {
        this.emit('action', 'debug', action);
        event.preventDefault();
        return;
      }
    }

    switch (event.code) {
      // Ability ids. Keep these in step with `ELEMENT_META[...].key`.
      case 'Digit1':
        this.emit('action', 'ability', 'void');
        break;
      case 'Digit2':
        this.emit('action', 'ability', 'phoenix');
        break;
      case 'Digit3':
        this.emit('action', 'ability', 'singularity');
        break;
      case 'Digit4':
        this.emit('action', 'ability', 'worldtree');
        break;
      case 'Digit5':
        this.emit('action', 'selfAbility', 'repulse');
        break;
      case 'Digit6':
        this.emit('action', 'selfAbility', 'heal');
        break;
      case 'KeyQ':
        this.emit('action', 'ability', 'ice');
        break;
      case 'KeyE':
        this.emit('action', 'ability', 'thunder');
        break;
      case 'KeyR':
        this.emit('action', 'ability', 'meteor');
        break;
      case 'KeyF':
        this.emit('action', 'ability', 'beam');
        break;
      case 'KeyV':
        this.emit('action', 'ability', 'snare');
        break;
      case 'KeyX':
        this.emit('action', 'ability', 'glacier');
        break;
      case 'Escape':
        this.emit('action', 'cancel');
        break;
      case 'KeyH':
        this.emit('action', 'toggleHelp');
        break;
      case 'KeyG':
        this.emit('action', 'toggleEditor');
        break;
      case 'KeyC':
        this.emit('action', 'clear');
        break;
      case 'KeyP':
        this.emit('action', 'togglePause');
        break;
      case 'KeyB':
        this.emit('action', 'spawnHorde');
        break;
      default:
        break;
    }
  };

  _onKeyUp = (event) => {
    this.keys.delete(event.code);
  };

  _onBlur = () => this.keys.clear();

  /** Whether a physical key is currently held. */
  isDown(code) {
    return this.enabled && this.keys.has(code);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'gameplay') this.keys.clear();
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.dom.removeEventListener('contextmenu', this._onContextMenu);
    this.clear();
  }
}
