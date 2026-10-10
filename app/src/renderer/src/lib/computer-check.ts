import type { HealthResponse } from '@shared/types'

export type CheckLevel = 'ok' | 'warn' | 'bad'

export interface CheckRow {
  label: string
  value: string
  level: CheckLevel
  /** Shown under the row for warn and bad. */
  note?: string
}

/** Disk space needed: the 7.9 GB model plus room for projects (docs/phase-2-app.md, 2.1). */
export const NEEDED_DISK_GB = 9
export const WANTED_MEMORY_GB = 16

/** The "computer check" on the first-launch screen. */
export function checkComputer(health: HealthResponse): CheckRow[] {
  const memory: CheckRow = {
    label: 'Memory',
    value: `${Math.round(health.total_memory_gb)} GB`,
    level: health.total_memory_gb >= WANTED_MEMORY_GB - 1 ? 'ok' : 'warn',
    note: 'May be very slow or fail.'
  }
  const disk: CheckRow = {
    label: 'Disk space',
    value: `${Math.floor(health.free_disk_gb)} GB free`,
    level: health.free_disk_gb >= NEEDED_DISK_GB ? 'ok' : 'bad',
    note: `About ${NEEDED_DISK_GB} GB are needed. Free some space first.`
  }
  const kind = health.gpu.kind
  const graphics: CheckRow = {
    label: 'Graphics',
    value: kind === 'none' ? 'Processor only' : health.gpu.name,
    level: kind === 'none' ? 'warn' : 'ok',
    note: 'Without a graphics chip it will be slow.'
  }
  return [memory, disk, graphics]
}

/** Downloading is blocked only by a red row (not enough disk space). */
export function canDownload(rows: CheckRow[]): boolean {
  return rows.every((row) => row.level !== 'bad')
}
