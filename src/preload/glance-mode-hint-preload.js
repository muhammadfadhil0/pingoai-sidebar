const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  closeGlanceHint: () => ipcRenderer.invoke('close-glance-hint'),
  saveGlanceHintPreference: (showHint) => ipcRenderer.invoke('save-glance-hint-preference', showHint),
  onApplyDarkMode: (callback) => ipcRenderer.on('apply-dark-mode', (event, isDark) => callback(isDark))
});
