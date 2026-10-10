import type { Job } from '@shared/types'
import type { Sample } from './format'

export type StepState = 'done' | 'active' | 'waiting'

export interface StepRow {
  label: string
  state: StepState
  /** e.g. "step 12 of 20" */
  detail?: string
}

// The engine's stages in order; "save" belongs to the last visible step.
const ORDER = ['preprocess', 'load_model', 'generate', 'print_prep', 'save']

const STEPS = [
  { stages: ['preprocess'], done: 'Background removed', active: 'Removing the background', waiting: 'Remove the background' },
  { stages: ['load_model'], done: 'Model loaded', active: 'Loading the model', waiting: 'Load the model' },
  { stages: ['generate'], done: '3D shape built', active: 'Building the 3D shape', waiting: 'Build the 3D shape' },
  { stages: ['print_prep', 'save'], done: 'Ready for print', active: 'Preparing for print', waiting: 'Prepare for print' }
]

/** The step list of the progress card (screen P1). */
export function stepRows(job: Job): StepRow[] {
  const finished = job.status === 'done'
  const queued = job.status === 'queued'
  const current = ORDER.indexOf(job.stage)

  return STEPS.map((step) => {
    const first = ORDER.indexOf(step.stages[0])
    const last = ORDER.indexOf(step.stages[step.stages.length - 1])
    if (finished || (!queued && current > last)) return { label: step.done, state: 'done' as const }
    if (!queued && current >= first) {
      let detail: string | undefined
      if (step.stages[0] === 'generate' && job.step) {
        // after the last AI step the model still builds the surface, which has no counter
        detail =
          job.step.done >= job.step.total ? 'making the surface' : `step ${job.step.done} of ${job.step.total}`
      }
      return { label: step.active, state: 'active' as const, detail }
    }
    return { label: step.waiting, state: 'waiting' as const }
  })
}

/** Progress of the long "generate" stage as a sample, or null outside of it. */
export function stepSample(job: Job, time: number): Sample | null {
  if (job.status !== 'running' || job.stage !== 'generate' || !job.step) return null
  if (job.step.total <= 0 || job.step.done <= 0) return null
  return { time, progress: job.step.done / job.step.total }
}

export function isActive(job: Job): boolean {
  return job.status === 'queued' || job.status === 'running'
}
