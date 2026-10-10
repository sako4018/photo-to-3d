import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { uploadPhoto } from './photos'

// Runs only against a live engine:
//   PHOTO3D_ENGINE='{"host":"127.0.0.1","port":59782,"token":"dev"}' npm test
const raw = process.env.PHOTO3D_ENGINE

describe.skipIf(!raw)('uploadPhoto with a running engine', () => {
  it('creates a project and uploads the photo', async () => {
    const info = JSON.parse(raw as string)
    const result = await uploadPhoto(info, resolve(__dirname, '../../../samples/chair.png'))
    expect(result).toMatchObject({ ok: true, name: 'chair' })
  })

  it('passes the engine error through for a wrong token', async () => {
    const info = { ...JSON.parse(raw as string), token: 'wrong' }
    const result = await uploadPhoto(info, resolve(__dirname, '../../../samples/chair.png'))
    expect(result.ok).toBe(false)
  })
})
