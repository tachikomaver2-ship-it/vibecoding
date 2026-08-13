const { contextBridge, ipcRenderer } = require('electron');

const names = [
  'getState',
  'createGoal',
  'updateGoal',
  'deleteGoal',
  'advanceStage',
  'addTask',
  'toggleTask',
  'removeTask',
  'addInboxItem',
  'reviewInboxItem',
  'addChannel',
  'updateConnector',
  'setSettings',
  'importFromFile',
  'runCodex',
  'importFromGithub',
];

const api = {};
for (const n of names) {
  api[n] = (arg) => ipcRenderer.invoke('vibe:' + n, arg);
}

// Push updates from the main process (e.g. webhook ingestion) to the renderer.
api.onChange = (cb) => {
  const listener = (_e, state) => cb(state);
  ipcRenderer.on('vibe:state', listener);
  return () => ipcRenderer.removeListener('vibe:state', listener);
};

contextBridge.exposeInMainWorld('vibeAPI', api);
