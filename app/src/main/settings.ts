import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { AppSettings } from '@shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  slicer: null,
  defaultHeightMm: 50,
  defaultQuality: 'normal'
}

const QUALITIES = ['fast', 'normal', 'detailed']

/** Takes what was read from the file (anything) and returns valid settings. */
export function sanitize(raw: unknown): AppSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const height = input.defaultHeightMm
  return {
    slicer: typeof input.slicer === 'string' ? input.slicer : null,
    defaultHeightMm:
      typeof height === 'number' && height >= 5 && height <= 500 ? height : DEFAULT_SETTINGS.defaultHeightMm,
    defaultQuality: QUALITIES.includes(input.defaultQuality as string)
      ? (input.defaultQuality as AppSettings['defaultQuality'])
      : DEFAULT_SETTINGS.defaultQuality
  }
}

/** Settings kept in one small JSON file. A missing or broken file means the defaults. */
export class SettingsStore {
  private current: AppSettings

  constructor(private readonly file: string) {
    this.current = this.read()
  }

  get(): AppSettings {
    return this.current
  }

  set(changes: Partial<AppSettings>): AppSettings {
    this.current = sanitize({ ...this.current, ...changes })
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.current, null, 2))
    return this.current
  }

  private read(): AppSettings {
    try {
      return sanitize(JSON.parse(readFileSync(this.file, 'utf-8')))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }
}
