#!/usr/bin/env node
// Replace an unsigned/mirror Electron binary with the official signed release.
// This avoids the macOS "...will damage your computer" Gatekeeper dialog that
// appears when npmmirror (or other mirrors) strip Apple's Developer ID signature.
// Downloads from GitHub official releases; in China it may be slow - use a proxy
// if you have one, or let it run in the background.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkg = require('../node_modules/electron/package.json');
const version = pkg.version;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const zipName = `electron-v${version}-darwin-${arch}.zip`;
const officialUrl = `https://github.com/electron/electron/releases/download/v${version}/${zipName}`;

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const zipPath = path.join(electronDir, zipName);

function download(url, dest) {
  console.log(`[use-signed-electron] Downloading signed Electron ${version} (${arch}) from GitHub...`);
  console.log(`  URL: ${url}`);
  console.log('  This may take a while in China. Use a proxy or leave it running.');
  // -L follows GitHub's redirect to objects.githubusercontent.com
  // -C - resumes partial downloads
  // --progress-bar shows a simple progress indicator in terminal
  execSync(`curl -L -C - --progress-bar -o "${dest}" "${url}"`, { stdio: 'inherit' });
}

async function main() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Backup existing unsigned binary (in case user wants to revert)
  const backupDir = path.join(electronDir, 'dist.unsigned-backup');
  if (fs.existsSync(distDir) && !fs.existsSync(backupDir)) {
    console.log('[use-signed-electron] Backing up current dist/ to dist.unsigned-backup/');
    fs.cpSync(distDir, backupDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(zipPath)) {
    try {
      download(officialUrl, zipPath);
    } catch (err) {
      console.error('\n[use-signed-electron] Download failed:', err.message);
      console.error('Tip: set a proxy via env, e.g. HTTPS_PROXY=http://127.0.0.1:7890 npm run use-signed-electron');
      process.exit(1);
    }
  } else {
    console.log(`[use-signed-electron] Reusing existing zip: ${zipPath}`);
  }

  console.log('[use-signed-electron] Removing old dist/...');
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  console.log('[use-signed-electron] Extracting signed Electron...');
  execSync(`unzip -q -o "${zipPath}" -d "${distDir}"`, { stdio: 'inherit' });

  console.log('[use-signed-electron] Verifying signature...');
  const verify = execSync(`codesign -dv "${path.join(distDir, 'Electron.app')}" 2>&1`).toString();
  if (!verify.includes('Signature=') || verify.includes('adhoc')) {
    console.warn('[use-signed-electron] WARNING: extracted binary still appears unsigned/ad-hoc.');
    console.warn('  You may still see Gatekeeper warnings.');
  } else {
    const sigLine = verify.split('\n').find(l => l.includes('Signature='));
    console.log(`[use-signed-electron] Signature OK: ${sigLine}`);
  }

  console.log('[use-signed-electron] Clearing any Gatekeeper xattrs...');
  execSync(`xattr -cr "${path.join(distDir, 'Electron.app')}"`, { stdio: 'inherit' });

  console.log('[use-signed-electron] Normalizing path.txt...');
  fs.writeFileSync(path.join(electronDir, 'path.txt'), 'Electron.app/Contents/MacOS/Electron');

  console.log('[use-signed-electron] Done. Run: npm run dev');
}

main().catch(err => {
  console.error('[use-signed-electron] Error:', err);
  process.exit(1);
});
