import { adminSecurityHeaders } from '@truco/shared';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Espejo de `infra/docker/nginx-admin.conf`: el panel no se cachea ni se embebe. */
const adminHeaders = adminSecurityHeaders({
  production: false,
  apiOrigin: process.env['VITE_API_URL'] ?? 'http://127.0.0.1:3001',
});

export default defineConfig({
  plugins: [react()],
  server: {
    headers: adminHeaders,
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  // `vite preview` (suite E2E y staging) también necesita alcanzar la API.
  preview: {
    headers: adminHeaders,
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
