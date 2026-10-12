import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// During `npm run dev`, /api/udyam/verify is proxied to the udyamVerify function running in the
// Firebase emulator (`npm run emulators`). In production, Firebase Hosting rewrites the same path
// to the deployed function (firebase.json), so the browser only ever talks to its own origin.
const FUNCTION_EMULATOR_URL = process.env.UDYAM_FUNCTION_EMULATOR_URL ?? 'http://127.0.0.1:5001/demo-pcred/asia-south1/udyamVerify';
const emulatorProxy = { target: FUNCTION_EMULATOR_URL, changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  cacheDir: 'node_modules/.vite',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./functions/src/udyam', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/udyam/verify': { ...emulatorProxy, rewrite: () => '' },
      '/api/udyam/checkout': { ...emulatorProxy, rewrite: () => '/checkout' },
      '/api/udyam/unlock': { ...emulatorProxy, rewrite: () => '/unlock' },
      '/api/udyam/otp/send': { ...emulatorProxy, rewrite: () => '/otp/send' },
      '/api/udyam/otp/verify': { ...emulatorProxy, rewrite: () => '/otp/verify' },
      '/api/udyam/certificate': { ...emulatorProxy, rewrite: () => '/certificate' },
      '/api/udyam/lead': { ...emulatorProxy, rewrite: () => '/lead' },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
