import { DEFAULT_APP_NAME } from '@truco/shared';
import { designTokens } from '@truco/ui';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: DEFAULT_APP_NAME,
        short_name: DEFAULT_APP_NAME,
        description: 'Truco argentino online en tiempo real',
        lang: 'es-AR',
        theme_color: designTokens.colors.clothGreen,
        background_color: designTokens.colors.surface,
        display: 'standalone',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3002',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
