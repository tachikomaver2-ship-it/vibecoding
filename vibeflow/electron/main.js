const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { buildSeed } = require('./seed');
const { startWebhook } = require('./webhook');

if (require('electron-squirrel-startup')) app.quit();

const dataPath = path.join(app.getPath('userData'), 'vibeflow-data.json');
const store = new Store(dataPath);
const existing = store.load();
store.state = existing || buildSeed();
if (!existing) store.save();

let mainWindow = null;
const emit = () => {
  if (mainWindow) mainWindow.webContents.send('vibe:state', store.getState());
};

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
  } else {
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

ipcMain.handle('vibe:importFromGithub', async (_e, a) => {
  const r = await store.importFromGithub(a.repo, a.channelId);
  store.save();
  emit();
  return r;
});

app.whenReady().then(() => {
  console.log('[vibeflow] main process ready, dataPath =', dataPath);
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
