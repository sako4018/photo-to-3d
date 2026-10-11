import { spawn, type ChildProcess } from 'child_process'
import type { EngineInfo, EngineStatus } from '@shared/types'

export interface EngineLaunch {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

interface Options {
  launch: EngineLaunch
  /** How long to wait for the first line and a good /health. uv may build the Python env first. */
  startTimeoutMs?: number
  /** How long to wait after SIGTERM before the process is killed. */
  stopTimeoutMs?: number
}

const HEALTH_RETRY_MS = 250

/** The first stdout line of the engine is JSON like {"host":"127.0.0.1","port":59782,"token":"x"}. */
export function parseInfoLine(line: string): EngineInfo | null {
  try {
    const info = JSON.parse(line) as Partial<EngineInfo>
    if (typeof info.host === 'string' && typeof info.port === 'number' && typeof info.token === 'string') {
      return { host: info.host, port: info.port, token: info.token }
    }
  } catch {
    // not JSON: some other output
  }
  return null
}

/** Starts the Python engine, watches it, restarts it once after a crash and stops it cleanly. */
export class EngineManager {
  private status: EngineStatus = { state: 'stopped' }
  private child: ChildProcess | null = null
  private listeners = new Set<(status: EngineStatus) => void>()
  private stopping = false
  private autoRestarts = 0
  private stderrTail: string[] = []

  constructor(private readonly options: Options) {}

  getStatus(): EngineStatus {
    return this.status
  }

  onStatus(listener: (status: EngineStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Starts the engine. Resolves when it is ready or has failed (see getStatus). */
  async start(): Promise<void> {
    if (this.child) return
    this.stopping = false
    this.stderrTail = []
    this.setStatus({ state: 'starting' })

    const { command, args, cwd, env } = this.options.launch
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      // stdin stays open as a lifeline: when this process dies, the engine sees it close and stops
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group on macOS, so "uv run" and its Python child can be stopped together.
      detached: process.platform !== 'win32'
    })
    this.child = child

    const exited = new Promise<{ code: number | null }>((resolve) => {
      child.once('error', (error) => {
        this.stderrTail.push(String(error))
        resolve({ code: null })
      })
      child.once('exit', (code) => resolve({ code }))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = [...this.stderrTail, ...chunk.toString().split('\n')].slice(-20)
    })

    const info = await Promise.race([this.readInfo(child), exited])
    if (info && 'port' in info && (await this.waitForHealth(info, exited))) {
      this.setStatus({ state: 'ready', info })
      void exited.then(() => this.onExit())
      return
    }

    // Failed before it was ready.
    const code = (await Promise.race([exited, Promise.resolve(undefined)]))?.code
    await this.killChild(child)
    this.child = null
    if (this.stopping) return
    this.setStatus({ state: 'error', error: this.failureMessage(code) })
  }

  /** Manual restart ("Restart engine" button): forgets earlier crashes. */
  async restart(): Promise<void> {
    await this.stop()
    this.autoRestarts = 0
    await this.start()
  }

  /** Clean stop; kills the process when it takes longer than stopTimeoutMs. */
  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    this.child = null
    if (child) await this.killChild(child)
    this.setStatus({ state: 'stopped' })
  }

  private async onExit(): Promise<void> {
    if (this.stopping || !this.child) return
    this.child = null
    if (this.autoRestarts < 1) {
      this.autoRestarts += 1
      await this.start()
      return
    }
    this.setStatus({ state: 'error', error: this.failureMessage(undefined, 'The engine stopped again.') })
  }

  private readInfo(child: ChildProcess): Promise<EngineInfo | null> {
    return new Promise((resolve) => {
      let buffer = ''
      const timer = setTimeout(() => resolve(null), this.options.startTimeoutMs ?? 120_000)
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const line = buffer.split('\n')[0]
        if (buffer.includes('\n')) {
          const info = parseInfoLine(line)
          if (info) {
            clearTimeout(timer)
            child.stdout?.removeAllListeners('data')
            child.stdout?.resume() // keep draining so the engine never blocks on a full pipe
            resolve(info)
          }
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(null)
      })
    })
  }

  private async waitForHealth(info: EngineInfo, exited: Promise<unknown>): Promise<boolean> {
    let gone = false
    void exited.then(() => (gone = true))
    const deadline = Date.now() + (this.options.startTimeoutMs ?? 120_000)
    while (!gone && Date.now() < deadline) {
      try {
        const response = await fetch(`http://${info.host}:${info.port}/health`, {
          headers: { 'X-Token': info.token }
        })
        if (response.ok) return true
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_MS))
    }
    return false
  }

  private async killChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    const done = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    this.signal(child, 'SIGTERM')
    const timeout = this.options.stopTimeoutMs ?? 5000
    const timer = setTimeout(() => this.signal(child, 'SIGKILL'), timeout)
    await done
    clearTimeout(timer)
  }

  private signal(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) return
    try {
      if (process.platform === 'win32') {
        // "uv run" starts Python as a child: stop the whole tree, not only uv
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else process.kill(-child.pid, signal) // the whole group
    } catch {
      // already gone
    }
  }

  private failureMessage(code: number | null | undefined, lead = 'The engine did not start.'): string {
    const tail = this.stderrTail.filter(Boolean).slice(-5).join('\n')
    const exit = code === undefined || code === null ? '' : ` (exit code ${code})`
    return tail ? `${lead}${exit}\n${tail}` : `${lead}${exit}`
  }

  private setStatus(status: EngineStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }
}
