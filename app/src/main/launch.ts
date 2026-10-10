import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { app } from 'electron'
import { engineArgs } from './engine-args'
import type { EngineLaunch } from './engine-manager'

/** GUI apps do not get the shell PATH, so look in the usual places for uv too. */
function findUv(): string {
  if (process.env.PHOTO3D_UV) return process.env.PHOTO3D_UV
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
 * Development launch: "uv run" in engine/. The packaged app (embedded uv) is Phase 5.
 * PHOTO3D_ENGINE_ID=dummy starts the small test engine instead of TripoSG.
 */
export function engineLaunch(): EngineLaunch {
  const token = randomBytes(24).toString('base64url')
  return {
    command: findUv(),
    args: engineArgs(token, dataDir(), process.env.PHOTO3D_ENGINE_ID),
    cwd: resolve(app.getAppPath(), '..', 'engine')
  }
}
