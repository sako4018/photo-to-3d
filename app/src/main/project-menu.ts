import { BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { IpcChannels, type ProjectMenuChoice } from '@shared/types'

const FILE_MANAGER = process.platform === 'win32' ? 'Explorer' : 'Finder'

/** The right-click menu of the project list and the question before a project is deleted. */
export function registerProjectMenu(): void {
  ipcMain.handle(IpcChannels.projectMenu, (event): Promise<ProjectMenuChoice> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return new Promise((resolve) => {
      let choice: ProjectMenuChoice = null
      const pick = (value: ProjectMenuChoice) => () => {
        choice = value
      }
      Menu.buildFromTemplate([
        { label: 'Rename', click: pick('rename') },
        { label: `Show in ${FILE_MANAGER}`, click: pick('show') },
        { type: 'separator' },
        { label: 'Delete…', click: pick('delete') }
      ]).popup({ window: win, callback: () => resolve(choice) })
    })
  })

  ipcMain.handle(IpcChannels.projectConfirmDelete, async (event, name: string): Promise<boolean> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      message: `Delete “${name}”?`,
      detail: 'The photo and the 3D model of this project are deleted. This cannot be undone.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    }
    const answer = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return answer.response === 0
  })
}
