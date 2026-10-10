import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { IpcChannels, type MenuAction } from '@shared/types'
import { getMainWindow, openSettingsWindow } from './windows'

function send(action: MenuAction): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  win.webContents.send(IpcChannels.menuAction, action)
}

/** The application menu with the shortcuts: ⌘N new from photo, ⌘S save STL, ⌘, settings. */
export function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const settings: MenuItemConstructorOptions = {
    label: isMac ? 'Settings…' : 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: openSettingsWindow
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              settings,
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New from Photo…', accelerator: 'CmdOrCtrl+N', click: () => send('new-photo') },
        { label: 'Save STL…', accelerator: 'CmdOrCtrl+S', click: () => send('save-stl') },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' as const }] : [settings, { type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }])
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
