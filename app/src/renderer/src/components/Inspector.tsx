import { useEffect, useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import { engineClient, EngineError, type PrintPrepOptions } from '../api/engine-client'
import { createBatcher } from '../lib/batcher'
import {
  HEIGHT_RANGE,
  parseHeight,
  printability,
  reportOf,
  sizeLine,
  type Report
} from '../lib/printability'
import { useStore } from '../store'

const FILE_MANAGER = navigator.userAgent.includes('Windows') ? 'Explorer' : 'Finder'
import './Inspector.css'

const MARKS = { ok: '✓', warn: '⚠', bad: '✕' } as const
const QUALITIES = [
  { id: 'fast', label: 'Fast', time: 'about 1.5 min' },
  { id: 'normal', label: 'Normal', time: 'about 2 min' },
  { id: 'detailed', label: 'Detailed', time: 'about 4 min' }
] as const
const DEFAULT_PLATE_MM = 2

type Edits = Pick<PrintPrepOptions, 'height_mm' | 'base_cut_pct' | 'base_plate_mm' | 'rotation'>

function number(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key]
  return typeof value === 'number' ? value : fallback
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Panel on the right of the workspace (inspector from the plan, 2.4). */
export function Inspector({ project }: { project: Project }): React.JSX.Element {
  const updateProject = useStore((state) => state.updateProject)
  const createModel = useStore((state) => state.createModel)
  const slicers = useStore((state) => state.slicers)
  const chosenSlicer = useStore((state) => state.settings?.slicer ?? null)
  const slicer = slicers.find((row) => row.id === chosenSlicer) ?? slicers[0]
  const settings = project.settings
  const report: Report | null = reportOf(project)

  // What the user changed and the engine has not confirmed yet.
  const [edits, setEdits] = useState<Edits>({})
  const [heightText, setHeightText] = useState(String(number(settings, 'height_mm', 50)))
  const [quality, setQuality] = useState(String(settings.quality ?? 'normal'))
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const batcher = useMemo(
    () =>
      createBatcher<Edits>(async (changes) => {
        try {
          updateProject(await engineClient.printPrep(project.id, changes))
          setProblem(null)
        } catch (error) {
          setProblem(error instanceof EngineError ? `${error.message} ${error.hint}`.trim() : String(error))
        } finally {
          // forget the edits that were sent, unless the user changed them again meanwhile
          setEdits((current) => {
            const rest: Edits = { ...current }
            for (const key of Object.keys(changes) as (keyof Edits)[]) {
              if (sameValue(rest[key], changes[key])) delete rest[key]
            }
            return rest
          })
        }
      }),
    [project.id, updateProject]
  )
  useEffect(() => () => batcher.cancel(), [batcher])

  function change(changes: Edits): void {
    setEdits((current) => ({ ...current, ...changes }))
    batcher.push(changes)
  }

  const current = {
    height: edits.height_mm ?? number(settings, 'height_mm', 50),
    plate: edits.base_plate_mm ?? number(settings, 'base_plate_mm', 0),
    cut: edits.base_cut_pct ?? number(settings, 'base_cut_pct', 2),
    rotation: edits.rotation ?? (Array.isArray(settings.rotation) ? (settings.rotation as number[]) : [0, 0, 0])
  }
  const busy = Object.keys(edits).length > 0
  const heightValid = parseHeight(heightText) !== null

  /** Runs a file action and shows what came out of it under the buttons. */
  async function fileAction(
    run: () => ReturnType<typeof window.api.files.saveStl>,
    done?: (path?: string) => string
  ): Promise<void> {
    setSaved(null)
    const result = await run()
    if (result.ok) {
      setProblem(null)
      if (done) setSaved(done(result.path))
    } else if (!result.canceled) {
      setProblem(`${result.error} ${result.hint}`.trim())
    }
  }

  // ⌘S (File > Save STL) does the same as the button.
  const canSave = !busy && report !== null
  useEffect(
    () =>
      window.api.app.onMenuAction((action) => {
        if (action === 'save-stl' && canSave) {
          void fileAction(() => window.api.files.saveStl(project.id), (path) => `Saved: ${path}`)
        }
      }),
    [canSave, project.id]
  )

  function turn(axis: number): void {
    const rotation = [...current.rotation]
    rotation[axis] = (rotation[axis] + 1) % 4
    change({ rotation })
  }

  return (
    <aside className="inspector">
      <section>
        <h2>Printability</h2>
        {report ? (
          printability(report, current.plate > 0).map((row) => (
            <div key={row.text} className={`print-row ${row.level}`}>
              <span className="mark">{MARKS[row.level]}</span>
              <div>
                <div>{row.text}</div>
                {row.hint && <div className="hint">{row.hint}</div>}
                {row.action === 'add-base-plate' && (
                  <button onClick={() => change({ base_plate_mm: DEFAULT_PLATE_MM })}>Add base plate</button>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="hint">No report yet.</p>
        )}
      </section>

      <section>
        <h2>Size {busy && <span className="spinner" title="Updating…" />}</h2>
        <label className="field">
          <span>Height</span>
          <span className="input-unit">
            <input
              type="text"
              inputMode="decimal"
              value={heightText}
              className={heightValid ? '' : 'invalid'}
              onChange={(event) => {
                setHeightText(event.target.value)
                const value = parseHeight(event.target.value)
                if (value !== null) change({ height_mm: value })
              }}
            />
            mm
          </span>
        </label>
        {!heightValid && (
          <div className="hint bad">
            Use {HEIGHT_RANGE.min} to {HEIGHT_RANGE.max} mm.
          </div>
        )}
        {report && <div className="hint">{sizeLine(report)}</div>}
      </section>

      <section>
        <h2>Placement</h2>
        <div className="turns">
          {['X', 'Y', 'Z'].map((axis, index) => (
            <button key={axis} onClick={() => turn(index)} title={`Turn 90° around ${axis}`}>
              Turn {axis}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Base plate</span>
          <input
            type="checkbox"
            checked={current.plate > 0}
            onChange={(event) => change({ base_plate_mm: event.target.checked ? DEFAULT_PLATE_MM : 0 })}
          />
        </label>
        {current.plate > 0 && (
          <label className="field">
            <span>Thickness</span>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={current.plate}
              onChange={(event) => change({ base_plate_mm: Number(event.target.value) })}
            />
            <span className="value">{current.plate} mm</span>
          </label>
        )}
        <label className="field">
          <span>Flat base cut</span>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={current.cut}
            onChange={(event) => change({ base_cut_pct: Number(event.target.value) })}
          />
          <span className="value">{current.cut}%</span>
        </label>
      </section>

      <section>
        <h2>Detail</h2>
        <div className="segmented">
          {QUALITIES.map((item) => (
            <button
              key={item.id}
              className={quality === item.id ? 'selected' : ''}
              onClick={() => setQuality(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void createModel(project.id, { quality, height_mm: current.height })}
          title="Make a new 3D model from the photo"
        >
          Recreate · {QUALITIES.find((item) => item.id === quality)?.time}
        </button>
      </section>

      <footer className="inspector-actions">
        {problem && <p className="hint bad">{problem}</p>}
        {saved && <p className="hint">{saved}</p>}
        <button
          className="primary"
          disabled={busy || !report}
          onClick={() =>
            void fileAction(
              () => window.api.files.saveStl(project.id),
              (path) => `Saved: ${path}`
            )
          }
        >
          Save STL
        </button>
        {slicer && (
          <button
            disabled={busy || !report}
            onClick={() =>
              void fileAction(
                () => window.api.files.openInSlicer(project.id, slicer.id),
                () => `Opened in ${slicer.name}.`
              )
            }
          >
            Open in {slicer.name}
          </button>
        )}
        <button className="link" onClick={() => void fileAction(() => window.api.files.showInFolder(project.id))}>
          Show in {FILE_MANAGER}
        </button>
      </footer>
    </aside>
  )
}
