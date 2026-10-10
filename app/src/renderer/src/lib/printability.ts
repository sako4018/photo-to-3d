import type { Project } from '@shared/types'

/** The part of the engine's report.json that the panel shows. */
export interface Report {
  watertight: boolean
  manifold: boolean
  bodies: number
  size_mm: [number, number, number]
  volume_cm3: number
  filament_g_estimate: { infill_15: number; infill_100: number }
  base_contact_mm2: number
  notes: string[]
}

export type Level = 'ok' | 'warn' | 'bad'

export interface PrintRow {
  level: Level
  text: string
  /** What to do when it is not fine. */
  hint?: string
  /** A button next to the row. */
  action?: 'add-base-plate'
}

// Same limits as small_contact_note() in the engine (print_prep/pipeline.py).
const SMALL_CONTACT_MM2 = 25
const SMALL_CONTACT_SHARE = 0.02

export function reportOf(project: Project): Report | null {
  const report = project.report as Report | null
  return report && Array.isArray(report.size_mm) ? report : null
}

/** The "Printability" rows of the panel. */
export function printability(report: Report, hasBasePlate: boolean): PrintRow[] {
  const rows: PrintRow[] = []

  if (!report.watertight || !report.manifold) {
    rows.push({
      level: 'bad',
      text: 'Not closed',
      hint: 'The surface has holes. Try Recreate with Detailed, or another photo.'
    })
  } else if (report.bodies > 1) {
    rows.push({
      level: 'bad',
      text: `${report.bodies} separate parts`,
      hint: 'Parts that float apart cannot be printed. Try another photo.'
    })
  } else {
    rows.push({ level: 'ok', text: 'Closed, one part' })
  }

  const [width, depth] = report.size_mm
  const contact = report.base_contact_mm2
  const small = contact < SMALL_CONTACT_MM2 || contact < SMALL_CONTACT_SHARE * width * depth
  if (!small) {
    rows.push({ level: 'ok', text: `Stands on ${Math.round(contact)} mm²` })
  } else {
    rows.push({
      level: 'warn',
      text: `Touches the bed with only ${Math.round(contact)} mm²`,
      hint: hasBasePlate ? 'Use a brim or supports in your slicer.' : undefined,
      action: hasBasePlate ? undefined : 'add-base-plate'
    })
  }
  return rows
}

/** "23 × 18 × 80 mm · about 9 g PLA" */
export function sizeLine(report: Report): string {
  const [x, y, z] = report.size_mm.map((value) => Math.round(value))
  return `${x} × ${y} × ${z} mm · about ${Math.round(report.filament_g_estimate.infill_15)} g PLA`
}

export const HEIGHT_RANGE = { min: 5, max: 500 }

/** The typed height, or null when it is not a usable number (the engine takes 5 to 500 mm). */
export function parseHeight(text: string): number | null {
  const value = Number(text.replace(',', '.'))
  if (!text.trim() || !Number.isFinite(value)) return null
  if (value < HEIGHT_RANGE.min || value > HEIGHT_RANGE.max) return null
  return value
}
