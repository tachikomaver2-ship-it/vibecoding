const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { Store } = require('./store');
const { buildSeed } = require('./seed');
const { startWebhook } = require('./webhook');

if (require('electron-squirrel-startup')) app.quit();

const dataPath = path.join(app.getPath('userData'), 'vibeflow-data.json');
const projectsDir = path.join(app.getPath('userData'), 'projects');
const store = new Store(dataPath);
const existing = store.load();
store.state = existing || buildSeed();
if (!existing) store.save();

// Attach the kbase LLM-Wiki backend. Default location: <userData>/kbase.
const { KBase } = require('./kbase');
const kbaseDir =
  (store.state.settings && store.state.settings.kbase && store.state.settings.kbase.dir) ||
  path.join(app.getPath('userData'), 'kbase');
const kbase = new KBase(kbaseDir);
store.kbase = kbase;
// Backfill existing inspirations into the knowledge base on first run.
if (kbase.count() === 0 && (store.state.inbox || []).length) {
  for (const it of store.state.inbox) {
    try {
      kbase.add({
        title: it.title,
        content: it.content,
        channel: (store.state.channels.find((c) => c.id === it.channelId) || {}).name || '',
        source: it.source,
        author: it.author,
      });
    } catch (e) {
      /* ignore */
    }
  }
}

let mainWindow = null;
let staticUrl = null; // http URL serving dist/ in production (avoids file:// module CORS)
const emit = () => {
  if (mainWindow) mainWindow.webContents.send('vibe:state', store.getState());
};

// Minimal static file server for the built dist/. Vite emits ES modules, which
// Chromium refuses to load over file:// (opaque-origin CORS), so in production
// we serve dist/ over http://127.0.0.1 and loadURL it instead of loadFile.
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const distDir = path.join(__dirname, '../dist');

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(distDir, urlPath);
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        return res.end('forbidden');
      }
      fs.readFile(filePath, (err, buf) => {
        if (err) {
          // SPA fallback to index.html
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
        res.writeHead(200, { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve('http://127.0.0.1:' + port);
    });
    server.on('error', reject);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'VibeFlow · Vibe Coding Board',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) {
    mainWindow.loadURL(dev);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (staticUrl) {
    // Production: load over http so ES modules load without CORS errors.
    mainWindow.loadURL(staticUrl);
  } else {
    // Fallback if the static server could not start.
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Synchronous domain handlers (each receives a single arg object).
const handlers = {
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
    try {
      shell.openPath(dir);
    } catch (e) {
      /* ignore */
    }
    return store.getState();
  },
  kbaseSearch: (a) => store.kbaseSearch(a.query, a.topK),
  kbaseList: () => store.kbaseList(),
  kbaseStats: () => store.kbaseStats(),
  kbaseOpen: () => {
    try {
      shell.openPath(kbase.root);
    } catch (e) {
      /* ignore */
    }
    return store.getState();
  },
};

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle('vibe:' + name, async (_e, arg) => {
    const r = fn(arg || {});
    store.save();
    emit();
    return r;
  });
}

// Async handlers.
ipcMain.handle('vibe:runCodex', async (_e, a) => {
  const r = await store.runCodex(a.goalId, a.mode);
  store.save();
  emit();
  return r;
});

ipcMain.handle('vibe:vibeCode', async (_e, a) => {
  const g = store.state.goals.find((x) => x.id === a.goalId);
  const r = await store.vibeCode(a.goalId, {
    projectsDir,
    onLog: () => {
      if (g) emit();
    },
  });
  store.save();
  emit();
  return r;
});

ipcMain.handle('vibe:vibeScaffold', async (_e, a) => {
  const r = await store.vibeScaffold(a.goalId, { projectsDir });
  store.save();
  emit();
  return r;
});

ipcMain.handle('vibe:importFromGithub', async (_e, a) => {
  const r = await store.importFromGithub(a.repo, a.channelId);
  store.save();
  emit();
  return r;
});

app.whenReady().then(async () => {
  console.log('[vibeflow] main process ready, dataPath =', dataPath);
  // Start the local static server for dist/ (production). If it fails we fall
  // back to loadFile in createWindow().
  try {
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      console.warn('[vibeflow] dist/index.html missing - run `npm run build` first');
    }
    staticUrl = await startStaticServer();
    console.log('[vibeflow] static server for dist/ at', staticUrl);
  } catch (e) {
    console.error('[vibeflow] static server failed, falling back to loadFile:', e.message);
    staticUrl = null;
  }
  createWindow();
  console.log('[vibeflow] main window created');
  if (store.state.settings && store.state.settings.webhookEnabled) {
    try {
      startWebhook(store, emit);
    } catch (e) {
      console.error('[webhook] failed to start', e.message);
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
