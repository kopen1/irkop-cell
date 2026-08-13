import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Proxy untuk development: arahkan /api ke Worker Team 1 (wrangler dev default: 8787).
  const proxy = env.VITE_API_PROXY || 'http://localhost:8787';
  return {
    plugins: [react()],
    build: {
      cssTarget: ['chrome90', 'firefox78', 'safari13', 'ios12'],
    },
    server: {
      proxy: {
        '/api': { target: proxy, changeOrigin: true },
      },
    },
  };
});