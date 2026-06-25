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
        name: 'Minasan 初级日语',
        short_name: 'Minasan',
        description: '课程、词汇与短句一体化的初级日语学习应用',
        theme_color: '#70b96b',
        background_color: '#f7f7f2',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: '/app-icon.svg?v=mi-4ac10c8', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,json,wav}']
      }
    })
  ]
});
