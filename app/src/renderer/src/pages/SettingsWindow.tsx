import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { engineClient, EngineError } from '../api/engine-client'
import { HEIGHT_RANGE, parseHeight } from '../lib/printability'
import { useStore } from '../store'
import './SettingsWindow.css'

const TABS = ['General', 'Model', 'Files', 'About'] as const
type Tab = (typeof TABS)[number]

const QUALITIES = [
  { id: 'fast', label: 'Fast' },
  { id: 'normal', label: 'Normal' },
  { id: 'detailed', label: 'Detailed' }
] as const

function General(): React.JSX.Element {
  const settings = useStore((state) => state.settings)
  const slicers = useStore((state) => state.slicers)
  const [heightText, setHeightText] = useState<string | null>(null)
  if (!settings) return <p>Loading…</p>

  const shownHeight = heightText ?? String(settings.defaultHeightMm)
  const heightValid = parseHeight(shownHeight) !== null

  return (
    <div className="pane">
      <label className="row">
        <span>Open models in</span>
        <select
          value={settings.slicer ?? ''}
          onChange={(event) => void window.api.settings.set({ slicer: event.target.value || null })}
        >
          <option value="">Automatic{slicers[0] ? ` (${slicers[0].name})` : ''}</option>
          {slicers.map((slicer) => (
            <option key={slicer.id} value={slicer.id}>
              {slicer.name}
            </option>
          ))}
        </select>
      </label>
      {slicers.length === 0 && <p className="note">No slicer found. Install Bambu Studio, OrcaSlicer, PrusaSlicer or Cura.</p>}

      <label className="row">
        <span>Default height</span>
        <span className="input-unit">
          <input
            type="text"
            inputMode="decimal"
            value={shownHeight}
            className={heightValid ? '' : 'invalid'}
            onChange={(event) => {
              setHeightText(event.target.value)
              const value = parseHeight(event.target.value)
              if (value !== null) void window.api.settings.set({ defaultHeightMm: value })
            }}
            onBlur={() => setHeightText(null)}
          />
          mm
        </span>
      </label>
      {!heightValid && (
        <p className="note bad">
          Use {HEIGHT_RANGE.min} to {HEIGHT_RANGE.max} mm.
        </p>
      )}

      <div className="row">
        <span>Default detail</span>
        <div className="segmented">
          {QUALITIES.map((item) => (
            <button
              key={item.id}
              className={settings.defaultQuality === item.id ? 'selected' : ''}
              onClick={() => void window.api.settings.set({ defaultQuality: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Model(): React.JSX.Element {
  const health = useStore((state) => state.health)
  const models = useStore((state) => state.models)
  const refreshModels = useStore((state) => state.refreshModels)
  const [problem, setProblem] = useState<string | null>(null)
  const model = models?.find((row) => row.id === health?.engine)
  if (!model) return <p>Loading…</p>

  async function run(action: () => Promise<unknown>): Promise<void> {
    setProblem(null)
    try {
      await action()
      await refreshModels()
    } catch (error) {
      setProblem(error instanceof EngineError ? `${error.message} ${error.hint}`.trim() : String(error))
    }
  }

  async function remove(): Promise<void> {
    if (!model) return
    const sure = await window.api.app.confirm({
      message: `Remove the ${model.name} model?`,
      detail: 'It is deleted from this computer (about ' + model.disk_gb.toFixed(1) + ' GB). The app downloads it again the next time you start it.',
      confirmLabel: 'Remove'
    })
    if (sure) await run(() => engineClient.removeModel(model.id))
  }

  return (
    <div className="pane">
      <div className="row">
        <span>Model</span>
        <strong>{model.name}</strong>
      </div>
      <div className="row">
        <span>Size on disk</span>
        <span>{model.installed ? `${model.disk_gb.toFixed(1)} GB` : 'Not downloaded'}</span>
      </div>
      <div className="row">
        <span>Location</span>
        <span className="path">{model.folder ?? '—'}</span>
      </div>
      <div className="buttons">
        {model.folder && <button onClick={() => void window.api.files.showModel(model.id)}>Show in Finder</button>}
        {model.own_copy && (
          <>
            <button
              onClick={() =>
                void run(async () => {
                  await engineClient.removeModel(model.id)
                  await engineClient.installStart(model.id)
                })
              }
            >
              Download again
            </button>
            <button onClick={() => void remove()}>Remove…</button>
          </>
        )}
      </div>
      {model.installed && !model.own_copy && model.folder && (
        <p className="note">
          This copy is kept by another tool (the Hugging Face cache), so the app never deletes it. Remove it there if you
          want the space back.
        </p>
      )}
      {problem && <p className="note bad">{problem}</p>}
    </div>
  )
}

function Files(): React.JSX.Element {
  const health = useStore((state) => state.health)
  return (
    <div className="pane">
      <div className="row">
        <span>Projects</span>
        <span className="path">{health ? `${health.data_dir}/projects` : '—'}</span>
      </div>
      <div className="buttons">
        <button onClick={() => void window.api.files.showProjects()}>Show in Finder</button>
      </div>
    </div>
  )
}

const THIRD_PARTY = [
  'TripoSG model weights (MIT)',
  'DINOv2 (Apache-2.0)',
  'rembg (MIT)',
  'three.js (MIT)',
  'React (MIT)',
  'Electron (MIT)'
]

function About(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])
  return (
    <div className="pane about">
      <h1>{info?.name ?? 'photo-to-3d'}</h1>
      <p>Version {info?.version ?? '…'} · MIT License</p>
      <p>Turn one photo into a print-ready 3D model. Everything runs on this computer.</p>
      <h2>Made with</h2>
      <ul>
        {THIRD_PARTY.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

/** The Settings window (screen S1): its own small window with tabs. */
export function SettingsWindow(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('General')
  return (
    <div className="settings">
      <nav className="tabs">
        {TABS.map((name) => (
          <button key={name} className={name === tab ? 'selected' : ''} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      {tab === 'General' && <General />}
      {tab === 'Model' && <Model />}
      {tab === 'Files' && <Files />}
      {tab === 'About' && <About />}
    </div>
  )
}
