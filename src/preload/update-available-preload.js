const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getReleaseInfo: () => ipcRenderer.invoke('get-release-info'),
  closeUpdatePopup: () => ipcRenderer.invoke('close-update-popup'),
  dismissUpdate: () => ipcRenderer.invoke('dismiss-update'),
  startUpdate: () => ipcRenderer.invoke('start-update'),
  onApplyDarkMode: (callback) => ipcRenderer.on('apply-dark-mode', (event, isDark) => callback(isDark)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, progress) => callback(progress)),
  onUpdateInfo: (callback) => ipcRenderer.on('update-info', (event, info) => callback(info))
});
