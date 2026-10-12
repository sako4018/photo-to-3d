import { describe, expect, it } from 'vitest'
import { applyActions, inverse, type ChatState } from './chat-actions'

const state: ChatState = { height_mm: 50, base_plate_mm: 0, base_cut_pct: 2, rotation: [0, 0, 0] }

describe('applyActions', () => {
  it('scales from the current height and sets a base plate', () => {
    const { changes } = applyActions(state, [
      { name: 'scale', input: { factor: 1.2 } },
      { name: 'base_plate', input: { thickness_mm: 3 } }
    ])
    expect(changes).toEqual({ height_mm: 60, base_plate_mm: 3 })
  })

  it('lets actions build on each other', () => {
    const { changes } = applyActions(state, [
      { name: 'set_height', input: { mm: 80 } },
      { name: 'scale', input: { factor: 0.5 } },
      { name: 'rotate', input: { axis: 'z', quarter_turns: 3 } },
      { name: 'rotate', input: { axis: 'z', quarter_turns: 2 } }
    ])
    expect(changes).toEqual({ height_mm: 40, rotation: [0, 0, 1] })
  })

  it('checks every value: clamps numbers and skips nonsense', () => {
    const { changes, notes } = applyActions(state, [
      { name: 'set_height', input: { mm: 99999 } },
      { name: 'flat_base_cut', input: { percent: -5 } },
      { name: 'base_plate', input: { thickness_mm: 'thick' } },
      { name: 'delete_everything', input: {} },
      { name: 'rotate', input: { axis: 'w', quarter_turns: 1 } }
    ])
    expect(changes).toEqual({ height_mm: 500, base_cut_pct: 0 })
    expect(notes.filter((note) => note.startsWith('Skipped'))).toHaveLength(3)
  })

  it('reports nothing to change when the values stay the same', () => {
    expect(applyActions(state, [{ name: 'set_height', input: { mm: 50 } }]).changes).toEqual({})
  })

  it('inverse brings the old values back', () => {
    const { changes } = applyActions(state, [{ name: 'rotate', input: { axis: 'x', quarter_turns: 1 } }])
    expect(inverse(state, changes)).toEqual({ rotation: [0, 0, 0] })
  })
})
