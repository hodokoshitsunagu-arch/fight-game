import { App } from './core/App.js';
import { settings } from './config/settings.js';
import { assetCacheStats, clearAssetCache } from './loaders/AssetCache.js';
import { LoadingScreen } from './ui/HUD.js';
import { campaignVersionFromSearch } from './campaign/campaignVersion.js';
import {
  PUBLISHED_ADVENTURE_PACKAGES,
} from './campaign/v3/PublishedAdventurePackages.js';
import { AdventureEventSink } from './campaign/v3/AdventureEventSink.js';

/**
 * Entry point.
 *
 * Everything interesting lives in `core/App.js`; this file only wires the app
 * to the page and reports fatal boot errors somewhere the user can see them.
 */
const canvas = document.getElementById('viewport');

async function boot() {
  try {
    const params = new URLSearchParams(window.location.search);
    const campaignVersion = campaignVersionFromSearch(window.location.search);
    let adventurePackage = PUBLISHED_ADVENTURE_PACKAGES[0] ?? null;
    if (import.meta.env.DEV && campaignVersion === 3) {
      const development = await import('./campaign/v3/packages/newYorkSharedShell.js');
      adventurePackage = development.NEW_YORK_SHARED_SHELL_PACKAGE;
    }
    const adventureEventSink = new AdventureEventSink({
      enabled: import.meta.env.VITE_ADVENTURE_EVENTS_ENABLED === 'true',
      region: import.meta.env.VITE_ADVENTURE_EVENTS_REGION ?? null,
      enabledRegions: (import.meta.env.VITE_ADVENTURE_EVENTS_ENABLED_REGIONS ?? '')
        .split(',').map((item) => item.trim()).filter(Boolean),
    });
    const app = new App(canvas, { adventurePackage, adventureEventSink });
    await app.load();

    // Handy for poking at the scene from the console.
    window.app = app;

    if (import.meta.env.DEV && campaignVersion === 3 && params.has('author')) {
      const [{ AdventureWorkbenchUI }, { StreetViewAdapter }] = await Promise.all([
        import('./ui/AdventureWorkbenchUI.js'),
        import('./campaign/v3/StreetViewAdapter.js'),
      ]);
      app.setAuthoringStreetView(true);
      window.adventureWorkbench = new AdventureWorkbenchUI({
        adventurePackage,
        streetView: new StreetViewAdapter(() => app.streetView),
        playtest: (draftPackage, startNodeId) =>
          app.startAuthorPlaytest(draftPackage, startNodeId),
        onDispose: () => app.setAuthoringStreetView(false),
      });
    }

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

      /*
       * Asset cache controls.
       *
       * `clear()` matters because the cache is keyed by URL and Vite does not
       * hash files in `public/` — a replaced model or panorama keeps its name,
       * so there is nothing for the cache to notice. Bumping `VERSION` in
       * AssetCache.js is the other way; this is the one that does not need a
       * rebuild.
       */
      window.assetCache = {
        stats: () => assetCacheStats().then((s) => ({
          ...s,
          megabytes: +(s.bytes / 1024 / 1024).toFixed(1)
        })),
        clear: () => clearAssetCache().then((ok) => ok ? 'cleared — reload to re-fetch' : 'unavailable')
      };
    }
  } catch (error) {
    console.error('[boot] failed to start', error);
    new LoadingScreen().fail(
      error?.message ? `Failed to start: ${error.message}` : 'Failed to start — see the console.'
    );
  }
}

boot();
