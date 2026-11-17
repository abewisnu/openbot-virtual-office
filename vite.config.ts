import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { openBotApiPlugin } from './vite-plugin-openbot';

export default defineConfig({
  plugins: [react(), openBotApiPlugin()],
  build: {
    rollupOptions: {
      external: ['better-sqlite3'],
    },
  },
  optimizeDeps: {
    exclude: ['better-sqlite3'],
  },
});
