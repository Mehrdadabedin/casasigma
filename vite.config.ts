import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset URLs relative so the same build works inside the
// Capacitor Android WebView (served from https://localhost) and on the web.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    // Media (currently the brand logo) is served by the local Postgres-backed
    // API. Production builds read the same path from the deployed origin and
    // fall back to the bundled copy when no API is present.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787' },
    },
    // Capacitor's native project contains a copy of dist/, and Gradle writes
    // build output constantly. Watching it would reload the app mid-edit.
    watch: {
      ignored: ['**/android/**', '**/dist/**', '**/screenshots/**'],
    },
  },
  build: {
    outDir: 'dist',
  },
});
