import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../node_modules/.vite', import.meta.url)),
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
