const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('installer', {
  start: () => ipcRenderer.invoke('start'),
  cancel: () => ipcRenderer.invoke('cancel'),
  openApp: (target) => ipcRenderer.invoke('open-app', target),
  quit: () => ipcRenderer.invoke('quit'),
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state))
})
