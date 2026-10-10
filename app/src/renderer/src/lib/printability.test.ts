import { describe, expect, it } from 'vitest'
import { parseHeight, printability, sizeLine, type Report } from './printability'

const report = (over: Partial<Report> = {}): Report => ({
  watertight: true,
  manifold: true,
  bodies: 1,
  size_mm: [23, 18, 80],
  volume_cm3: 20,
  filament_g_estimate: { infill_15: 8.6, infill_100: 20 },
  base_contact_mm2: 320,
  notes: [],
  ...over
})

describe('printability', () => {
  it('is all fine for a closed single part standing on a large area', () => {
    expect(printability(report(), false)).toEqual([
      { level: 'ok', text: 'Closed, one part' },
      { level: 'ok', text: 'Stands on 320 mm²' }
    ])
  })

  it('says what is wrong when the surface is open or in several parts', () => {
    expect(printability(report({ watertight: false }), false)[0]).toMatchObject({ level: 'bad', text: 'Not closed' })
    expect(printability(report({ bodies: 3 }), false)[0]).toMatchObject({ level: 'bad', text: '3 separate parts' })
  })

  it('offers a base plate when the contact is small, and a slicer tip when there already is one', () => {
    expect(printability(report({ base_contact_mm2: 6 }), false)[1]).toMatchObject({
      level: 'warn',
      text: 'Touches the bed with only 6 mm²',
      action: 'add-base-plate'
    })
    const withPlate = printability(report({ base_contact_mm2: 6 }), true)[1]
    expect(withPlate.action).toBeUndefined()
    expect(withPlate.hint).toContain('slicer')
  })

  it('treats a contact below 2% of the footprint as small', () => {
    // 23 x 18 = 414 mm2 footprint, 2% = 8.3, but the 25 mm2 minimum applies first
    expect(printability(report({ base_contact_mm2: 24 }), false)[1].level).toBe('warn')
    expect(printability(report({ base_contact_mm2: 26 }), false)[1].level).toBe('ok')
    // large footprint: 100 x 100 = 10000 mm2, 2% = 200
    expect(printability(report({ size_mm: [100, 100, 30], base_contact_mm2: 150 }), false)[1].level).toBe('warn')
  })
})

describe('sizeLine', () => {
  it('rounds the size and the weight', () => {
    expect(sizeLine(report())).toBe('23 × 18 × 80 mm · about 9 g PLA')
  })
})

describe('parseHeight', () => {
  it('accepts numbers from 5 to 500, also with a comma', () => {
    expect(parseHeight('80')).toBe(80)
    expect(parseHeight('12,5')).toBe(12.5)
  })

  it('refuses empty, text and values out of range', () => {
    for (const text of ['', ' ', 'abc', '4.9', '501', '-3']) expect(parseHeight(text)).toBeNull()
  })
})
