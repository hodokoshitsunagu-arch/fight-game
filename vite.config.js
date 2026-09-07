import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { authorDraftMiddleware } from './self-created/adventure-draft-gateway.mjs';
import { adventureEventReceiver } from './self-created/adventure-event-receiver.mjs';

const sharedProjectsEnvDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'ADVENTURE_AI_');
  const eventEnv = loadEnv(mode, process.cwd(), 'ADVENTURE_EVENTS_');
  const sharedBrowserEnv = loadEnv(mode, sharedProjectsEnvDir, 'VITE_GOOGLE_MAPS_KEY');
  return {
    base: './',
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_KEY': JSON.stringify(
        sharedBrowserEnv.VITE_GOOGLE_MAPS_KEY ?? '',
      ),
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      open: false
    },
    plugins: [{
      name: 'local-adventure-draft-gateway',
      configureServer(server) {
        server.middlewares.use(authorDraftMiddleware({
          endpoint: process.env.ADVENTURE_AI_ENDPOINT || env.ADVENTURE_AI_ENDPOINT,
          apiKey: process.env.ADVENTURE_AI_KEY || env.ADVENTURE_AI_KEY,
          model: process.env.ADVENTURE_AI_MODEL || env.ADVENTURE_AI_MODEL,
        }));
        server.middlewares.use(adventureEventReceiver({
          enabled: (process.env.ADVENTURE_EVENTS_ENABLED || eventEnv.ADVENTURE_EVENTS_ENABLED) === 'true',
          region: process.env.ADVENTURE_EVENTS_REGION || eventEnv.ADVENTURE_EVENTS_REGION || null,
          enabledRegions: (process.env.ADVENTURE_EVENTS_ENABLED_REGIONS ||
            eventEnv.ADVENTURE_EVENTS_ENABLED_REGIONS || '').split(',').map((item) => item.trim())
            .filter(Boolean),
        }));
      },
    }],
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 2000
    },
    // Large binary assets (FBX / HDR) live in /public and are served untouched.
    assetsInclude: ['**/*.fbx', '**/*.hdr']
  };
});
