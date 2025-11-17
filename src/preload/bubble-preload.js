const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showChatWindow: (options) => ipcRenderer.invoke('show-chat-window', options),
  sendMessage: (message, action) => ipcRenderer.invoke('send-ai-message', { message, action }),
  sendTextAction: (action, param) => ipcRenderer.invoke('send-text-action', { action, param }),
  hideBubble: () => ipcRenderer.invoke('hide-selection-bubble')
});
