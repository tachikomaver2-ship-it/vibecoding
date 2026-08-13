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
  },
});
