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
      // OIDC interaction resume: post-login the SPA assigns /oidc/auth|device/:uid
      // (the resume cookie lives on the provider); without this dev proxy the hop
      // 404s on the SPA fallback (deploy single-port serves /oidc natively).
      '/oidc': {
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
