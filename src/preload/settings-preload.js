const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  debugHighlightWatcher: () => ipcRenderer.invoke('debug-highlight-watcher'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  applySettings: (settings) => ipcRenderer.invoke('apply-settings', settings),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  sendMessage: (message, action) => ipcRenderer.invoke('send-ai-message', { message, action }),
  setWindowOpacity: (opacity) => ipcRenderer.invoke('set-window-opacity', opacity),
  previewPanelSize: (size, position) => ipcRenderer.invoke('preview-panel-size', { size, position }),
  restorePanelSize: () => ipcRenderer.invoke('restore-panel-size'),
  closeSettingsWindow: () => ipcRenderer.invoke('close-settings-window'),
  getFreeIntegrationDefaults: () => ipcRenderer.invoke('get-free-integration-defaults'),
  testAiConnection: (config) => ipcRenderer.invoke('test-ai-connection', config)
});
