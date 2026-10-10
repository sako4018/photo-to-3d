import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import type { EngineInfo } from '@shared/types'
import { requestEngine } from './engine-ipc'
import { exportStl } from './export'
import { uploadPhoto } from './photos'

// Needs a running engine with the test engine as default:
//   uv run python -m photo3d_engine --engine dummy --token dev --data-dir /tmp/x
//   PHOTO3D_ENGINE='{"host":"127.0.0.1","port":PORT,"token":"dev"}' npm test
const raw = process.env.PHOTO3D_ENGINE

async function makeModel(info: EngineInfo): Promise<string> {
  const upload = await uploadPhoto(info, resolve(__dirname, '../../../samples/teapot.png'))
  if (!upload.ok) throw new Error(upload.error)
  const job = (await requestEngine(info, 'POST', '/jobs', { project_id: upload.projectId })).body as { id: string }
  for (let i = 0; i < 120; i++) {
    const state = (await requestEngine(info, 'GET', `/jobs/${job.id}`)).body as { status: string }
    if (state.status === 'done') return upload.projectId
    if (state.status === 'error') throw new Error('the job failed')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('the job did not finish')
}

describe.skipIf(!raw)('exportStl with a running engine', () => {
  it('saves the STL, also over an existing file, and says what is wrong for a missing folder', async () => {
    const info = JSON.parse(raw as string) as EngineInfo
    const projectId = await makeModel(info)
    const folder = mkdtempSync(join(tmpdir(), 'photo3d export-'))
    const target = join(folder, 'My teapot.stl') // a name with a space

    const first = await exportStl(info, projectId, target)
    expect(first).toEqual({ ok: true, path: target })
    expect(readFileSync(target).length).toBeGreaterThan(1000)

    writeFileSync(target, 'old')
    const again = await exportStl(info, projectId, target)
    expect(again.ok).toBe(true)
    expect(readFileSync(target).length).toBeGreaterThan(1000)

    const missing = await exportStl(info, projectId, join(folder, 'nope', 'x.stl'))
    expect(missing.ok).toBe(false)
  }, 90_000)
})
