import { readFileSync } from 'node:fs';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Cross-origin isolation lets onnxruntime-web use SharedArrayBuffer (multi-threaded WASM).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// The local Worker's secret. The /api proxy attaches it server-side, so local
// builds (dev and `vite preview`) never need the secret baked into the bundle.
function devSecret(): string {
  try {
    return readFileSync('worker/.dev.vars', 'utf8').match(/^APP_SECRET=(.*)$/m)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

// /api/* -> local `wrangler dev`, so the phone only needs one forwarded port.
const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'http://localhost:8787',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ''),
    configure: (server) => {
      const secret = devSecret();
      server.on('proxyReq', (req) => {
        if (secret) req.setHeader('X-App-Secret', secret);
        // Server-to-server hop: the page's origin (e.g. a tunnel URL) isn't the Worker's caller.
        req.removeHeader('Origin');
      });
    },
  },
};

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [

    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        // "Read-Aloud" is a working name (DESIGN "Still open").
        name: 'Read-Aloud',
        short_name: 'Read-Aloud',
        description: 'Save articles, listen later.',
        start_url: '/',
        display: 'standalone',
        // Dark is primary; index.html sets the status bar per scheme from the `bg` token.
        background_color: '#151412',
        theme_color: '#151412',
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // woff2: the self-hosted fonts, so type works offline.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],

        // The transformers.js chunk is large; the app shell must still precache.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ort\//],
        runtimeCaching: [
          {
            // ~21 MB ORT WASM runtime: cache on first use, not at install.
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ort-wasm', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['kokoro-js', '@huggingface/transformers', 'phonemizer'],
    // Pre-bundle up front: on-demand discovery forces a full page reload mid-render.
    include: ['@breezystack/lamejs', '@mozilla/readability', 'dexie', 'dexie-react-hooks'],
  },
  // allowedHosts: lets a `cloudflared` quick tunnel reach the dev server for phone testing without USB.
  server: { headers: isolationHeaders, proxy, allowedHosts: ['.trycloudflare.com'] },
  preview: { headers: isolationHeaders, proxy, allowedHosts: ['.trycloudflare.com'] },
});
