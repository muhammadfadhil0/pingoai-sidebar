const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  completeOnboarding: (config) => ipcRenderer.invoke('complete-onboarding', config),
  cancelOnboarding: () => ipcRenderer.send('cancel-onboarding'),
  minimizeWindow: () => ipcRenderer.send('minimize-window')
});
