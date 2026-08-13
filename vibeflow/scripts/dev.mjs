// Dev launcher: start the Vite dev server, wait until it is ready, then launch
// Electron pointing at the dev URL. Run with `npm run dev`.
import { spawn } from 'node:child_process';

const DEV_URL = 'http://localhost:5173';

const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });

async function waitPort(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (e) {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ready = await waitPort(DEV_URL);
if (!ready) {
  console.error('Vite dev server did not start in time.');
  vite.kill();
  process.exit(1);
}

const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ELECTRON_RENDERER_URL: DEV_URL },
});

vite.on('exit', () => {
  if (electron) electron.kill();
  process.exit(0);
});
electron.on('exit', () => {
  vite.kill();
  process.exit(0);
});
