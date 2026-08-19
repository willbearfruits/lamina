const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lamina', {
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
  saveText: (name, text, existingPath) => ipcRenderer.invoke('save-text', name, text, existingPath || null),
  openFile: (filters) => ipcRenderer.invoke('open-file', filters),
  onCommand: (fn) => ipcRenderer.on('app:command', (e, cmd) => fn(cmd)),
});
