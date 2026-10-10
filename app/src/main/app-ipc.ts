import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { IpcChannels, type AppInfo, type ConfirmOptions, type FileResult } from '@shared/types'
import { requestEngine, type EngineHandle } from './engine-ipc'
import { openSettingsWindow } from './windows'

const NOT_READY: FileResult = { ok: false, error: 'The engine is not running.', hint: 'Restart the app.' }

/** About info, native questions, opening the Settings window and folders for the Settings tabs. */
export function registerAppIpc(engine: EngineHandle): void {
  ipcMain.handle(IpcChannels.appInfo, (): AppInfo => ({ name: 'photo-to-3d', version: app.getVersion() }))
  ipcMain.handle(IpcChannels.appOpenSettings, () => openSettingsWindow())

  ipcMain.handle(IpcChannels.appConfirm, async (event, options: ConfirmOptions): Promise<boolean> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const box: Electron.MessageBoxOptions = {
      type: 'warning',
      message: options.message,
      detail: options.detail,
      buttons: [options.confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1
    }
    const answer = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    return answer.response === 0
  })

  ipcMain.handle(IpcChannels.filesShowModel, async (_event, engineId: string): Promise<FileResult> => {
    const info = engine.getStatus().info
    if (!info) return NOT_READY
    const rows = (await requestEngine(info, 'GET', '/engines')).body as { id: string; folder: string | null }[] | null
    const folder = rows?.find((row) => row.id === engineId)?.folder
    if (!folder) return { ok: false, error: 'The model is not downloaded.', hint: '' }
    shell.showItemInFolder(folder)
    return { ok: true, path: folder }
  })

  ipcMain.handle(IpcChannels.filesShowProjects, async (): Promise<FileResult> => {
    const info = engine.getStatus().info
    if (!info) return NOT_READY
    const dataDir = ((await requestEngine(info, 'GET', '/health')).body as { data_dir?: string } | null)?.data_dir
    if (!dataDir) return NOT_READY
    const folder = join(dataDir, 'projects')
    const failed = await shell.openPath(folder)
    return failed ? { ok: false, error: failed, hint: '' } : { ok: true, path: folder }
  })
}
