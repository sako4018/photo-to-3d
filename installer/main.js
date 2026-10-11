// Small installer: downloads the app, checks it, unpacks it, starts it.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
const baseUrl = (process.env.P3D_BASE_URL || config.baseUrl).replace(/\/?$/, '/')
const installDir = process.env.P3D_INSTALL_DIR || path.join(os.homedir(), 'Applications')
const APP_NAME = 'Photo to 3D.app'

let win = null
let aborter = null
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${command} failed`))))
  })
}

async function install() {
  aborter = new AbortController()
  const { signal } = aborter
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'photo3d-install-'))
  try {
    send({ phase: 'connecting', text: 'Connecting…' })
    const manifest = await (await fetchOk(baseUrl + 'latest.json', signal)).json()

    fs.mkdirSync(installDir, { recursive: true })
    // room for the zip and for the unpacked app (about twice its size)
    const need = manifest.size * 3
    if (freeBytes(installDir) < need) {
      throw new Error(`Not enough disk space: about ${Math.ceil(need / 1e6)} MB are needed.`)
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
    await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked])
    const target = path.join(installDir, APP_NAME)
    fs.rmSync(target, { recursive: true, force: true })
    await run('/usr/bin/ditto', [path.join(unpacked, APP_NAME), target])
    // files from a browser carry a quarantine mark; ours came from this installer
    await run('/usr/bin/xattr', ['-cr', target]).catch(() => {})

    send({ phase: 'done', text: 'Done. photo-to-3d is installed.', target })
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
ipcMain.handle('cancel', () => aborter && aborter.abort())
ipcMain.handle('open-app', async (_event, target) => {
  await shell.openPath(target)
  app.quit()
})
ipcMain.handle('quit', () => app.quit())

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'photo-to-3d installer',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#17171a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  // for tests: start without a click
  if (process.env.P3D_AUTOSTART) win.webContents.once('did-finish-load', () => ipcMain.emit('autostart'))
})
app.on('window-all-closed', () => app.quit())
