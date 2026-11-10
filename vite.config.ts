import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { sourceDefines } from './scripts/kit/source';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    VitePWA({
      // 'prompt' so lib/pwa.ts decides when to switch (never mid-edit); it reloads on its own.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Duffel',
        short_name: 'Duffel',
        description: 'A calm packing list for families.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#f6f5f0',
        background_color: '#f6f5f0',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Push notifications and the app-icon badge (Selfhost Kit: public/kit-push-sw.js).
        importScripts: ['kit-push-sw.js'],
        // ttf: the PDF's fonts, so Print works offline and fast enough to open the iPhone share
        // sheet from the tap (the PDF code is a js chunk, cached with the rest).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf}'],
        // Pages are network-first (below), so a deploy shows up on the next load instead of
        // waiting for the service worker. index.html stays precached only as the offline copy.
        navigateFallback: null,
        directoryIndex: null,
        cleanupOutdatedCaches: true,
        // Take over on first install (offline from the first visit). Updates still wait for
        // lib/pwa.ts to say when (it sends skipWaiting).
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' &&
              !/^\/(api|mcp|authorize|oauth|\.well-known|upload)(\/|$)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'duffel-pages',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
              precacheFallback: { fallbackURL: '/index.html' },
            },
          },
          {
            // Last-seen app state and trip lists stay readable offline.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              (url.pathname === '/api/state' || /^\/api\/trips\/[^/]+$/.test(url.pathname)),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'duffel-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 30, maxAgeSeconds: 30 * 86400 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    ...sourceDefines(),
  },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
});
