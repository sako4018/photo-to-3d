import { describe, expect, it, vi } from 'vitest'
import { EngineClient, EngineError } from './engine-client'

describe('EngineClient', () => {
  it('sends the method, path and body through the transport', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 202, body: { id: 'j1' } })

    const job = await new EngineClient(transport).startJob('p1', { quality: 'fast' })

    expect(job).toEqual({ id: 'j1' })
    expect(transport).toHaveBeenCalledWith('POST', '/jobs', { project_id: 'p1', quality: 'fast' })
  })

  it('turns an engine error into an EngineError with its hint', async () => {
    const transport = vi.fn().mockResolvedValue({
      status: 409,
      body: { error: 'A job is still running.', hint: 'Cancel it first.' }
    })

    const call = new EngineClient(transport).deleteProject('p1')

    await expect(call).rejects.toBeInstanceOf(EngineError)
    await expect(call).rejects.toMatchObject({
      message: 'A job is still running.',
      hint: 'Cancel it first.',
      status: 409
    })
  })

  it('still reports an error when the body is not the usual shape', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 500, body: null })

    await expect(new EngineClient(transport).health()).rejects.toThrow('500')
  })
})
