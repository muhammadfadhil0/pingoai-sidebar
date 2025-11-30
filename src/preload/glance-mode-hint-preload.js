const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  closeGlanceHint: () => ipcRenderer.invoke('close-glance-hint'),
  closeGlanceHintAndShowUpdate: () => ipcRenderer.invoke('close-glance-hint-and-show-update'),
  saveGlanceHintPreference: (showHint) => ipcRenderer.invoke('save-glance-hint-preference', showHint),
  openUpdatePopup: () => ipcRenderer.invoke('open-update-popup'),
  onApplyDarkMode: (callback) => ipcRenderer.on('apply-dark-mode', (event, isDark) => callback(isDark))
});
