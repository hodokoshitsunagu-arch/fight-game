import { App } from './core/App.js';
import { settings } from './config/settings.js';
import { LoadingScreen } from './ui/HUD.js';

/**
 * Entry point.
 *
 * Everything interesting lives in `core/App.js`; this file only wires the app
 * to the page and reports fatal boot errors somewhere the user can see them.
 */
const canvas = document.getElementById('viewport');

async function boot() {
  try {
    const app = new App(canvas);
    await app.load();

    // Handy for poking at the scene from the console.
    window.app = app;

    /**
     * Cast without a microphone:
     *
     *   cast('greater crimson frost lance')
     *   cast(['frost', 'lance', 'crimson'])   // word by word, mutates in flight
     *
     * Feeds the same path the recogniser drives, so it is a real substitute for
     * speaking rather than a debug shortcut — useful on a machine with no
     * microphone, and the only way to exercise voice casting in a test.
     */
    if (app.sandbox) {
      window.voice = app.voice;
      window.cast = (transcript) => app.voice.simulate(transcript);
      // Every tweakable value, for console tuning alongside the editor panel —
      // e.g. `settings.environment.backgroundMode = 'panorama'`.
      window.settings = settings;
    }
  } catch (error) {
    console.error('[boot] failed to start', error);
    new LoadingScreen().fail(
      error?.message ? `Failed to start: ${error.message}` : 'Failed to start — see the console.'
    );
  }
}

boot();
