const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeGlanceResponse: () => ipcRenderer.invoke('close-glance-response'),
  onAIResponse: (callback) => ipcRenderer.on('glance-ai-response', (event, data) => callback(data)),
  onConnectivitySlow: (callback) => ipcRenderer.on('connectivity-slow', () => callback()),
  onConnectivityCheckFailed: (callback) => ipcRenderer.on('connectivity-check-failed', () => callback()),
  goBackToGlanceTools: () => ipcRenderer.invoke('glance-response-back'),
  resizeWindow: (height) => ipcRenderer.invoke('resize-glance-response', height),
  getSettings: async () => ipcRenderer.invoke('get-settings'),
  retryAction: () => ipcRenderer.invoke('retry-glance-action')
});
