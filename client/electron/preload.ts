// Preload script para Electron
// Usar require explicitamente para compatibilidade total com o loader de preload do Electron
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  isElectron: true,
});
