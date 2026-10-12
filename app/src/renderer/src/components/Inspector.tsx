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
import { FixPanel } from './FixPanel'
import { Icon, type IconName } from './Icon'

const FILE_MANAGER = navigator.userAgent.includes('Windows') ? 'Explorer' : 'Finder'
import './Inspector.css'

const MARKS: Record<'ok' | 'warn' | 'bad', IconName> = { ok: 'check', warn: 'warn', bad: 'cross' }
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

/** A random start for the AI model, so "Recreate" gives a different model. */
function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The controls of the workspace, drawn over the 3D view (viewport-first layout):
 * Save and slicer buttons top right, Printability chips top left, the floating panel on the right.
 */
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

  /** Changes typed in "Fix a part": the height box has to show them too. */
  function applyTyped(changes: Edits): void {
    if (changes.height_mm !== undefined) setHeightText(String(changes.height_mm))
    change(changes)
  }

  /** A new seed, so the same photo gives a different model (not the same one again). */
  function recreate(): void {
    void createModel(project.id, { quality, height_mm: current.height, seed: newSeed() })
  }

  function turn(axis: number): void {
    const rotation = [...current.rotation]
    rotation[axis] = (rotation[axis] + 1) % 4
    change({ rotation })
  }

  return (
    <>
      <div className="topbar-actions">
        {slicer && (
          <button
            className="ghost"
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
        <button
          className="ghost icon-only"
          title={`Show in ${FILE_MANAGER}`}
          aria-label={`Show in ${FILE_MANAGER}`}
          onClick={() => void fileAction(() => window.api.files.showInFolder(project.id))}
        >
          <Icon name="folder" />
        </button>
        <button
          className="primary save"
          disabled={busy || !report}
          title="Choose where to save the STL file"
          onClick={() =>
            void fileAction(
              () => window.api.files.saveStl(project.id),
              (path) => `Saved: ${path}`
            )
          }
        >
          <Icon name="download" /> Save STL…
        </button>
      </div>

      {(problem || saved) && (
        <div className={`action-note${problem ? ' bad' : ''}`} role="status">
          {problem ?? saved}
        </div>
      )}

      <div className="print-chips">
        {report ? (
          printability(report, current.plate > 0).map((row) => (
            <div key={row.text} className={`chip ${row.level}`}>
              <span className="mark">
                <Icon name={MARKS[row.level]} size={14} />
              </span>
              <span className="chip-text">
                {row.text}
                {row.hint && <span className="chip-hint"> · {row.hint}</span>}
              </span>
              {row.action === 'add-base-plate' && (
                <button onClick={() => change({ base_plate_mm: DEFAULT_PLATE_MM })}>Add base plate</button>
              )}
            </div>
          ))
        ) : (
          <div className="chip">No report yet.</div>
        )}
      </div>

      <aside className="inspector">
        <FixPanel
          project={project}
          state={{
            height_mm: current.height,
            base_plate_mm: current.plate,
            base_cut_pct: current.cut,
            rotation: current.rotation
          }}
          busy={busy}
          onApply={applyTyped}
          onRecreate={recreate}
        />

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
                <Icon name="turn" size={14} /> {axis}
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

        <section className="recreate">
          <h2>New version from the photo</h2>
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
            onClick={recreate}
            title="Runs the AI again with a new start, so the model comes out different"
          >
            <Icon name="retry" size={14} /> Recreate · {QUALITIES.find((item) => item.id === quality)?.time}
          </button>
        </section>
      </aside>
    </>
  )
}
