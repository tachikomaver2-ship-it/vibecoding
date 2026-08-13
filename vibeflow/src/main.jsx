import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Render-time error guard: if the app throws (e.g. a component bug), show the
// message on screen instead of a silent black window.
function showFatal(message, stack) {
  const el = document.getElementById('root');
  if (!el) return;
  el.innerHTML =
    '<div style="padding:24px;font-family:system-ui,sans-serif;color:#e6e6e6;background:#0f1117;min-height:100vh;">' +
    '<h2 style="color:#ff6b6b;">VibeFlow 启动出错</h2>' +
    '<pre style="white-space:pre-wrap;background:#1a1d27;padding:16px;border-radius:8px;overflow:auto;">' +
    String(message) +
    (stack ? '\n\n' + String(stack) : '') +
    '</pre>' +
    '</div>';
}

window.addEventListener('error', (e) => {
  showFatal(e.message || '未知错误', e.error && e.error.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason || {};
  showFatal(r.message || '未处理的 Promise 异常', r.stack);
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
