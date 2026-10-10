import { describe, expect, it } from 'vitest'
import type { Job } from '@shared/types'
import { formatDay, progressLine } from './format'
import { stepRows, stepSample } from './job-steps'

const job = (over: Partial<Job>): Job => ({
  id: 'j',
  project_id: 'p',
  status: 'running',
  stage: 'preprocess',
  progress: 0,
  step: null,
  ...over
})

const states = (j: Job): string => stepRows(j).map((row) => row.state[0]).join('')

describe('stepRows', () => {
  it('waits for everything while queued', () => {
    expect(states(job({ status: 'queued', stage: 'queued' }))).toBe('wwww')
  })

  it('marks earlier steps done and the current one active', () => {
    expect(states(job({ stage: 'preprocess' }))).toBe('awww')
    expect(states(job({ stage: 'load_model' }))).toBe('daww')
    expect(states(job({ stage: 'generate' }))).toBe('ddaw')
    expect(states(job({ stage: 'print_prep' }))).toBe('ddda')
    expect(states(job({ stage: 'save' }))).toBe('ddda')
  })

  it('shows the model step count while building the shape', () => {
    const rows = stepRows(job({ stage: 'generate', step: { done: 12, total: 20 } }))
    expect(rows[2]).toMatchObject({ label: 'Building the 3D shape', detail: 'step 12 of 20' })
  })

  it('has everything done when the job is done', () => {
    expect(states(job({ status: 'done', stage: 'done' }))).toBe('dddd')
  })
})

describe('the surface step', () => {
  it('says the surface is being made after the last AI step', () => {
    const rows = stepRows(job({ stage: 'generate', step: { done: 20, total: 20 } }))
    expect(rows[2].detail).toBe('making the surface')
  })
})

describe('progressLine', () => {
  it('gives the time left when there is a reliable estimate', () => {
    expect(progressLine(240, 30, 'normal')).toBe('about 4 min left')
  })
  it('else gives the usual total and the time so far', () => {
    expect(progressLine(null, 72, 'normal')).toBe('Usually about 2 min · 1:12 so far')
    expect(progressLine(null, 5, 'detailed')).toBe('Usually about 4 min · 0:05 so far')
    expect(progressLine(null, 5, 'unknown')).toBe('Usually about 2 min · 0:05 so far')
  })
})

describe('stepSample', () => {
  it('only samples the generate stage once a step is done', () => {
    expect(stepSample(job({ stage: 'load_model' }), 1)).toBeNull()
    expect(stepSample(job({ stage: 'generate', step: { done: 0, total: 20 } }), 1)).toBeNull()
    expect(stepSample(job({ stage: 'generate', step: { done: 5, total: 20 } }), 7)).toEqual({
      time: 7,
      progress: 0.25
    })
  })
})

describe('formatDay', () => {
  const now = new Date(2026, 9, 11, 12, 0)
  it('says Today and Yesterday', () => {
    expect(formatDay('2026-10-11T00:21:05', now)).toBe('Today')
    expect(formatDay('2026-10-10T23:59:00', now)).toBe('Yesterday')
  })
  it('gives a short date for older projects', () => {
    expect(formatDay('2026-10-01T10:00:00', now)).toBe('1 Oct')
  })
})
