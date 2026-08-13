#!/usr/bin/env node
/**
 * Fix Electron binary on macOS after npmmirror install.
 *
 * Problem:
 * - The npmmirror electron zip is complete but extraction may land in the wrong
 *   path (root Electron.app/ instead of dist/Electron.app/) and the binary is
 *   unsigned / quarantined, causing Gatekeeper "will damage your computer".
 *
 * This script:
 * 1. Locates the downloaded electron-v*-darwin-*.zip in node_modules/electron.
 * 2. Removes stale dist/ or misplaced Electron.app/.
 * 3. Extracts the zip into dist/ so npm's path.txt resolves to dist/Electron.app.
 * 4. Clears quarantine xattr.
 * 5. Ad-hoc signs the bundle with --deep.
 * 6. Verifies signature.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function platform() {
  return process.platform;
}

function findElectronZip(electronDir) {
  const files = fs.readdirSync(electronDir).filter(
    (f) => /^electron-v[\d.]+-darwin-(arm64|x64)\.zip$/.test(f)
  );
  if (!files.length) return null;
  // Prefer arm64 on arm64, x64 on x64, otherwise take the first.
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return files.find((f) => f.includes(arch)) || files[0];
}

function main() {
  if (platform() !== 'darwin') {
    console.log('This script is only for macOS. Skipping.');
    process.exit(0);
  }

  const root = path.resolve(__dirname, '..');
  const electronDir = path.join(root, 'node_modules', 'electron');
  if (!fs.existsSync(electronDir)) {
    console.error('Error: node_modules/electron not found. Please run `npm install` first.');
    process.exit(1);
  }

  const zipName = findElectronZip(electronDir);
  if (!zipName) {
    console.error(
      'Error: electron zip not found in node_modules/electron.\n' +
        'Please run `npm install` (or re-install electron) so the zip is cached.'
    );
    process.exit(1);
  }

  const zipPath = path.join(electronDir, zipName);
  const distDir = path.join(electronDir, 'dist');
  const misplacedApp = path.join(electronDir, 'Electron.app');
  const appPath = path.join(distDir, 'Electron.app');

  console.log(`Detected electron zip: ${zipName}`);
  console.log('');

  // 1. Remove stale / misplaced app bundles.
  if (fs.existsSync(misplacedApp)) {
    console.log('Removing misplaced Electron.app (extracted to wrong path)...');
    run(`rm -rf "${misplacedApp}"`);
  }
  if (fs.existsSync(distDir)) {
    console.log('Removing stale dist/Electron.app...');
    run(`rm -rf "${distDir}"`);
  }

  // 2. Extract zip into dist/ (zip root is Electron.app/...).
  console.log('Extracting zip into node_modules/electron/dist/...');
  run(`mkdir -p "${distDir}"`);
  // Use ditto to preserve metadata; fall back to unzip.
  try {
    run(`ditto -x -k "${zipPath}" "${distDir}"`);
  } catch (e) {
    console.warn('ditto failed, falling back to unzip...');
    run(`unzip -q -o "${zipPath}" -d "${distDir}"`);
  }

  if (!fs.existsSync(appPath)) {
    console.error(`Error: ${appPath} not found after extraction.`);
    process.exit(1);
  }

  // 3. Clear quarantine xattr.
  console.log('Clearing quarantine xattr...');
  try {
    run(`xattr -cr "${appPath}"`);
  } catch (e) {
    console.warn('xattr -cr failed (may require permissions); continuing...');
  }

  // 4. Ad-hoc sign the bundle.
  console.log('Ad-hoc signing Electron.app (deep)...');
  run(`codesign --force --deep --sign - "${appPath}"`);

  // 5. Verify.
  console.log('Verifying signature...');
  try {
    run(`codesign -v "${appPath}"`);
    console.log('');
    console.log('✅ Electron.app fixed locally.');
    console.log('   Now run: npm start');
  } catch (e) {
    console.error('');
    console.error('⚠️ Signature verification failed. You may still see Gatekeeper warnings.');
    console.error('   If so, go to System Settings → Privacy & Security → allow Electron.');
    process.exit(1);
  }
}

main();
