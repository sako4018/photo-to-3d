import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcChannels,
  type AppSettings,
  type EngineEvent,
  type EngineStatus,
  type MenuAction,
  type PreloadApi
} from '@shared/types'

const api: PreloadApi = {
  engine: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.engineGetStatus),
    file: (path) => ipcRenderer.invoke(IpcChannels.engineFile, path),
    restart: () => ipcRenderer.invoke(IpcChannels.engineRestart),
    request: (method, path, body) => ipcRenderer.invoke(IpcChannels.engineRequest, method, path, body),
    onEvent: (callback) => {
      const listener = (_event: unknown, payload: EngineEvent): void => callback(payload)
      ipcRenderer.on(IpcChannels.engineEvent, listener)
      return () => ipcRenderer.removeListener(IpcChannels.engineEvent, listener)
    },
    onStatusChanged: (callback) => {
      const listener = (_event: unknown, status: EngineStatus): void => callback(status)
      ipcRenderer.on(IpcChannels.engineStatusChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannels.engineStatusChanged, listener)
    }
  },
  files: {
    saveStl: (projectId) => ipcRenderer.invoke(IpcChannels.filesSaveStl, projectId),
    openInSlicer: (projectId, slicerId) => ipcRenderer.invoke(IpcChannels.filesOpenInSlicer, projectId, slicerId),
    showInFolder: (projectId) => ipcRenderer.invoke(IpcChannels.filesShowInFolder, projectId),
    slicers: () => ipcRenderer.invoke(IpcChannels.filesSlicers),
    showModel: (engineId) => ipcRenderer.invoke(IpcChannels.filesShowModel, engineId),
    showProjects: () => ipcRenderer.invoke(IpcChannels.filesShowProjects)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo),
    confirm: (options) => ipcRenderer.invoke(IpcChannels.appConfirm, options),
    openSettings: () => ipcRenderer.invoke(IpcChannels.appOpenSettings),
    onMenuAction: (callback) => {
      const listener = (_event: unknown, action: MenuAction): void => callback(action)
      ipcRenderer.on(IpcChannels.menuAction, listener)
      return () => ipcRenderer.removeListener(IpcChannels.menuAction, listener)
    }
  },
  projects: {
    showMenu: () => ipcRenderer.invoke(IpcChannels.projectMenu),
    confirmDelete: (name) => ipcRenderer.invoke(IpcChannels.projectConfirmDelete, name)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (changes) => ipcRenderer.invoke(IpcChannels.settingsSet, changes),
    onChanged: (callback) => {
      const listener = (_event: unknown, settings: AppSettings): void => callback(settings)
      ipcRenderer.on(IpcChannels.settingsChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannels.settingsChanged, listener)
    }
  },
  photo: {
    choose: () => ipcRenderer.invoke(IpcChannels.photoChoose),
    upload: (path) => ipcRenderer.invoke(IpcChannels.photoUpload, path),
    // File.path is gone in current Electron; webUtils is the supported way.
    pathForFile: (file) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)
