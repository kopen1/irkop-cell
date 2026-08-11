import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Proxy untuk development: arahkan /api ke Worker Team 1 (wrangler dev default: 8787).
  const proxy = env.VITE_API_PROXY || 'http://localhost:8787';
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: proxy, changeOrigin: true },
      },
    },
  };
});