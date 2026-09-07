import { defineConfig, loadEnv } from 'vite';
import { authorDraftMiddleware } from './self-created/adventure-draft-gateway.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'ADVENTURE_AI_');
  return {
    base: './',
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
