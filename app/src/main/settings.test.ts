import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsStore, sanitize } from './settings'

const folder = (): string => mkdtempSync(join(tmpdir(), 'photo3d-settings-'))

describe('sanitize', () => {
  it('keeps valid values and replaces bad ones with the defaults', () => {
    expect(sanitize({ slicer: 'orca', defaultHeightMm: 80, defaultQuality: 'fast' })).toEqual({
      slicer: 'orca',
      defaultHeightMm: 80,
      defaultQuality: 'fast'
    })
    expect(sanitize({ slicer: 5, defaultHeightMm: 9000, defaultQuality: 'ultra' })).toEqual(DEFAULT_SETTINGS)
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('SettingsStore', () => {
  it('starts with the defaults when there is no file or it is broken', () => {
    const dir = folder()
    expect(new SettingsStore(join(dir, 'none.json')).get()).toEqual(DEFAULT_SETTINGS)
    writeFileSync(join(dir, 'broken.json'), '{ nope')
    expect(new SettingsStore(join(dir, 'broken.json')).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('remembers a change after a restart', () => {
    const file = join(folder(), 'sub', 'settings.json')
    new SettingsStore(file).set({ slicer: 'bambu', defaultHeightMm: 120 })

    expect(JSON.parse(readFileSync(file, 'utf-8')).slicer).toBe('bambu')
    expect(new SettingsStore(file).get()).toMatchObject({ slicer: 'bambu', defaultHeightMm: 120 })
  })

  it('does not store an invalid value', () => {
    const store = new SettingsStore(join(folder(), 's.json'))
    expect(store.set({ defaultHeightMm: 1 }).defaultHeightMm).toBe(DEFAULT_SETTINGS.defaultHeightMm)
  })
})
