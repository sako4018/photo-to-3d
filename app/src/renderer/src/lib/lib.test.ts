import { describe, expect, it } from 'vitest'
import type { HealthResponse } from '@shared/types'
import { canDownload, checkComputer } from './computer-check'
import { estimateRemaining, formatDownloaded, formatRemaining } from './format'

const health = (over: Partial<HealthResponse> = {}): HealthResponse => ({
  version: '0.1.0',
  devices: ['mps'],
  free_memory_gb: 8,
  total_memory_gb: 17.2,
  free_disk_gb: 341,
  gpu: { kind: 'apple', name: 'Apple M1 Pro' },
  engine: 'triposg',
  data_dir: '/x',
  ...over
})

describe('checkComputer', () => {
  it('is all green on a 16 GB Apple Silicon Mac with space', () => {
    const rows = checkComputer(health())
    expect(rows.map((row) => row.level)).toEqual(['ok', 'ok', 'ok'])
    expect(canDownload(rows)).toBe(true)
  })

  it('warns about little memory and no graphics chip, but still allows the download', () => {
    const rows = checkComputer(health({ total_memory_gb: 8, gpu: { kind: 'none', name: 'CPU' } }))
    expect(rows.map((row) => row.level)).toEqual(['warn', 'ok', 'warn'])
    expect(canDownload(rows)).toBe(true)
  })

  it('blocks the download when there is not enough disk space', () => {
    const rows = checkComputer(health({ free_disk_gb: 4.2 }))
    expect(rows[1].level).toBe('bad')
    expect(canDownload(rows)).toBe(false)
  })
})

describe('format', () => {
  it('formats the download size', () => {
    expect(formatDownloaded(0.4, 7.9)).toBe('3.2 of 7.9 GB')
  })

  it('formats the time left', () => {
    expect(formatRemaining(20)).toBe('less than a minute')
    expect(formatRemaining(240)).toBe('about 4 min')
    expect(formatRemaining(3900)).toBe('about 1 h 5 min')
  })

  it('estimates the time left from the speed so far', () => {
    // 10% in 10 s -> 90% more takes 90 s
    const samples = [
      { time: 0, progress: 0 },
      { time: 10_000, progress: 0.1 }
    ]
    expect(estimateRemaining(samples)).toBeCloseTo(90)
  })

  it('says nothing while there is too little data or no movement', () => {
    expect(estimateRemaining([{ time: 0, progress: 0 }])).toBeNull()
    expect(
      estimateRemaining([
        { time: 0, progress: 0 },
        { time: 2000, progress: 0.1 }
      ])
    ).toBeNull()
    expect(
      estimateRemaining([
        { time: 0, progress: 0.3 },
        { time: 20_000, progress: 0.3 }
      ])
    ).toBeNull()
  })
})
