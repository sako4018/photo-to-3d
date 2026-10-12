import { useEffect, useState } from 'react'
import type { HealthResponse } from '@shared/types'
import { engineClient, EngineError, type EngineInfoRow } from '../api/engine-client'
import { canDownload, checkComputer } from '../lib/computer-check'
import { estimateRemaining, formatDownloaded, formatRemaining } from '../lib/format'
import { useStore } from '../store'
import { Icon, type IconName } from '../components/Icon'
import './Setup.css'

const MARKS: Record<'ok' | 'warn' | 'bad', IconName> = { ok: 'check', warn: 'warn', bad: 'cross' }

/** First launch (screen O1): computer check and model download on one screen. */
export function Setup({ model, health }: { model: EngineInfoRow; health: HealthResponse }): React.JSX.Element {
  const install = useStore((state) => state.install)
  const refreshModels = useStore((state) => state.refreshModels)
  const [problem, setProblem] = useState<string | null>(null)
  const samples = useStore((state) => state.installSamples)

  const rows = checkComputer(health)
  const status = install?.engine === model.id ? install.status : 'idle'
  const progress = install?.engine === model.id ? install.progress : 0
  const left = status === 'running' ? estimateRemaining(samples) : null

  // Pick up a download that was already started or paused before the window opened.
  useEffect(() => {
    engineClient
      .installState(model.id)
      .then((state) => useStore.setState({ install: state }))
      .catch(() => undefined)
  }, [model.id])

  // When the download ends, load the model list again: the app opens by itself.
  useEffect(() => {
    if (status === 'done') void refreshModels()
  }, [status, refreshModels])

  async function run(action: () => Promise<unknown>): Promise<void> {
    setProblem(null)
    try {
      await action()
    } catch (error) {
      setProblem(error instanceof EngineError ? `${error.message} ${error.hint}` : String(error))
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>Welcome to photo-to-3d</h1>
        <p>Everything happens on this computer. Your photos never leave it.</p>

        <h2>Your computer</h2>
        <ul className="checks">
          {rows.map((row) => (
            <li key={row.label} className={row.level}>
              <span className="mark">
                <Icon name={MARKS[row.level]} size={16} />
              </span>
              <span className="check-label">{row.label}</span>
              <span className="check-value">{row.value}</span>
              {row.level !== 'ok' && <span className="check-note">{row.note}</span>}
            </li>
          ))}
        </ul>

        <h2>
          {model.name} model <span className="muted">· {model.download_gb.toFixed(1)} GB</span>
        </h2>

        {(status === 'idle' || status === 'error') && (
          <>
            {status === 'error' && (
              <p className="bad">
                Download stopped. {install?.error?.error} {install?.error?.hint}
              </p>
            )}
            <button
              className="primary"
              disabled={!canDownload(rows)}
              onClick={() => run(() => engineClient.installStart(model.id))}
            >
              {status === 'error' ? 'Retry' : 'Download the model'}
            </button>
          </>
        )}

        {(status === 'running' || status === 'paused' || status === 'done') && (
          <>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="bar-info">
              <span>{formatDownloaded(progress, model.download_gb)}</span>
              <span>
                {status === 'paused'
                  ? 'Paused'
                  : status === 'done'
                    ? 'Done'
                    : left === null
                      ? 'Estimating…'
                      : `${formatRemaining(left)} left`}
              </span>
            </div>
            {status === 'running' && (
              <button onClick={() => run(() => engineClient.installPause(model.id))}>Pause</button>
            )}
            {status === 'paused' && (
              <button className="primary" onClick={() => run(() => engineClient.installStart(model.id))}>
                Resume
              </button>
            )}
          </>
        )}

        {problem && <p className="bad">{problem}</p>}
      </div>
    </div>
  )
}
