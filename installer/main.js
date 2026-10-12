// Small installer: downloads the app, checks it, unpacks it, starts it.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const steps = require('./steps')

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
// where the app keeps its data (tests can point it to another folder)
const appData = () => process.env.P3D_APPDATA || app.getPath('appData')
const baseUrl = (process.env.P3D_BASE_URL || config.baseUrl).replace(/\/?$/, '/')
const isWin = process.platform === 'win32'
const platformKey = isWin ? 'win' : 'mac'
// Mac: ~/Applications/Photo to 3D.app · Windows: %LOCALAPPDATA%\Programs\Photo to 3D\
const installDir =
  process.env.P3D_INSTALL_DIR ||
  (isWin ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs') : path.join(os.homedir(), 'Applications'))
const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
const APP_NAME = isWin ? 'Photo to 3D' : 'Photo to 3D.app'
const resourcesOf = (target) => path.join(target, isWin ? 'resources' : path.join('Contents', 'Resources'))
const launcherOf = (target) => (isWin ? path.join(target, 'Photo to 3D.exe') : target)
// the app keeps its Python environment here (see engineEnvDir in app/src/main/launch.ts)
const engineEnv = () => path.join(appData(), 'photo-to-3d-app', 'engine-env')
// ... and the downloaded model here (the app starts its engine with --data-dir = userData/data)
const modelsDir = () => path.join(appData(), 'photo-to-3d-app', 'data', 'models')
// Settings for every uv call, the same as the app uses (see engineLaunch in app/src/main/launch.ts):
// uv's own Python (not one that happens to be on the computer), the engine copied into the environment
// instead of linked by a .pth file (Python 3.11 on Windows cannot read a Cyrillic path in it) and UTF-8.
const uvEnv = (extra = {}) => ({
  UV_PROJECT_ENVIRONMENT: engineEnv(),
  UV_PYTHON_PREFERENCE: 'only-managed',
  UV_NO_EDITABLE: '1',
  PYTHONUTF8: '1',
  NO_COLOR: '1',
  ...extra
})
// short Python check: the packages that need system libraries, and whether the graphics card is seen
const PROBE = 'import torch, trimesh, rembg, manifold3d, fast_simplification; print("cuda=" + str(torch.cuda.is_available()))'

let win = null
let aborter = null
let child = null
let running = false
let lastShot = ''

// Everything that happens is also written to a log file that can be sent when something breaks.
const logFile = path.join(appData(), 'photo-to-3d-app', 'installer.log')
function log(message) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`)
  } catch { /* a log that cannot be written must never stop the install */ }
}

function send(state) {
  if (state.phase !== 'downloading' && state.phase !== 'model') log(`[${state.phase}] ${state.text}${state.detail ? ' | ' + state.detail : ''}`)
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
    log(`run: ${command} ${args.join(' ')}`)
    const read = (chunk) => {
      err = (err + chunk).slice(-2000)
      const lines = String(chunk).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      for (const line of lines) if (steps.percentOf(line) === null) log(`  ${line}`)
      if (onLine && lines.length) onLine(lines[lines.length - 1])
    }
    proc.stdout.on('data', read)
    proc.stderr.on('data', read)
    proc.on('error', reject)
    proc.on('close', (code) => {
      log(`  exit code ${code}`)
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

/** Downloads `url` into `dest`, reports progress and returns the SHA-256 of what was written. */
async function downloadFile(url, dest, signal, { text, size }) {
  const response = await fetchOk(url, signal)
  const total = Number(response.headers.get('content-length')) || size || 0
  const hash = createHash('sha256')
  const out = fs.createWriteStream(dest)
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
        send({ phase: 'downloading', text, done, total, speed, eta: (total - done) / speed })
      }
    }
  } catch (error) {
    if (signal.aborted) throw new Cancelled()
    throw new Error('The download was interrupted. Check your connection and try again.')
  }
  await new Promise((resolve) => out.end(resolve))
  return hash.digest('hex')
}

/** Output of a short command, or '' when it is missing or fails. */
function outputOf(command, args, { cwd, env, exactEnv } = {}) {
  return new Promise((resolve) => {
    let text = ''
    try {
      const proc = spawn(command, args, { cwd, env: exactEnv || { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      proc.stderr.on('data', (chunk) => { text += chunk })
      proc.stdout.on('data', (chunk) => { text += chunk })
      proc.on('error', () => resolve(''))
      proc.on('close', () => resolve(text))
    } catch { resolve('') }
  })
}

/** Runs a Windows PowerShell 5.1 script (part of every Windows 10 and 11) and returns what it printed. */
function powershell(script) {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  // A PowerShell 7 that started us leaves its own module folders in PSModulePath, and 5.1 then
  // cannot load Get-AuthenticodeSignature or Start-Process. Without the variable it uses its own.
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key]
  return outputOf(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { exactEnv: env })
}
const quotePs = (text) => `'${text.replace(/'/g, "''")}'`

