import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // /api/v1 not /api: /api-keys page route must reach the SPA fallback,
      // not the backend proxy (5101 down in mock-API e2e → ECONNREFUSED 500)
      '/api/v1': {
        target: process.env['VITE_API_URL'] || 'http://localhost:5101',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
