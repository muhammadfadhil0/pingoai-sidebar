const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendTextAction: async (action, param) => {
    console.log('[Bubble] sendTextAction:', action, param);
    // Invoke dan tunggu hasilnya
    const result = await ipcRenderer.invoke('send-text-action', { action, param });
    console.log('[Bubble] sendTextAction result:', result);
    return result;
  },
  
  hideBubble: async (options) => {
    console.log('[Bubble] hideBubble called with options:', options);
    // Hide bubble dan close window
    const result = await ipcRenderer.invoke('hide-selection-bubble', options);
    return result;
  },
  
  showBubble: async (bounds) => {
    return ipcRenderer.invoke('show-selection-bubble', bounds);
  },
  
  getSettings: async () => {
    return ipcRenderer.invoke('get-settings');
  },
  
  onAutoOpenMenu: (callback) => {
    ipcRenderer.on('bubble-auto-open-menu', () => callback());
  },
  
  onDisableAutoHide: (callback) => {
    ipcRenderer.on('bubble-disable-auto-hide', () => callback());
  },
  
  onBubbleSettings: (callback) => {
    ipcRenderer.on('bubble-settings', (event, settings) => callback(settings));
  }
});