/** Windows only: look at the system, say what the graphics card is, and install what is missing. */
async function prepareWindows(work, signal) {
  const release = os.release()
  log(`system: Windows ${release}, ${process.arch}, ${Math.round(os.totalmem() / 1e9)} GB memory, user ${os.userInfo().username}`)
  if (steps.windowsMajor(release) < 10) {
    throw new Error('photo-to-3d needs Windows 10 or newer.')
  }

  send({ phase: 'system', text: 'Checking this computer…' })
  const gpus = steps.parseNvidiaSmi(
    await outputOf('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'])
  )
  const gpu = steps.describeGpu(gpus)
  log(`graphics card: ${gpu.text}`)

  // PyTorch needs the Visual C++ runtime (Microsoft's own installer, needs administrator rights once)
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  const missing = process.env.P3D_FORCE_VCREDIST ? steps.VC_RUNTIME_FILES : steps.missingVcRuntime(system32, fs.existsSync)
  if (missing.length) {
    log(`Visual C++ runtime is missing: ${missing.join(', ')}`)
    const installer = path.join(work, 'vc_redist.x64.exe')
    await downloadFile(VC_REDIST_URL, installer, signal, { text: 'Downloading the Microsoft Visual C++ runtime…', size: 0 })
    // never run a file that Microsoft did not sign
    const check = await powershell(
      `$s = Get-AuthenticodeSignature -LiteralPath ${quotePs(installer)}; 'STATUS=' + $s.Status; 'SUBJECT=' + $s.SignerCertificate.Subject`
    )
    log(`signature of vc_redist.x64.exe: ${check.trim().replace(/\s*\r?\n\s*/g, ' | ')}`)
    if (!check.includes('STATUS=')) {
      throw new Error(`Windows could not check the Microsoft Visual C++ runtime file. Send the log file: ${logFile}`)
    }
    if (!steps.signedByMicrosoft(check)) {
      throw new Error('The Microsoft Visual C++ runtime file is not signed by Microsoft. It was not started. Try again later.')
    }
    send({ phase: 'runtime', text: 'Installing the Microsoft Visual C++ runtime…', detail: 'Windows asks for permission once.' })
    const exit = await powershell(
      `try { $p = Start-Process -FilePath ${quotePs(installer)} -ArgumentList '/install','/quiet','/norestart' -Verb RunAs -Wait -PassThru; $p.ExitCode } catch { 'DENIED' }`
    )
    log(`vc_redist exit: ${exit.trim()}`)
    const code = Number(exit.trim().split(/\r?\n/).pop())
    if (exit.includes('DENIED') || Number.isNaN(code)) {
      throw new Error('The Microsoft Visual C++ runtime needs administrator permission. Press "Try again" and allow it.')
    }
    if (!steps.VC_OK_CODES.includes(code)) {
      throw new Error(`The Microsoft Visual C++ runtime did not install (code ${code}). You can install it from https://aka.ms/vs/17/release/vc_redist.x64.exe and press "Try again".`)
    }
  }
  return gpu
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
    // plus about 8 GB for the Python environment (PyTorch) and 8 GB for the AI model, both prepared after the install
    const need = manifest.size * 3 + 16e9
    if (freeBytes(installDir) < need) {
      throw new Error(`Not enough disk space: about ${Math.ceil(need / 1e9)} GB are needed.`)
    }

    let gpu = null
    if (isWin) gpu = await prepareWindows(work, signal)

    const zipPath = path.join(work, manifest.file)
    const sha256 = await downloadFile(baseUrl + manifest.file, zipPath, signal, { text: 'Downloading…', size: manifest.size })
    const total = manifest.size

    send({ phase: 'verifying', text: 'Checking the file…', done: total, total })
    if (sha256 !== manifest.sha256) {
      throw new Error('The downloaded file is damaged (checksum does not match). Try again.')
    }

    send({ phase: 'installing', text: 'Installing…', done: total, total })
    const unpacked = path.join(work, 'unpacked')
    fs.mkdirSync(unpacked)
    // Windows tar.exe cannot open a path with letters outside the system code page (a Cyrillic user
    // name on an English Windows), so it gets short relative names and runs inside the work folder
    if (isWin) {
      await run('tar', ['-xf', manifest.file, '-C', 'unpacked'], { cwd: work }).catch(async (error) => {
        if (error instanceof Cancelled) throw error
        log('tar failed, unpacking with PowerShell instead')
        fs.rmSync(unpacked, { recursive: true, force: true })
        const out = await powershell(`$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quotePs(zipPath)} -DestinationPath ${quotePs(unpacked)} -Force; 'UNPACKED'`)
        if (!out.includes('UNPACKED')) throw new Error(`The app could not be unpacked. Send the log file: ${logFile}\n${out.trim().slice(-300)}`)
      })
    } else await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked])
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
    // --reinstall-package: a new version of the app brings new engine code with the same version number
    await run(uv, ['sync', '--frozen', '--no-dev', '--no-editable', '--reinstall-package', 'photo3d-engine'], {
      cwd: path.join(resources, 'engine'),
      env: uvEnv({ UV_HTTP_TIMEOUT: '120' }),
      onLine: (line) => {
        const minutes = Math.floor((Date.now() - began) / 60000)
        send({ phase: 'engine', text: 'Preparing the engine (PyTorch, first time only)…', detail: `${minutes} min · ${line}`.slice(0, 90) })
      }
    }).catch((error) => {
      if (error instanceof Cancelled) throw error
      throw new Error(`The engine could not be prepared. Check your connection and try again.\n${error.message}`)
    })

    // Does the environment really start? (a missing system library shows up here, not at the first photo)
    send({ phase: 'engine', text: 'Checking the engine…', detail: '' })
    const probe = await outputOf(uv, ['run', '--frozen', '--no-dev', 'python', '-c', PROBE], {
      cwd: path.join(resources, 'engine'),
      env: uvEnv()
    })
    log(`engine check: ${probe.trim().split(/\r?\n/).slice(-15).join(' | ')}`)
    const cuda = /cuda=(True|False)/.exec(probe)
    if (!cuda) {
      throw new Error(`The engine was installed but does not start. Send the log file: ${logFile}`)
    }
    let note = ''
    if (isWin && gpu) {
      note = gpu.text
      if (cuda[1] === 'False' && gpu.ok) note += '\nPyTorch does not see the card yet. A restart of Windows may help.'
    }

    // The AI model (about 7.9 GB). If this fails the app is still installed and finishes the download
    // itself at the first start (the download continues where it stopped).
    if (process.env.P3D_SKIP_MODEL) {
      log('model download skipped (P3D_SKIP_MODEL)')
    } else {
      send({ phase: 'model', text: 'Downloading the AI model (about 7.9 GB, first time only)…', percent: 0 })
      await run(uv, ['run', '--frozen', '--no-dev', 'photo3d', 'install'], {
        cwd: path.join(resources, 'engine'),
        env: uvEnv({ PHOTO3D_MODELS_DIR: modelsDir() }),
        onLine: (line) => {
          const percent = steps.percentOf(line)
          if (percent !== null) send({ phase: 'model', text: 'Downloading the AI model (about 7.9 GB, first time only)…', percent })
        }
      }).catch((error) => {
        if (error instanceof Cancelled) throw error
        log(`model download failed: ${error.message}`)
        note += (note ? '\n' : '') + 'The AI model is not fully downloaded. photo-to-3d continues it at the first start.'
      })
    }

    if (isWin) {
      // Start menu and desktop shortcuts
      const link = (dir) => shell.writeShortcutLink(path.join(dir, 'Photo to 3D.lnk'), { target: launcherOf(target) })
      try { link(app.getPath('desktop')) } catch { /* shortcuts are optional */ }
      try {
        const menu = path.join(appData(), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        link(menu)
      } catch { /* shortcuts are optional */ }
    }

    send({ phase: 'done', text: 'Done. photo-to-3d is installed.', target: launcherOf(target), note })
  } catch (error) {
    if (error instanceof Cancelled) send({ phase: 'cancelled', text: 'Cancelled.' })
    else {
      log(`error: ${error.stack || error.message}`)
      send({ phase: 'error', text: error.message, detail: `Log file: ${logFile}` })
    }
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
    show: !process.env.P3D_SHOT, // tests that take pictures do not need the window on screen
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
// closing the window stops the download or the Python setup too (no hidden process keeps going)
app.on('before-quit', () => {
  if (aborter) aborter.abort()
  stopChild()
})
app.on('window-all-closed', () => app.quit())
