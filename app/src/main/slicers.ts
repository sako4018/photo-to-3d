import { join } from 'path'
import type { SlicerInfo } from '@shared/types'

interface SlicerDef {
  id: string
  name: string
  /** App names in /Applications (macOS). Bambu Studio is installed as "BambuStudio.app". */
  mac: string[]
  /** Paths below Program Files (Windows). */
  win: string[]
}

const SLICERS: SlicerDef[] = [
  {
    id: 'bambu',
    name: 'Bambu Studio',
    mac: ['BambuStudio.app', 'Bambu Studio.app'],
    win: ['Bambu Studio\\bambu-studio.exe']
  },
  { id: 'orca', name: 'OrcaSlicer', mac: ['OrcaSlicer.app'], win: ['OrcaSlicer\\orca-slicer.exe'] },
  {
    id: 'prusa',
    name: 'PrusaSlicer',
    mac: ['PrusaSlicer.app'],
    win: ['Prusa3D\\PrusaSlicer\\prusa-slicer.exe']
  },
  {
    id: 'cura',
    name: 'Cura',
    mac: ['UltiMaker Cura.app', 'Ultimaker Cura.app'],
    win: ['UltiMaker Cura\\UltiMaker-Cura.exe', 'Ultimaker Cura\\UltiMaker-Cura.exe']
  }
]

export interface FoundSlicer extends SlicerInfo {
  /** The .app folder (macOS) or the .exe (Windows). */
  path: string
}

/** Installed slicers, in the order above. `exists` is injected so this can be tested anywhere. */
export function findSlicers(
  exists: (path: string) => boolean,
  platform: NodeJS.Platform,
  homeDir: string,
  programFiles: string[] = ['C:\\Program Files', 'C:\\Program Files (x86)']
): FoundSlicer[] {
  const found: FoundSlicer[] = []
  for (const slicer of SLICERS) {
    const candidates =
      platform === 'darwin'
        ? slicer.mac.flatMap((app) => [join('/Applications', app), join(homeDir, 'Applications', app)])
        : platform === 'win32'
          ? programFiles.flatMap((base) => slicer.win.map((exe) => `${base}\\${exe}`))
          : []
    const path = candidates.find((candidate) => exists(candidate))
    if (path) found.push({ id: slicer.id, name: slicer.name, path })
  }
  return found
}

/** The slicer to use: the chosen one if it is installed, else the first installed one. */
export function pickSlicer(found: FoundSlicer[], chosen: string | null): FoundSlicer | null {
  return found.find((slicer) => slicer.id === chosen) ?? found[0] ?? null
}

/** Command that opens a file in a slicer. No shell is involved, so odd file names are safe. */
export function slicerCommand(
  slicer: FoundSlicer,
  file: string,
  platform: NodeJS.Platform
): { command: string; args: string[] } {
  return platform === 'darwin'
    ? { command: 'open', args: ['-a', slicer.path, file] }
    : { command: slicer.path, args: [file] }
}
