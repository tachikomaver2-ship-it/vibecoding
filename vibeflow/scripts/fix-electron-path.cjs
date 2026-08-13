#!/usr/bin/env node
// Ensure node_modules/electron/path.txt has NO trailing newline.
// Electron's index.js does path.join(__dirname,'dist', readFileSync('path.txt'))
// with no trimming, so a stray '\n' gets baked into the spawn path and causes
// ENOENT ("Electron ...\n" not found). This makes the install reproducible.
const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
if (fs.existsSync(p)) {
  const s = fs.readFileSync(p, 'utf8').replace(/\r?\n+$/, '');
  fs.writeFileSync(p, s);
  console.log('[fix-electron-path] normalized path.txt ->', s);
} else {
  console.log('[fix-electron-path] path.txt not present yet (electron binary not downloaded). Skipping.');
}
