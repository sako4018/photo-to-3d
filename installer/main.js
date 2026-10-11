// Small installer: downloads the app, checks it, unpacks it, starts it.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
const baseUrl = (process.env.P3D_BASE_URL || config.baseUrl).replace(/\/?$/, '/')
const isWin = process.platform === 'win32'
const platformKey = isWin ? 'win' : 'mac'
// Mac: ~/Applications/Photo to 3D.app · Windows: %LOCALAPPDATA%\Programs\Photo to 3D\
const installDir =
  process.env.P3D_INSTALL_DIR ||
  (isWin ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs') : path.join(os.homedir(), 'Applications'))
const APP_NAME = isWin ? 'Photo to 3D' : 'Photo to 3D.app'
const resourcesOf = (target) => path.join(target, isWin ? 'resources' : path.join('Contents', 'Resources'))
const launcherOf = (target) => (isWin ? path.join(target, 'Photo to 3D.exe') : target)
// the app keeps its Python environment here (see engineEnvDir in app/src/main/launch.ts)
const engineEnv = () => path.join(app.getPath('appData'), 'photo-to-3d-app', 'engine-env')

let win = null
let aborter = null
let child = null
let running = false
let lastShot = ''

function send(state) {
  if (win && !win.isDestroyed()) win.webContents.send('state', state)
  // for tests: save a picture of the window (P3D_SHOT=/folder, one file per phase)
  if (process.env.P3D_SHOT && win && !win.isDestroyed() && state.phase !== lastShot) {
    lastShot = state.phase
    setTimeout(() => win.webContents.capturePage().then((image) => {
      fs.writeFileSync(path.join(process.env.P3D_SHOT, `${state.phase}.png`), image.toPNG())
    }), 700)
  }
}

class Cancelled extends Error {}

async function fetchOk(url, signal) {
  let response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (signal.aborted) throw new Cancelled()
    throw new Error(`Cannot reach the server (${new URL(url).host}). Check your connection and try again.`)
  }
  if (!response.ok) throw new Error(`The server answered ${response.status} for ${url}.`)
  return response
}

function freeBytes(dir) {
  return fs.statfsSync(dir).bavail * fs.statfsSync(dir).bsize
}

function run(command, args, { cwd, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    child = proc
    let err = ''
    const read = (chunk) => {
      err = (err + chunk).slice(-2000)
      if (onLine) {
        const lines = String(chunk).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        if (lines.length) onLine(lines[lines.length - 1])
      }
    }
    proc.stdout.on('data', read)
    proc.stderr.on('data', read)
    proc.on('error', reject)
    proc.on('close', (code) => {
      child = null
      if (aborter && aborter.signal.aborted) reject(new Cancelled())
      else if (code === 0) resolve()
      else reject(new Error(err.trim().split('\n').slice(-3).join('\n') || `${command} failed`))
    })
  })
}

function stopChild() {
  if (!child) return
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill('SIGTERM')
}

