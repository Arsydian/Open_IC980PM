import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

/**
 * Vite configuration for Open_IC980PM.
 * Injects the synchronized package.json version into __APP_VERSION__
 * so both Electron and Web/PWA builds display the exact build badge.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    // jsdom renders of the 500-row grid and TypeScript compiles in tests can exceed Vitest's 5 s
    // default when test files run in parallel.
    testTimeout: 20_000,
  },
});
