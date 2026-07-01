const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe bridge: the renderer can only forward input events to the
// main process, nothing else.
contextBridge.exposeInMainWorld('wombat', {
  sendInput: (event) => ipcRenderer.send('input', event),
});
