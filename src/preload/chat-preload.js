const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message, action, param) => ipcRenderer.invoke('send-ai-message', { message, action, param }),
  debugHighlightWatcher: () => ipcRenderer.invoke('debug-highlight-watcher'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  hideWindow: () => ipcRenderer.invoke('hide-chat-window'),
  closeWindow: () => ipcRenderer.invoke('close-chat-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-chat-window'),
  togglePin: () => ipcRenderer.invoke('toggle-pin-window'),
  isPinned: () => ipcRenderer.invoke('is-window-pinned'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  clearConversation: () => ipcRenderer.invoke('clear-conversation'),
  setDarkMode: (isDark) => ipcRenderer.invoke('set-dark-mode', isDark),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  toggleTransparent: () => ipcRenderer.invoke('toggle-transparent'),
  openUpdatePopup: () => ipcRenderer.invoke('open-update-popup'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  startUpdate: () => ipcRenderer.invoke('start-update'),
  onProcessSelectedText: (callback) => ipcRenderer.on('process-selected-text', (event, data) => callback(data)),
  onApplyDarkMode: (callback) => ipcRenderer.on('apply-dark-mode', (event, isDark) => callback(isDark)),
  onWindowSettingsUpdated: (callback) => ipcRenderer.on('window-settings-updated', (event, data) => callback(data)),
  onLanguageSettingsUpdated: (callback) => ipcRenderer.on('language-settings-updated', (event, data) => callback(data)),
  onServiceSettingsUpdated: (callback) => ipcRenderer.on('service-settings-updated', (event, data) => callback(data)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, releaseInfo) => callback(releaseInfo))
});
