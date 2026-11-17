import { DEFAULT_APP_NAME, webSecurityHeaders } from '@truco/shared';
import { designTokens } from '@truco/ui';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const sharedDevProxy = {
  '/v1': {
    target: 'http://127.0.0.1:3001',
    changeOrigin: true,
  },
  '/lobby-socket.io': {
    target: 'http://127.0.0.1:3001',
    ws: true,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/lobby-socket\.io/, '/socket.io'),
  },
  '/socket.io': {
    target: 'http://127.0.0.1:3002',
    ws: true,
    changeOrigin: true,
  },
};

/**
 * Mismas cabeceras que nginx en producción (`infra/docker/nginx-web.conf`): si la CSP
 * rompe algo en `vite preview`, el E2E lo detecta antes de desplegar.
 */
const devSecurityHeaders = webSecurityHeaders({
  production: false,
  apiOrigin: process.env['VITE_API_URL'] ?? 'http://127.0.0.1:3001',
  gameServerOrigin: process.env['VITE_GAME_SERVER_URL'] ?? 'http://127.0.0.1:3002',
});

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'offline.html'],
      manifest: {
        id: '/',
        name: DEFAULT_APP_NAME,
        short_name: DEFAULT_APP_NAME,
        description:
          'Truco argentino online en tiempo real con baraja española propia y anotador sin conexión',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        theme_color: designTokens.colors.clothGreen,
        background_color: designTokens.colors.surface,
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/v1\//, /^\/socket\.io\//, /^\/lobby-socket\.io\//],
      },
    }),
  ],
  server: {
    headers: devSecurityHeaders,
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: sharedDevProxy,
  },
  preview: {
    headers: devSecurityHeaders,
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy: sharedDevProxy,
  },
});
