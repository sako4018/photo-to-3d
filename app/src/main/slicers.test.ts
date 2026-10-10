import { describe, expect, it } from 'vitest'
import { findSlicers, pickSlicer, slicerCommand } from './slicers'

describe('findSlicers', () => {
  it('finds Bambu Studio installed without a space in the name', () => {
    const found = findSlicers((path) => path === '/Applications/BambuStudio.app', 'darwin', '/Users/me')
    expect(found).toEqual([{ id: 'bambu', name: 'Bambu Studio', path: '/Applications/BambuStudio.app' }])
  })

  it('also looks in the user Applications folder and keeps the list order', () => {
    const present = new Set(['/Users/me/Applications/PrusaSlicer.app', '/Applications/OrcaSlicer.app'])
    const found = findSlicers((path) => present.has(path), 'darwin', '/Users/me')
    expect(found.map((slicer) => slicer.id)).toEqual(['orca', 'prusa'])
  })

  it('finds slicers in Program Files on Windows', () => {
    const exe = 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe'
    const found = findSlicers((path) => path === exe, 'win32', 'C:\\Users\\me')
    expect(found).toEqual([{ id: 'bambu', name: 'Bambu Studio', path: exe }])
  })

  it('finds nothing when nothing is installed', () => {
    expect(findSlicers(() => false, 'darwin', '/Users/me')).toEqual([])
  })
})

describe('pickSlicer', () => {
  const found = [
    { id: 'bambu', name: 'Bambu Studio', path: '/a' },
    { id: 'orca', name: 'OrcaSlicer', path: '/b' }
  ]
  it('uses the chosen slicer, else the first one', () => {
    expect(pickSlicer(found, 'orca')?.id).toBe('orca')
    expect(pickSlicer(found, null)?.id).toBe('bambu')
    expect(pickSlicer(found, 'cura')?.id).toBe('bambu') // chosen one was uninstalled
    expect(pickSlicer([], 'orca')).toBeNull()
  })
})

describe('slicerCommand', () => {
  const slicer = { id: 'bambu', name: 'Bambu Studio', path: '/Applications/BambuStudio.app' }
  it('opens the file with "open -a" on a Mac, with a path that has spaces', () => {
    expect(slicerCommand(slicer, '/Users/me/personal projects/Стол 50mm.stl', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', '/Applications/BambuStudio.app', '/Users/me/personal projects/Стол 50mm.stl']
    })
  })
  it('starts the program with the file on Windows', () => {
    const win = { ...slicer, path: 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe' }
    expect(slicerCommand(win, 'C:\\a b\\m.stl', 'win32')).toEqual({ command: win.path, args: ['C:\\a b\\m.stl'] })
  })
})
