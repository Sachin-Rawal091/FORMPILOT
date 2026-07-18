import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    modulePreload: {
      polyfill: false,
    },
    // Force ALL assets (notably the @fontsource woff/woff2 files pulled in via
    // index.css) to be emitted as separate files instead of inlined as base64
    // data: URIs. Inlined fonts violate the extension's CSP font-src directive —
    // and critically, @crxjs's dev-mode CSP (used for HMR under `npm run dev`)
    // doesn't include 'data:' at all, so inlined fonts silently break in dev
    // even though the production manifest CSP would technically allow them.
    assetsInlineLimit: 0,
  },
});

