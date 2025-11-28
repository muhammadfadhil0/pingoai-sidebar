const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeGlanceResponse: () => ipcRenderer.invoke('close-glance-response'),
  onAIResponse: (callback) => ipcRenderer.on('glance-ai-response', (event, data) => callback(data)),
  goBackToGlanceTools: () => ipcRenderer.invoke('glance-response-back'),
  resizeWindow: (height) => ipcRenderer.invoke('resize-glance-response', height),
  getSettings: async () => ipcRenderer.invoke('get-settings')
});
