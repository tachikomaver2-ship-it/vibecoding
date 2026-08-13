#!/usr/bin/env node
// Browser debug server (no Electron binary needed).
// Reuses the exact same Store + seed as the Electron main process, exposes the
// handlers over HTTP, and serves the built dist/. Run `npm run web` then open
// http://localhost:8787 in Chrome/Safari. Fast alternative when downloading
// the signed Electron binary is too slow.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./electron/store');
const { buildSeed } = require('./electron/seed');

const PORT = process.env.PORT || 8787;
const distDir = path.join(__dirname, 'dist');
const dataDir = path.join(__dirname, '.vibeflow-data');
const dataPath = path.join(dataDir, 'vibeflow-data.json');
const projectsDir = path.join(__dirname, 'projects');

const store = new Store(dataPath);
const existing = store.load();
store.state = existing || buildSeed();
if (!existing) {
  fs.mkdirSync(dataDir, { recursive: true });
  store.save();
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

const syncHandlers = {
  getState: () => store.getState(),
  createGoal: (a) => store.createGoal(a),
  updateGoal: (a) => store.updateGoal(a.id, a.patch),
  deleteGoal: (a) => store.deleteGoal(a.id),
  advanceStage: (a) => store.advanceStage(a.id, a.review),
  addTask: (a) => store.addTask(a.goalId, a.text),
  toggleTask: (a) => store.toggleTask(a.goalId, a.taskId),
  removeTask: (a) => store.removeTask(a.goalId, a.taskId),
  addInboxItem: (a) => store.addInboxItem(a),
  reviewInboxItem: (a) => store.reviewInboxItem(a.id, a.decision, a.opts),
  addChannel: (a) => store.addChannel(a),
  updateConnector: (a) => store.updateConnector(a.id, a.patch),
  setSettings: (a) => store.setSettings(a.patch),
  importFromFile: (a) => store.importFromFile(a.channelId, a.text, a.filename),
  moveGoal: (a) => store.moveGoal(a.id, a.toStage, a.review),
  openProjectDir: (a) => {
    const g = store.state.goals.find((x) => x.id === a.goalId);
    const dir = (g && g.projectDir) || path.join(projectsDir, a.goalId);
    if (process.platform === 'darwin') require('child_process').exec(`open "${dir}"`);
    return store.getState();
  },
};

async function handleAction(name, arg) {
  if (name === 'runCodex') return await store.runCodex(arg.goalId, arg.mode);
  if (name === 'vibeCode') {
    const g = store.state.goals.find((x) => x.id === arg.goalId);
    return await store.vibeCode(arg.goalId, {
      projectsDir,
      onLog: (m) => {
        if (g) {
          g.agentLog = g.agentLog || [];
          g.agentLog.push(m);
        }
      },
    });
  }
  if (name === 'vibeScaffold') return await store.vibeScaffold(arg.goalId, { projectsDir });
  if (name === 'importFromGithub') return await store.importFromGithub(arg.repo, arg.channelId);
  const fn = syncHandlers[name];
  if (!fn) throw new Error('未知操作: ' + name);
  return fn(arg || {});
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(distDir, urlPath);
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(distDir, 'index.html'), (e2, idx) => {
        if (e2) {
          res.writeHead(404);
          return res.end('not found - run `npm run build` first');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(idx);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/api/state' && req.method === 'GET') {
    return sendJson(res, 200, { state: store.getState() });
  }
  if (urlPath.startsWith('/api/') && req.method === 'POST') {
    const name = urlPath.slice('/api/'.length);
    try {
      const arg = await readBody(req);
      const r = await handleAction(name, arg);
      store.save();
      return sendJson(res, 200, { state: r });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (urlPath.startsWith('/api/')) {
    return sendJson(res, 405, { error: 'method not allowed' });
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[vibeflow web] API + static server running at http://localhost:${PORT}`);
  console.log(`[vibeflow web] data file: ${dataPath}`);
  // Auto-open browser on macOS.
  if (process.platform === 'darwin') {
    require('child_process').exec(`open http://localhost:${PORT}`);
  }
});
