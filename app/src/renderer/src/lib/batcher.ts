/**
 * Collects changes and sends them together 300 ms after the last one.
 * While a request runs, new changes wait for it to end, so requests never overlap.
 */
export function createBatcher<T extends object>(
  send: (changes: Partial<T>) => Promise<void>,
  delayMs = 300
): { push(changes: Partial<T>): void; cancel(): void } {
  let pending: Partial<T> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false

  function schedule(): void {
    clearTimeout(timer)
    timer = setTimeout(run, delayMs)
  }

  async function run(): Promise<void> {
    if (running || !pending) return
    running = true
    const changes = pending
    pending = null
    try {
      await send(changes)
    } catch {
      // the caller shows its own errors
    } finally {
      running = false
      if (pending) schedule()
    }
  }

  return {
    push(changes) {
      pending = { ...pending, ...changes }
      schedule()
    },
    cancel() {
      clearTimeout(timer)
      pending = null
    }
  }
}
