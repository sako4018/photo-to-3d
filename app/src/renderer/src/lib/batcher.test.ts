import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBatcher } from './batcher'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createBatcher', () => {
  it('sends one request with all changes 300 ms after the last one', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const batch = createBatcher<{ height: number; plate: number }>(send)

    batch.push({ height: 100 })
    await vi.advanceTimersByTimeAsync(200)
    batch.push({ height: 120 })
    batch.push({ plate: 2 })
    await vi.advanceTimersByTimeAsync(299)
    expect(send).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ height: 120, plate: 2 })
  })

  it('waits for a running request before it sends the next changes', async () => {
    let finish: () => void = () => undefined
    const send = vi.fn().mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const batch = createBatcher<{ height: number }>(send)

    batch.push({ height: 80 })
    await vi.advanceTimersByTimeAsync(300)
    batch.push({ height: 90 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(1) // the first one is still running

    finish()
    await vi.advanceTimersByTimeAsync(300)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ height: 90 })
  })

  it('can drop what has not been sent', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const batch = createBatcher<{ height: number }>(send)
    batch.push({ height: 80 })
    batch.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).not.toHaveBeenCalled()
  })
})
