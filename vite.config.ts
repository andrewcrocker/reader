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
      // src/app/update.ts registers the worker and applies updates once nothing is playing.
      registerType: 'prompt',
      injectRegister: false,
      // Our own worker (src/sw.ts): it also handles shares and finishes work after the app closes.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icons/*.png'],
      manifest: {
        // "Reader" is the app's name (DESIGN "Still open": wordmark and icon).
        name: 'Reader',
        short_name: 'Reader',
        description: 'Save articles, listen later.',
        start_url: '/',
        display: 'standalone',
        // Dark is primary; index.html sets the status bar per scheme from the `bg` token.
        background_color: '#151413',
        theme_color: '#151413',
        // POST so the service worker takes it (and can work on it after the app closes), and so PDFs can be shared.
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'file', accept: ['application/pdf', '.pdf'] }] },
        },
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // A classic script (the app registers it as one; pdf.js's module-only bits are Node paths it never takes).
        rollupFormat: 'iife',
        // woff2: the self-hosted fonts, so type works offline; mp3: the voice samples in Settings.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2,mp3}'],
        // Only link-preview crawlers need the share card.
        globIgnores: ['og.png'],
        // The transformers.js chunk is large; the app shell must still precache.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
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
