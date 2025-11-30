const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  closeStartupHint: () => ipcRenderer.invoke('close-startup-hint'),
  saveStartupHintPreference: (showHint) => ipcRenderer.invoke('save-startup-hint-preference', showHint),
  onApplyDarkMode: (callback) => ipcRenderer.on('apply-dark-mode', (event, isDark) => callback(isDark))
});
