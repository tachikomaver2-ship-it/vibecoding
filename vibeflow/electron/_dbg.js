const e = require('electron');
console.log('[DBG] electron version:', process.versions.electron);
console.log('[DBG] keys:', Object.keys(e));
console.log('[DBG] typeof app:', typeof e.app);
console.log('[DBG] typeof BrowserWindow:', typeof e.BrowserWindow);
try {
  console.log('[DBG] app.getPath:', e.app && e.app.getPath('userData'));
} catch (err) {
  console.log('[DBG] app.getPath threw:', err.message);
}
