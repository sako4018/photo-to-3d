import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { EngineManager, parseInfoLine } from './engine-manager'

// A fake engine: prints the info line, answers /health. FAKE_MODE picks the behaviour.
const FAKE_ENGINE = `
const http = require('http')
const fs = require('fs')
const mode = process.env.FAKE_MODE
if (mode === 'die') { console.error('boom: no model'); process.exit(3) }
const server = http.createServer((req, res) => { res.end('{"version":"fake"}') })
server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ host: '127.0.0.1', port: server.address().port, token: 't' }))
  const marker = process.env.FAKE_MARKER
  if (mode === 'crash-always' || (mode === 'crash-once' && !fs.existsSync(marker))) {
    if (marker) fs.writeFileSync(marker, 'x')
    setTimeout(() => process.exit(1), 400)
  }
})
process.on('SIGTERM', () => process.exit(0))
`

function manager(env: NodeJS.ProcessEnv): EngineManager {
  return new EngineManager({
    launch: { command: process.execPath, args: ['-e', FAKE_ENGINE], cwd: tmpdir(), env },
    startTimeoutMs: 5000,
    stopTimeoutMs: 1000
  })
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const running: EngineManager[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((m) => m.stop()))
})

describe('parseInfoLine', () => {
  it('reads the engine info line', () => {
    expect(parseInfoLine('{"host":"127.0.0.1","port":5,"token":"x"}')).toEqual({
      host: '127.0.0.1',
      port: 5,
      token: 'x'
    })
  })

  it('ignores other output', () => {
    expect(parseInfoLine('INFO: starting')).toBeNull()
    expect(parseInfoLine('{"port":"5"}')).toBeNull()
  })
})

describe('EngineManager', () => {
  it('becomes ready and leaves no process behind after stop', async () => {
    const m = manager({ FAKE_MODE: 'ok' })
    running.push(m)
    await m.start()
    const status = m.getStatus()
    expect(status.state).toBe('ready')
    const response = await fetch(`http://127.0.0.1:${status.info?.port}/health`)
    expect(response.ok).toBe(true)

    // the port stops answering and the status goes back to stopped
    await m.stop()
    expect(m.getStatus().state).toBe('stopped')
    await expect(fetch(`http://127.0.0.1:${status.info?.port}/health`)).rejects.toThrow()
  })

  it('reports why the engine did not start', async () => {
    const m = manager({ FAKE_MODE: 'die' })
    running.push(m)
    await m.start()
    const status = m.getStatus()
    expect(status.state).toBe('error')
    expect(status.error).toContain('boom: no model')
    expect(status.error).toContain('exit code 3')
  })

  it('restarts once by itself after a crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'photo3d-'))
    const marker = join(dir, 'crashed')
    const m = manager({ FAKE_MODE: 'crash-once', FAKE_MARKER: marker })
    running.push(m)
    await m.start()
    const first = m.getStatus().info?.port
    await until(() => existsSync(marker))
    await until(() => m.getStatus().state === 'ready' && m.getStatus().info?.port !== first)
    expect(m.getStatus().state).toBe('ready')
    rmSync(dir, { recursive: true })
  })

  it('gives up after the second crash and can be restarted by hand', async () => {
    const m = manager({ FAKE_MODE: 'crash-always' })
    running.push(m)
    await m.start()
    await until(() => m.getStatus().state === 'error', 8000)
    expect(m.getStatus().error).toContain('stopped again')

    await m.restart()
    expect(m.getStatus().state).toBe('ready')
  })
})
