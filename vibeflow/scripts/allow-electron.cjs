#!/usr/bin/env node
// One-click Gatekeeper bypass for the local Electron binary used during dev.
// Removes quarantine / provenance xattrs and re-applies an ad-hoc signature.
// Only needed when Electron was downloaded from a mirror that strips the
// official Apple signature (e.g. npmmirror). Run on macOS when you see the
// "...will damage your computer" dialog.
const { execSync } = require('child_process');
const path = require('path');

const app = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');

console.log('[allow-electron] Removing Gatekeeper xattrs...');
execSync(`xattr -cr "${app}"`, { stdio: 'inherit' });

console.log('[allow-electron] Re-signing ad-hoc (recursive)...');
execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });

console.log('[allow-electron] Done. You can now run npm run dev / npm start.');
