import type { PrintPrepOptions } from '../api/engine-client'
import { HEIGHT_RANGE } from './printability'

/** The print settings that typed commands can change. */
export interface ChatState {
  height_mm: number
  base_plate_mm: number
  base_cut_pct: number
  /** Quarter turns around X, Y, Z */
  rotation: number[]
}

/** One command for the whole model, e.g. {name: 'rotate', input: {axis: 'z', quarter_turns: 1}}. */
export interface ChatAction {
  name: string
  input: Record<string, unknown>
}

export type ChatChanges = Pick<PrintPrepOptions, 'height_mm' | 'base_plate_mm' | 'base_cut_pct' | 'rotation'>

export interface Applied {
  /** What to send to the engine (only the fields that changed). */
  changes: ChatChanges
  /** One short line for each action that was done or skipped, for the chat. */
  notes: string[]
}

const AXES = ['x', 'y', 'z']
const round1 = (value: number): number => Math.round(value * 10) / 10
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * Turns commands into print-prep changes. Every number is checked and clamped,
 * unknown commands are skipped. Commands build on each other.
 */
export function applyActions(state: ChatState, actions: ChatAction[]): Applied {
  const now = { ...state, rotation: [...state.rotation] }
  const notes: string[] = []

  for (const { name, input } of actions) {
    if (name === 'set_height' && finite(input.mm)) {
      now.height_mm = round1(clamp(input.mm, HEIGHT_RANGE.min, HEIGHT_RANGE.max))
      notes.push(`Height ${now.height_mm} mm`)
    } else if (name === 'scale' && finite(input.factor) && input.factor > 0) {
      now.height_mm = round1(clamp(now.height_mm * input.factor, HEIGHT_RANGE.min, HEIGHT_RANGE.max))
      notes.push(`Height ${now.height_mm} mm`)
    } else if (name === 'rotate' && AXES.includes(String(input.axis)) && Number.isInteger(input.quarter_turns)) {
      const axis = AXES.indexOf(String(input.axis))
      const turns = (((input.quarter_turns as number) % 4) + 4) % 4
      now.rotation[axis] = (now.rotation[axis] + turns) % 4
      if (turns !== 0) notes.push(`Turned ${turns * 90}° around ${String(input.axis).toUpperCase()}`)
    } else if (name === 'reset_rotation') {
      now.rotation = [0, 0, 0]
      notes.push('Standing as it was made')
    } else if (name === 'base_plate' && finite(input.thickness_mm)) {
      now.base_plate_mm = Math.round(clamp(input.thickness_mm, 0, 10))
      notes.push(now.base_plate_mm > 0 ? `Base plate ${now.base_plate_mm} mm` : 'Base plate removed')
    } else if (name === 'flat_base_cut' && finite(input.percent)) {
      now.base_cut_pct = Math.round(clamp(input.percent, 0, 20))
      notes.push(`Flat base cut ${now.base_cut_pct}%`)
    } else {
      notes.push(`Skipped: ${name}`)
    }
  }

  const changes: ChatChanges = {}
  if (now.height_mm !== state.height_mm) changes.height_mm = now.height_mm
  if (now.base_plate_mm !== state.base_plate_mm) changes.base_plate_mm = now.base_plate_mm
  if (now.base_cut_pct !== state.base_cut_pct) changes.base_cut_pct = now.base_cut_pct
  if (now.rotation.some((turns, index) => turns !== state.rotation[index])) changes.rotation = now.rotation
  return { changes, notes }
}

/** The values to send to bring `state` back after `changes` were applied (for Undo). */
export function inverse(state: ChatState, changes: ChatChanges): ChatChanges {
  const back: ChatChanges = {}
  if (changes.height_mm !== undefined) back.height_mm = state.height_mm
  if (changes.base_plate_mm !== undefined) back.base_plate_mm = state.base_plate_mm
  if (changes.base_cut_pct !== undefined) back.base_cut_pct = state.base_cut_pct
  if (changes.rotation !== undefined) back.rotation = [...state.rotation]
  return back
}
