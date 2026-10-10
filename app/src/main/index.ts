import { join } from 'path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IpcChannels, PHOTO_EXTENSIONS, type EngineStatus } from '@shared/types'
import { EngineManager } from './engine-manager'
import { registerAppIpc } from './app-ipc'
import { registerEngineIpc, type EngineHandle } from './engine-ipc'
import { registerFileIpc } from './files'
import { engineLaunch } from './launch'
import { registerProjectMenu } from './project-menu'
import { buildMenu } from './menu'
import { folderOf, uploadPhoto } from './photos'
import { createMainWindow } from './windows'

// Development shortcut: attach to an engine that is already running instead of starting one:
//   PHOTO3D_ENGINE='{"host":"127.0.0.1","port":59782,"token":"dev"}' npm run dev
function attachedEngine(raw: string): EngineHandle {
  let status: EngineStatus
  try {
    status = { state: 'ready', info: JSON.parse(raw) }
  } catch {
    status = { state: 'error', error: 'PHOTO3D_ENGINE is not valid JSON' }
  }
  return {
    getStatus: () => status,
    onStatus: () => () => undefined,
    restart: async () => undefined
  }
}

const manager = process.env.PHOTO3D_ENGINE ? null : new EngineManager({ launch: engineLaunch() })
const engine: EngineHandle = manager ?? attachedEngine(process.env.PHOTO3D_ENGINE as string)

// Folder of the last chosen photo; the dialog opens there next time.
let lastPhotoFolder = app.getPath('pictures')

async function choosePhoto(event: Electron.IpcMainInvokeEvent): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a photo',
    defaultPath: lastPhotoFolder,
    properties: ['openFile'],
    filters: [{ name: 'Photos', extensions: PHOTO_EXTENSIONS }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  lastPhotoFolder = folderOf(result.filePaths[0])
  return result.filePaths[0]
}

app.setName('photo-to-3d')

app.whenReady().then(() => {
  // The packaged app gets its icon from the build; during development set it by hand.
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'build', 'icon.png'))
  app.setAboutPanelOptions({
    applicationName: 'photo-to-3d',
    applicationVersion: app.getVersion(),
    copyright: 'MIT License. Everything runs on this computer.'
  })
  registerEngineIpc(engine)
  registerFileIpc(engine)
  registerProjectMenu()
  registerAppIpc(engine)
  buildMenu()
  ipcMain.handle(IpcChannels.photoChoose, choosePhoto)
  ipcMain.handle(IpcChannels.photoUpload, (_event, path: string) => {
    const status = engine.getStatus()
    if (!status.info) {
      return { ok: false, error: 'The engine is not running.', hint: 'Restart the app.' }
    }
    return uploadPhoto(status.info, path)
  })
  createMainWindow()
  void manager?.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Ctrl+C, "kill" and closing the terminal quit the app the normal way, which stops the engine.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => app.quit())
}

// Stop the Python engine before quitting, so no process is left behind.
let stopped = false
app.on('before-quit', (event) => {
  if (stopped || !manager) return
  event.preventDefault()
  void manager.stop().finally(() => {
    stopped = true
    app.quit()
  })
})
