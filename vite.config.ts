import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { openBotApiPlugin } from './vite-plugin-openbot';

function parsePort(raw: string | undefined, fallback = 3000): number {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

function readDotEnvPort(mode: string): number {
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
  let found: string | undefined;
  for (const name of files) {
    const file = resolve(process.cwd(), name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?PORT\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      found = m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return parsePort(found, 3000);
}

export default defineConfig(({ mode }) => {
  // The dev-only API plugin reads its settings from `process.env`, while Vite
  // only injects `VITE_*` into the client bundle. Load the env file here and
  // forward the one Node-side key, so `OPENBOT_DB_PATH` in `.env` is honoured
  // instead of silently ignored. Nothing else is copied into the process.
  const fileEnv = loadEnv(mode, process.cwd(), '');
  if (fileEnv.OPENBOT_DB_PATH && !process.env.OPENBOT_DB_PATH) {
    process.env.OPENBOT_DB_PATH = fileEnv.OPENBOT_DB_PATH;
  }
  if (fileEnv.ALLOWED_HOSTS && !process.env.ALLOWED_HOSTS) {
    process.env.ALLOWED_HOSTS = fileEnv.ALLOWED_HOSTS;
  }
  const port = readDotEnvPort(mode);

  return {
    plugins: [react(), openBotApiPlugin()],
    server: {
      host: '0.0.0.0',
      port,
      allowedHosts: true,
    },
    preview: {
      host: '0.0.0.0',
      port,
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
