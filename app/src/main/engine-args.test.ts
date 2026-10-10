import { describe, expect, it } from 'vitest'
import { engineArgs } from './engine-args'

describe('engineArgs', () => {
  it('keeps a token that starts with a dash in one argument', () => {
    const args = engineArgs('-abc_DEF', '/Users/me/Library/Application Support/photo-to-3d-app/data')
    expect(args).toContain('--token=-abc_DEF')
    expect(args).toContain('--data-dir=/Users/me/Library/Application Support/photo-to-3d-app/data')
    expect(args).toContain('--exit-with-parent')
    expect(args.some((arg) => arg === '-abc_DEF')).toBe(false)
  })

  it('adds the engine only when one is asked for', () => {
    expect(engineArgs('t', '/d').some((arg) => arg.startsWith('--engine'))).toBe(false)
    expect(engineArgs('t', '/d', 'dummy')).toContain('--engine=dummy')
  })
})
