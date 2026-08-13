// API bridge. Works in two environments:
//  - Electron: uses the preload-exposed window.vibeAPI (ipcRenderer).
//  - Browser (npm run web): no Electron, so we call the local Node HTTP server
//    (server.cjs) over fetch, and poll for server-pushed updates (webhook).
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
  'moveGoal',
  'openProjectDir',
  'runCodex',
  'importFromGithub',
  'vibeCode',
  'vibeScaffold',
];

function makeHttpApi() {
  let listeners = [];
  let last = null;

  const notify = (state) => {
    last = state;
    listeners.forEach((cb) => {
      try {
        cb(state);
      } catch (e) {
        /* ignore */
      }
    });
  };

  const call = async (name, arg) => {
    const res = await fetch('/api/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arg || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败: ' + res.status);
    notify(data.state);
    return data.state;
  };

  const api = {
    getState: () => call('getState'),
  };
  for (const n of names.slice(1)) {
    api[n] = (arg) => call(n, arg);
  }

  // Poll for server-pushed changes (e.g. webhook ingestion) every 3s.
  setInterval(async () => {
    try {
      const res = await fetch('/api/getState', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) return;
      const data = await res.json();
      if (JSON.stringify(data.state) !== JSON.stringify(last)) notify(data.state);
    } catch (e) {
      /* server offline - ignore */
    }
  }, 3000);

  api.onChange = (cb) => {
    listeners.push(cb);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  };

  return api;
}

const bridge =
  typeof window !== 'undefined' && window.vibeAPI ? window.vibeAPI : makeHttpApi();

// Expose so the rest of the app and DevTools can use a single entry point.
if (typeof window !== 'undefined') window.vibeAPI = bridge;

export const getState = () => bridge.getState();
export const onChange = (cb) => bridge.onChange(cb);

export const createGoal = (a) => bridge.createGoal(a);
export const updateGoal = (a) => bridge.updateGoal(a);
export const deleteGoal = (a) => bridge.deleteGoal(a);
export const advanceStage = (a) => bridge.advanceStage(a);
export const addTask = (a) => bridge.addTask(a);
export const toggleTask = (a) => bridge.toggleTask(a);
export const removeTask = (a) => bridge.removeTask(a);
export const addInboxItem = (a) => bridge.addInboxItem(a);
export const reviewInboxItem = (a) => bridge.reviewInboxItem(a);
export const addChannel = (a) => bridge.addChannel(a);
export const updateConnector = (a) => bridge.updateConnector(a);
export const setSettings = (a) => bridge.setSettings(a);
export const importFromFile = (a) => bridge.importFromFile(a);
export const moveGoal = (a) => bridge.moveGoal(a);
export const openProjectDir = (a) => bridge.openProjectDir(a);
export const runCodex = (a) => bridge.runCodex(a);
export const importFromGithub = (a) => bridge.importFromGithub(a);
export const vibeCode = (a) => bridge.vibeCode(a);
export const vibeScaffold = (a) => bridge.vibeScaffold(a);
