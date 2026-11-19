import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { openBotApiPlugin } from './vite-plugin-openbot';

export default defineConfig(({ mode }) => {
  // The dev-only API plugin reads its settings from `process.env`, while Vite
  // only injects `VITE_*` into the client bundle. Load the env file here and
  // forward the one Node-side key, so `OPENBOT_DB_PATH` in `.env` is honoured
  // instead of silently ignored. Nothing else is copied into the process.
  const fileEnv = loadEnv(mode, process.cwd(), '');
  if (fileEnv.OPENBOT_DB_PATH && !process.env.OPENBOT_DB_PATH) {
    process.env.OPENBOT_DB_PATH = fileEnv.OPENBOT_DB_PATH;
  }

  return {
    plugins: [react(), openBotApiPlugin()],
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3'],
      },
    },
    optimizeDeps: {
      exclude: ['better-sqlite3'],
    },
  };
});
