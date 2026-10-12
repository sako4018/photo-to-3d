import { useEffect, useState } from 'react'
import type { Job, Project } from '@shared/types'
import { engineClient } from '../api/engine-client'
import { useEngineImage } from '../hooks/useEngineImage'
import { estimateRemaining, progressLine } from '../lib/format'
import { stepRows } from '../lib/job-steps'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import './Progress.css'


/** Progress while the 3D model is made (screen P1). */
export function Progress({ project, job }: { project: Project; job: Job }): React.JSX.Element {
  const samples = useStore((state) => state.jobSamples[project.id]) ?? []
  const started = useStore((state) => state.jobStarted[project.id])
  // a clock for "so far"
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  // The cut-out photo exists once the background is removed; try again when the stage changes.
  const cutout = useEngineImage(`/projects/${project.id}/files/input_rgba.png`, job.stage)
  const original = useEngineImage(project.image ? `/projects/${project.id}/files/original` : null)
  const photo = cutout ?? original

  const queued = job.status === 'queued'
  const left = estimateRemaining(samples)
  const percent = Math.round(job.progress * 100)

  return (
    <div className="progress">
      <div className="progress-card">
        <div className="progress-photo">{photo && <img src={photo} alt="" />}</div>
        <h1>{queued ? 'Waiting…' : 'Creating your 3D model'}</h1>
        <p className="progress-time">
          {queued
            ? 'Another model is being made. This one starts next.'
            : progressLine(left, started ? (now - started) / 1000 : 0, String(project.settings.quality ?? 'normal'))}
        </p>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <ul className="step-list">
          {stepRows(job).map((row) => (
            <li key={row.label} className={row.state}>
              <span className="mark">{row.state === 'done' ? <Icon name="check" size={14} /> : <span className="dot" />}</span>
              {row.label}
              {row.detail && <span className="step-detail"> · {row.detail}</span>}
            </li>
          ))}
        </ul>
        <button onClick={() => void engineClient.cancelJob(job.id)}>Cancel</button>
      </div>
    </div>
  )
}
