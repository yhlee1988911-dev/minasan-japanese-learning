import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['app-icon.svg'],
      manifest: {
        name: 'nihongo 日语词汇记忆引擎',
        short_name: 'nihongo',
        description: '日语词汇记忆、听写、翻译与复习引擎',
        theme_color: '#70b96b',
        background_color: '#f7f7f2',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: '/app-icon.svg?v=ni-20260629', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,json,wav}']
      }
    })
  ]
});
