import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import type { EngineInfo, FileResult } from '@shared/types'
import { requestEngine } from './engine-ipc'

/**
 * Copies a project's STL to the place the user chose. The system dialog already asked about
 * replacing a file, and the engine never overwrites by itself, so an old file is removed first.
 */
export async function exportStl(
  info: EngineInfo,
  projectId: string,
  filePath: string
): Promise<FileResult> {
  if (existsSync(filePath)) await rm(filePath)
  const saved = await requestEngine(info, 'POST', `/projects/${encodeURIComponent(projectId)}/export`, {
    format: 'stl',
    dest_path: filePath
  })
  if (saved.status >= 400) {
    const body = (saved.body ?? {}) as { error?: string; hint?: string }
    return {
      ok: false,
      error: body.error ?? 'The STL could not be saved.',
      hint: body.hint ?? 'Try another folder.'
    }
  }
  return { ok: true, path: filePath }
}
