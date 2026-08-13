// Thin wrapper around the preload bridge exposed as window.vibeAPI.
const A = () => window.vibeAPI;

export const getState = () => A().getState();
export const onChange = (cb) => A().onChange(cb);

export const createGoal = (a) => A().createGoal(a);
export const updateGoal = (a) => A().updateGoal(a);
export const deleteGoal = (a) => A().deleteGoal(a);
export const advanceStage = (a) => A().advanceStage(a);
export const addTask = (a) => A().addTask(a);
export const toggleTask = (a) => A().toggleTask(a);
export const removeTask = (a) => A().removeTask(a);
export const addInboxItem = (a) => A().addInboxItem(a);
export const reviewInboxItem = (a) => A().reviewInboxItem(a);
export const addChannel = (a) => A().addChannel(a);
export const updateConnector = (a) => A().updateConnector(a);
export const setSettings = (a) => A().setSettings(a);
export const importFromFile = (a) => A().importFromFile(a);
export const runCodex = (a) => A().runCodex(a);
export const importFromGithub = (a) => A().importFromGithub(a);
