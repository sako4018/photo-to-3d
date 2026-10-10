import { join } from 'path'
import { app, BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null

function load(win: BrowserWindow, hash = ''): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.replace('#', '') })
  }
}

const webPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // The progress screen and the model download must keep up while the window is behind others.
  backgroundThrottling: false
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Mac: the traffic lights sit on the dark window. Windows keeps its own title bar buttons.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#161618',
    icon: join(app.getAppPath(), 'build', 'icon.png'), // Windows and Linux; the Mac icon is the Dock one
    webPreferences
  })
  win.once('ready-to-show', () => win.show())
  // A crashed page is logged and reloaded instead of leaving an empty window.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[window] the page process is gone: ${details.reason} (exit code ${details.exitCode})`)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })
  win.on('closed', () => {
    console.log('[window] main window closed')
    mainWindow = null
  })
  mainWindow = win
  load(win)
  return win
}

/** The small Settings window (screen S1). Only one at a time. */
export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 560,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Settings',
    backgroundColor: '#161618',
    webPreferences
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    settingsWindow = null
  })
  settingsWindow = win
  load(win, '#/settings')
}

/** The main window, for menu items that act on it. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}
