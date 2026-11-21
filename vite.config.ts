import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-180.png'],
      manifest: {
        name: 'Plateway',
        short_name: 'Plateway',
        description: 'Plan a day of vehicle delivery jobs.',
        lang: 'en-GB',
        display: 'standalone',
        start_url: '/',
        background_color: '#0b0b0b',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 4_000_000 },
    }),
  ],
});
