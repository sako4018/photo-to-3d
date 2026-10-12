import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { app } from 'electron'
import { engineArgs } from './engine-args'
import type { EngineLaunch } from './engine-manager'

const UV_NAME = process.platform === 'win32' ? 'uv.exe' : 'uv'

/** The uv that the installer put next to the app (resources/bin), or null in development. */
function bundledUv(): string | null {
  const path = join(process.resourcesPath, 'bin', UV_NAME)
  return app.isPackaged && existsSync(path) ? path : null
}

/** Where the installed app keeps its Python environment (the installer prepares the same folder). */
export function engineEnvDir(): string {
  return join(app.getPath('userData'), 'engine-env')
}

/** GUI apps do not get the shell PATH, so look in the usual places for uv too. */
function findUv(): string {
  if (process.env.PHOTO3D_UV) return process.env.PHOTO3D_UV
  const bundled = bundledUv()
  if (bundled) return bundled
  if (process.platform === 'win32') return 'uv'
  const candidates = [
    join(homedir(), '.local', 'bin', 'uv'),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv'
  ]
  return candidates.find((path) => existsSync(path)) ?? 'uv'
}

/** Folder for projects and downloaded models. PHOTO3D_DATA_DIR overrides it (dev, tests). */
export function dataDir(): string {
  return process.env.PHOTO3D_DATA_DIR ?? join(app.getPath('userData'), 'data')
}

/**
 * "uv run" in engine/. The installed app uses its own uv, keeps the Python environment in the
 * user's data folder (the app folder may be replaced or read-only) and never changes uv.lock.
 * PHOTO3D_ENGINE_ID=dummy starts the small test engine instead of TripoSG.
 */
export function engineLaunch(): EngineLaunch {
  const token = randomBytes(24).toString('base64url')
  return {
    command: findUv(),
    args: engineArgs(token, dataDir(), process.env.PHOTO3D_ENGINE_ID),
    cwd: resolve(app.getAppPath(), '..', 'engine'),
    env: app.isPackaged
      ? // PYTHONUTF8: Python on Windows reads uv's .pth file (the engine path) in the system code
        // page otherwise, which breaks when the user name has Cyrillic letters
        { UV_PROJECT_ENVIRONMENT: engineEnvDir(), UV_FROZEN: '1', UV_NO_DEV: '1', PYTHONUTF8: '1' }
      : undefined
  }
}
