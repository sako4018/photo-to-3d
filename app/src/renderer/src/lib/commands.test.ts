import { describe, expect, it } from 'vitest'
import { parseCommand } from './commands'

const actions = (text: string): unknown => parseCommand(text).actions

describe('parseCommand: the whole model', () => {
  it('reads heights in cm and mm, and number words', () => {
    expect(actions('направи я 8 см')).toEqual([{ name: 'set_height', input: { mm: 80 } }])
    expect(actions('make it 65 mm')).toEqual([{ name: 'set_height', input: { mm: 65 } }])
    expect(actions('направи я осем сантиметра')).toEqual([{ name: 'set_height', input: { mm: 80 } }])
    expect(actions('7,5 см')).toEqual([{ name: 'set_height', input: { mm: 75 } }])
  })

  it('reads bigger and smaller, with and without a percent', () => {
    expect(actions('с 20% по-висока')).toEqual([{ name: 'scale', input: { factor: 1.2 } }])
    expect(actions('make it 30 percent smaller')).toEqual([{ name: 'scale', input: { factor: 0.7 } }])
    expect(actions('по-голяма')).toEqual([{ name: 'scale', input: { factor: 1.2 } }])
    expect(actions('двойно по-голяма')).toEqual([{ name: 'scale', input: { factor: 2 } }])
    expect(actions('наполовина')).toEqual([{ name: 'scale', input: { factor: 0.5 } }])
  })

  it('reads turning', () => {
    expect(actions('завърти я наобратно')).toEqual([{ name: 'rotate', input: { axis: 'x', quarter_turns: 2 } }])
    expect(actions('обърни я наляво')).toEqual([{ name: 'rotate', input: { axis: 'z', quarter_turns: 1 } }])
    expect(actions('turn it 180 degrees around y')).toEqual([
      { name: 'rotate', input: { axis: 'y', quarter_turns: 2 } }
    ])
    expect(actions('завърти я на 90 градуса по х')).toEqual([{ name: 'rotate', input: { axis: 'x', quarter_turns: 1 } }])
    expect(actions('нека легне')).toEqual([{ name: 'rotate', input: { axis: 'x', quarter_turns: 1 } }])
  })

  it('reads the base plate and the flat cut', () => {
    expect(actions('сложи основа')).toEqual([{ name: 'base_plate', input: { thickness_mm: 3 } }])
    expect(actions('основа 5 мм')).toEqual([{ name: 'base_plate', input: { thickness_mm: 5 } }])
    expect(actions('махни основата')).toEqual([{ name: 'base_plate', input: { thickness_mm: 0 } }])
    expect(actions('отрежи дъното с 10%')).toEqual([{ name: 'flat_base_cut', input: { percent: 10 } }])
  })

  it('reads several commands in one sentence', () => {
    expect(actions('направи я с 20% по-висока и сложи основа, после я завърти надясно')).toEqual([
      { name: 'scale', input: { factor: 1.2 } },
      { name: 'base_plate', input: { thickness_mm: 3 } },
      { name: 'rotate', input: { axis: 'z', quarter_turns: 3 } }
    ])
  })
})

describe('parseCommand: one part of the model', () => {
  it('reads smoothing, thicker, thinner and removing', () => {
    expect(parseCommand('тук е грапаво, изглади го').part).toEqual({ op: 'smooth', strength: undefined })
    expect(parseCommand('изглади го много').part).toEqual({ op: 'smooth', strength: 3 })
    expect(parseCommand('направи го по-дебело с 2 мм').part).toEqual({ op: 'thicker', amount_mm: 2 })
    expect(parseCommand('make this thinner').part).toEqual({ op: 'thinner', amount_mm: undefined })
    expect(parseCommand('махни това парче').part).toEqual({ op: 'remove' })
  })

  it('does not take "remove the base" for removing a part', () => {
    const parsed = parseCommand('махни основата')
    expect(parsed.part).toBeNull()
    expect(parsed.actions).toHaveLength(1)
  })
})

describe('parseCommand: other wishes', () => {
  it('reads try again and undo', () => {
    expect(parseCommand('не ми харесва, опитай пак').retry).toBe(true)
    expect(parseCommand('направи друг вариант').retry).toBe(true)
    expect(parseCommand('върни както беше').undo).toBe(true)
  })

  it('explains what cannot be done here instead of guessing', () => {
    expect(parseCommand('направи я плътна').cannot).toEqual(['infill'])
    expect(parseCommand('оцвети я в червено').cannot).toEqual(['colour'])
  })

  it('reports what it did not understand', () => {
    const parsed = parseCommand('направи я като дракон')
    expect(parsed.unknown).toEqual(['направи я като дракон'])
    expect(parsed.actions).toEqual([])
  })
})
