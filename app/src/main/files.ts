import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IpcChannels, type EngineInfo, type FileResult, type SlicerInfo } from '@shared/types'
import { requestEngine, type EngineHandle } from './engine-ipc'
import { exportStl } from './export'
import { SettingsStore } from './settings'
import { findSlicers, pickSlicer, slicerCommand } from './slicers'

const NOT_READY: FileResult = { ok: false, error: 'The engine is not running.', hint: 'Restart the app.' }

function problem(error: string, hint: string): FileResult {
  return { ok: false, error, hint }
}

function installedSlicers(): ReturnType<typeof findSlicers> {
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (path): path is string => Boolean(path)
  )
  return findSlicers(existsSync, process.platform, homedir(), programFiles.length ? programFiles : undefined)
}

/** The STL of a project: its name from the engine, its place from the engine's data folder. */
async function stlOf(
  info: EngineInfo,
  projectId: string
): Promise<{ name: string; path: string } | FileResult> {
  const [project, health] = await Promise.all([
    requestEngine(info, 'GET', `/projects/${encodeURIComponent(projectId)}`),
    requestEngine(info, 'GET', '/health')
  ])
  const name = (project.body as { outputs?: { stl?: string } } | null)?.outputs?.stl
  const dataDir = (health.body as { data_dir?: string } | null)?.data_dir
  if (project.status !== 200 || !name || !dataDir) {
    return problem('There is no STL yet.', 'Create the model first.')
  }
  return { name, path: join(dataDir, 'projects', projectId, name) }
}

function isFileResult(value: unknown): value is FileResult {
  return typeof value === 'object' && value !== null && 'ok' in value
}

/** Save STL, Open in slicer, Show in folder, and the settings the main process keeps. */
export function registerFileIpc(engine: EngineHandle): void {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))

  ipcMain.handle(IpcChannels.settingsGet, () => settings.get())
  ipcMain.handle(IpcChannels.settingsSet, (_event, changes) => {
    const updated = settings.set(changes)
    // every window (main and Settings) learns about it
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannels.settingsChanged, updated)
    return updated
  })
  ipcMain.handle(IpcChannels.filesSlicers, (): SlicerInfo[] =>
    installedSlicers().map(({ id, name }) => ({ id, name }))
  )

  ipcMain.handle(IpcChannels.filesSaveStl, async (event, projectId: string): Promise<FileResult> => {
    const info = engine.getStatus().info
    if (!info) return NOT_READY
    const stl = await stlOf(info, projectId)
    if (isFileResult(stl)) return stl

    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Save STL',
      defaultPath: join(settings.get().saveFolder ?? app.getPath('downloads'), stl.name),
      filters: [{ name: 'STL model', extensions: ['stl'] }]
    }
    const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (chosen.canceled || !chosen.filePath) {
      return { ok: false, canceled: true, error: '', hint: '' }
    }
    const saved = await exportStl(info, projectId, chosen.filePath)
    if (saved.ok) {
      // the next save opens in the folder the person chose this time
      settings.set({ saveFolder: dirname(chosen.filePath) })
      shell.showItemInFolder(chosen.filePath)
    }
    return saved
  })

  ipcMain.handle(
    IpcChannels.filesOpenInSlicer,
    async (_event, projectId: string, slicerId?: string): Promise<FileResult> => {
      const info = engine.getStatus().info
      if (!info) return NOT_READY
      const stl = await stlOf(info, projectId)
      if (isFileResult(stl)) return stl

      const slicer = pickSlicer(installedSlicers(), slicerId ?? settings.get().slicer)
      if (!slicer) {
        return problem('No slicer found.', 'Install Bambu Studio, OrcaSlicer, PrusaSlicer or Cura, or save the STL.')
      }
      const { command, args } = slicerCommand(slicer, stl.path, process.platform)
      return new Promise((resolve) => {
        execFile(command, args, (error) => {
          resolve(
            error
              ? problem(`${slicer.name} could not be opened.`, 'Save the STL and open it by hand.')
              : { ok: true, path: stl.path }
          )
        })
      })
    }
  )

  ipcMain.handle(IpcChannels.filesShowInFolder, async (_event, projectId: string): Promise<FileResult> => {
    const info = engine.getStatus().info
    if (!info) return NOT_READY
    const stl = await stlOf(info, projectId)
    if (isFileResult(stl)) return stl
    shell.showItemInFolder(stl.path)
    return { ok: true, path: stl.path }
  })
}
