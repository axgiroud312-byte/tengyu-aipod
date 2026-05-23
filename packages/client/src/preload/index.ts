import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: () => ipcRenderer.invoke('app:ping') as Promise<string>,
}

contextBridge.exposeInMainWorld('api', api)
