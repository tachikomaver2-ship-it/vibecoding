#!/usr/bin/env node
// Browser dev mode (HMR). Starts the Node API server (port 8788) and the Vite
// dev server (port 5173, proxied /api -> 8788), then opens Chrome/Safari.
// No Electron binary required - the fastest way to debug the UI + backend.
import { spawn } from 'child_process';
import { platform } from 'os';

const api = spawn('node', ['server.cjs'], {
  env: { ...process.env, PORT: '8788' },
  stdio: 'inherit',
});

const vite = spawn('npx', ['vite', '--port', '5173'], {
  stdio: 'inherit',
});

const cleanup = () => {
  api.kill();
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

setTimeout(() => {
  if (platform() === 'darwin') {
    import('child_process').then(({ exec }) => exec('open http://localhost:5173'));
  }
}, 2500);
