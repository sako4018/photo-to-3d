import { useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { engineClient, EngineError, type PartEdit, type PartOperation } from '../api/engine-client'
import { applyActions, inverse, type ChatChanges, type ChatState } from '../lib/chat-actions'
import { isBulgarian, parseCommand } from '../lib/commands'
import { replies } from '../lib/fix-replies'
import { useStore } from '../store'
import { Icon } from './Icon'
import './FixPanel.css'

interface Line {
  role: 'user' | 'app'
  text: string
  notes?: string[]
  bad?: boolean
}

/** What Undo takes back: a part fix (kept by the engine) or a change of the whole model. */
type Step = { kind: 'part' } | { kind: 'whole'; back: ChatChanges }

const PART_BUTTONS: { op: PartOperation; label: string }[] = [
  { op: 'smooth', label: 'Smooth' },
  { op: 'thicker', label: 'Thicker' },
  { op: 'thinner', label: 'Thinner' },
  { op: 'remove', label: 'Remove' }
]
const WORKING: Record<PartOperation, string> = {
  smooth: 'Smoothing…',
  thicker: 'Making it thicker…',
  thinner: 'Making it thinner…',
  remove: 'Removing…'
}

/**
 * "Fix a part": click a part of the model, then use the buttons or type what to change.
 * Everything runs on this computer: typed text is read by simple rules (lib/commands.ts),
 * part changes are done by the engine in a few seconds, without the AI model.
 */
export function FixPanel({
  project,
  state,
  busy,
  onApply,
  onRecreate
}: {
  project: Project
  state: ChatState
  busy: boolean
  onApply: (changes: ChatChanges) => void
  onRecreate: () => void
}): React.JSX.Element {
  const updateProject = useStore((store) => store.updateProject)
  const selected = useStore((store) => (store.selectedPart?.projectId === project.id ? store.selectedPart : null))
  const selectPart = useStore((store) => store.selectPart)
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const log = useRef<HTMLDivElement>(null)
  const partEdits = Array.isArray(project.settings.edits) ? project.settings.edits.length : 0
  const height = state.height_mm

  function say(line: Line): void {
    setLines((rows) => [...rows.slice(-30), line])
    requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight }))
  }

  /** Runs one engine call for a part fix; returns the error text, or null when it worked. */
  async function engineCall(run: () => Promise<Project>, label: string): Promise<string | null> {
    setWorking(label)
    try {
      updateProject(await run())
      return null
    } catch (error) {
      return error instanceof EngineError ? `${error.message} ${error.hint}`.trim() : String(error)
    } finally {
      setWorking(null)
    }
  }

  async function fixPart(op: PartOperation, extra: Pick<PartEdit, 'amount_mm' | 'strength'> = {}): Promise<string | null> {
    if (!selected) return 'no-part'
    const problem = await engineCall(
      () => engineClient.addEdit(project.id, { op, point: selected.stl, radius_mm: selected.radius, ...extra }),
      WORKING[op]
    )
    // the pick stays after Remove too: smoothing the cut right away is the usual next step
    if (!problem) setSteps((rows) => [...rows, { kind: 'part' }])
    return problem
  }

  async function undo(): Promise<string | null> {
    const last = steps.at(-1)
    if (last?.kind === 'whole') {
      onApply(last.back)
      setSteps((rows) => rows.slice(0, -1))
      return null
    }
    if (partEdits === 0) return 'nothing'
    const problem = await engineCall(() => engineClient.undoEdit(project.id), 'Undoing…')
    if (!problem) setSteps((rows) => rows.slice(0, -1))
    return problem
  }

  async function pressPart(op: PartOperation): Promise<void> {
    const problem = await fixPart(op)
    if (problem) say({ role: 'app', text: problem, bad: true })
  }

  async function pressUndo(): Promise<void> {
    const problem = await undo()
    if (problem === 'nothing') say({ role: 'app', text: replies(false).nothingToUndo })
    else if (problem) say({ role: 'app', text: problem, bad: true })
  }

  async function send(): Promise<void> {
    const message = text.trim()
    if (!message || working) return
    setText('')
    say({ role: 'user', text: message })
    const words = replies(isBulgarian(message))
    const parsed = parseCommand(message)
    const answers: string[] = []
    let notes: string[] = []
    let bad = false

    if (parsed.undo) {
      const problem = await undo()
      answers.push(problem === 'nothing' ? words.nothingToUndo : (problem ?? words.undone))
      bad = problem !== null && problem !== 'nothing'
    }
    if (parsed.actions.length > 0) {
      const applied = applyActions(state, parsed.actions)
      notes = applied.notes
      if (Object.keys(applied.changes).length > 0) {
        setSteps((rows) => [...rows, { kind: 'whole', back: inverse(state, applied.changes) }])
        onApply(applied.changes)
      }
      answers.push(words.done)
    }
    if (parsed.part) {
      const { op, amount_mm, strength } = parsed.part
      const problem = await fixPart(op, { amount_mm, strength })
      if (problem === 'no-part') answers.push(words.needPart)
      else if (problem) {
        answers.push(problem)
        bad = true
      } else answers.push(words.part[op])
    }
    for (const reason of parsed.cannot) answers.push(words.cannot[reason])
    if (parsed.retry) {
      answers.push(words.retry)
      onRecreate()
    }
    if (answers.length === 0) answers.push(words.unknown(parsed.unknown.join(', ') || message))
    // "Done." twice reads oddly when a whole-model change and a part fix came together
    const reply = [...new Set(answers)].filter((answer, _, all) => answer !== words.done || all.length === 1)
    say({ role: 'app', text: reply.join(' ') || words.done, notes, bad })
  }

  const disabled = busy || working !== null
  const maxRadius = Math.max(5, Math.round(height * 0.5))

  return (
    <section className="fix">
      <h2>
        Fix a part
        {working && (
          <span className="fix-working">
            <span className="spinner" /> {working}
          </span>
        )}
      </h2>

      {selected ? (
        <>
          <label className="field">
            <span>Area</span>
            <input
              type="range"
              min={1}
              max={maxRadius}
              step={0.5}
              value={Math.min(selected.radius, maxRadius)}
              onChange={(event) => selectPart({ ...selected, radius: Number(event.target.value) })}
            />
            <span className="value">{selected.radius} mm</span>
          </label>
          <div className="part-buttons">
            {PART_BUTTONS.map((button) => (
              <button key={button.op} disabled={disabled} onClick={() => void pressPart(button.op)}>
                {button.label}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => selectPart(null)}>
            Clear selection
          </button>
        </>
      ) : (
        <p className="hint">Click a part of the model to pick it. Then smooth it, make it thicker or thinner, or remove it.</p>
      )}

      {lines.length > 0 && (
        <div className="chat-log" ref={log}>
          {lines.map((line, index) => (
            <div key={index} className={`bubble ${line.role}${line.bad ? ' bad' : ''}`}>
              {line.text}
              {line.notes && line.notes.length > 0 && (
                <ul>
                  {line.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="chat-row">
        <input
          type="text"
          placeholder="Or type: smooth here, 8 cm, add a base…"
          aria-label="Tell what to fix"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void send()}
        />
        <button className="primary" aria-label="Send" disabled={disabled || text.trim() === ''} onClick={() => void send()}>
          <Icon name="send" size={14} />
        </button>
      </div>
      {(partEdits > 0 || steps.length > 0) && (
        <button className="link" disabled={disabled} onClick={() => void pressUndo()}>
          Undo the last fix
        </button>
      )}
    </section>
  )
}
