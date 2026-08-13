import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built files load correctly from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react()],
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // In browser dev mode (npm run web:dev) the Node API server runs on 8788;
    // proxy /api there so the React app can call it same-origin.
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
});