async function install() {
  aborter = new AbortController()
  const { signal } = aborter
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'photo3d-install-'))
  try {
    send({ phase: 'connecting', text: 'Connecting…' })
    const latest = await (await fetchOk(baseUrl + 'latest.json', signal)).json()
    const manifest = latest.files && latest.files[platformKey]
    if (!manifest) throw new Error(`There is no download for this system yet (${platformKey}).`)

    fs.mkdirSync(installDir, { recursive: true })
    // room for the zip and for the unpacked app (about twice its size)
    // plus about 8 GB for the Python environment (PyTorch) that is prepared after the install
    const need = manifest.size * 3 + 8e9
    if (freeBytes(installDir) < need) {
      throw new Error(`Not enough disk space: about ${Math.ceil(need / 1e9)} GB are needed.`)
    }

    const zipPath = path.join(work, manifest.file)
    const response = await fetchOk(baseUrl + manifest.file, signal)
    const total = Number(response.headers.get('content-length')) || manifest.size
    const hash = createHash('sha256')
    const out = fs.createWriteStream(zipPath)
    let done = 0
    const started = Date.now()
    let lastSend = 0
    try {
      for await (const chunk of response.body) {
        hash.update(chunk)
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
        done += chunk.length
        const now = Date.now()
        if (now - lastSend > 100) {
          lastSend = now
          const speed = done / Math.max((now - started) / 1000, 0.001)
          send({ phase: 'downloading', text: 'Downloading…', done, total, speed, eta: (total - done) / speed })
        }
      }
    } catch (error) {
      if (signal.aborted) throw new Cancelled()
      throw new Error('The download was interrupted. Check your connection and try again.')
    }
    await new Promise((resolve) => out.end(resolve))

    send({ phase: 'verifying', text: 'Checking the file…', done: total, total })
    if (hash.digest('hex') !== manifest.sha256) {
      throw new Error('The downloaded file is damaged (checksum does not match). Try again.')
    }

    send({ phase: 'installing', text: 'Installing…', done: total, total })
    const unpacked = path.join(work, 'unpacked')
    fs.mkdirSync(unpacked)
    if (isWin) await run('tar', ['-xf', zipPath, '-C', unpacked])
    else await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked])
    const target = path.join(installDir, APP_NAME)
    fs.rmSync(target, { recursive: true, force: true })
    if (isWin) fs.cpSync(path.join(unpacked, APP_NAME), target, { recursive: true })
    else await run('/usr/bin/ditto', [path.join(unpacked, APP_NAME), target])
    // files from a browser carry a quarantine mark; ours came from this installer
    if (!isWin) await run('/usr/bin/xattr', ['-cr', target]).catch(() => {})

    // The app needs Python and PyTorch (a few GB). Fetching them now shows progress here
    // instead of a long silent wait at the first start.
    send({ phase: 'engine', text: 'Preparing the engine (PyTorch, first time only)…', detail: 'This can take several minutes.' })
    const resources = resourcesOf(target)
    const uv = path.join(resources, 'bin', isWin ? 'uv.exe' : 'uv')
    const began = Date.now()
    await run(uv, ['sync', '--frozen', '--no-dev'], {
      cwd: path.join(resources, 'engine'),
      env: { UV_PROJECT_ENVIRONMENT: engineEnv(), UV_HTTP_TIMEOUT: '120', NO_COLOR: '1' },
      onLine: (line) => {
        const minutes = Math.floor((Date.now() - began) / 60000)
        send({ phase: 'engine', text: 'Preparing the engine (PyTorch, first time only)…', detail: `${minutes} min · ${line}`.slice(0, 90) })
      }
    }).catch((error) => {
      if (error instanceof Cancelled) throw error
      throw new Error(`The engine could not be prepared. Check your connection and try again.\n${error.message}`)
    })

    if (isWin) {
      // Start menu and desktop shortcuts
      const link = (dir) => shell.writeShortcutLink(path.join(dir, 'Photo to 3D.lnk'), { target: launcherOf(target) })
      try { link(app.getPath('desktop')) } catch { /* shortcuts are optional */ }
      try {
        const menu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        link(menu)
      } catch { /* shortcuts are optional */ }
    }

    send({ phase: 'done', text: 'Done. photo-to-3d is installed.', target: launcherOf(target) })
  } catch (error) {
    if (error instanceof Cancelled) send({ phase: 'cancelled', text: 'Cancelled.' })
    else send({ phase: 'error', text: error.message })
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
    aborter = null
    running = false
  }
}

function start() {
  if (running) return
  running = true
  install()
}
ipcMain.handle('start', start)
ipcMain.on('autostart', start)
ipcMain.handle('cancel', () => {
  if (aborter) aborter.abort()
  stopChild()
})
ipcMain.handle('open-app', async (_event, target) => {
  await shell.openPath(target)
  app.quit()
})
ipcMain.handle('quit', () => app.quit())

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 460,
    height: isWin ? 340 : 300,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'photo-to-3d installer',
    titleBarStyle: isWin ? 'default' : 'hiddenInset',
    autoHideMenuBar: true,
    backgroundColor: '#17171a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  // for tests: start without a click
  if (process.env.P3D_AUTOSTART) win.webContents.once('did-finish-load', () => ipcMain.emit('autostart'))
})
app.on('window-all-closed', () => app.quit())
