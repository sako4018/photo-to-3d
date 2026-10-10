import { readFile, stat } from 'fs/promises'
import { basename, dirname, extname } from 'path'
import {
  MAX_PHOTO_BYTES,
  PHOTO_EXTENSIONS,
  type EngineInfo,
  type UploadResult
} from '@shared/types'

type PhotoProblem = { error: string; hint: string }

/** Returns an error for files the engine would refuse, or null when the photo looks fine. */
export function checkPhoto(path: string, size: number): PhotoProblem | null {
  const extension = extname(path).slice(1).toLowerCase()
  if (!PHOTO_EXTENSIONS.includes(extension)) {
    return {
      error: `${basename(path)} is not a photo.`,
      hint: 'Use a JPG, PNG, HEIC or WebP file.'
    }
  }
  if (size === 0) {
    return { error: `${basename(path)} is empty.`, hint: 'Choose another photo.' }
  }
  if (size > MAX_PHOTO_BYTES) {
    return { error: `${basename(path)} is larger than 50 MB.`, hint: 'Choose a smaller photo.' }
  }
  return null
}

/** Project name from the file name: "/Users/me/IMG_2041.HEIC" -> "IMG_2041". */
export function projectName(path: string): string {
  return basename(path, extname(path))
}

/** Folder to open the next time the dialog is shown. */
export function folderOf(path: string): string {
  return dirname(path)
}

/** Creates a project and uploads the photo to it. Main process only: the token stays here. */
export async function uploadPhoto(info: EngineInfo, path: string): Promise<UploadResult> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return { ok: false, error: 'The file could not be read.', hint: 'Check that it still exists.' }
  }
  const problem = checkPhoto(path, size)
  if (problem) return { ok: false, ...problem }

  const base = `http://${info.host}:${info.port}`
  const headers = { 'X-Token': info.token }
  const name = projectName(path)
  try {
    const created = await fetch(`${base}/projects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!created.ok) return await engineError(created)
    const project = (await created.json()) as { id: string }

    const form = new FormData()
    form.append('photo', new Blob([await readFile(path)]), basename(path))
    const uploaded = await fetch(`${base}/projects/${project.id}/inputs`, {
      method: 'POST',
      headers,
      body: form
    })
    if (!uploaded.ok) return await engineError(uploaded)
    return { ok: true, projectId: project.id, name }
  } catch {
    return { ok: false, error: 'The engine did not answer.', hint: 'Restart the app.' }
  }
}

/** The engine answers errors as {"error": "...", "hint": "..."}. */
async function engineError(response: Response): Promise<UploadResult> {
  try {
    const body = (await response.json()) as { error?: string; hint?: string }
    return { ok: false, error: body.error ?? `Engine error ${response.status}`, hint: body.hint ?? '' }
  } catch {
    return { ok: false, error: `Engine error ${response.status}`, hint: '' }
  }
}
