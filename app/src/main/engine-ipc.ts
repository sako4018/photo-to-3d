import { BrowserWindow, ipcMain } from 'electron'
import {
  IpcChannels,
  type EngineEvent,
  type EngineFile,
  type EngineInfo,
  type EngineResponse,
  type EngineStatus
} from '@shared/types'

/** What the IPC layer needs from an engine: the real manager, or a fixed one for development. */
export interface EngineHandle {
  getStatus(): EngineStatus
  onStatus(listener: (status: EngineStatus) => void): () => void
  restart(): Promise<void>
}

/** Sends one request to the engine and returns status and parsed body. Main process only. */
export async function requestEngine(
  info: EngineInfo,
  method: string,
  path: string,
  body?: unknown
): Promise<EngineResponse> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    return { status: 400, body: { error: 'Bad request path.', hint: '' } }
  }
  const headers: Record<string, string> = { 'X-Token': info.token }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    const response = await fetch(`http://${info.host}:${info.port}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      // not JSON
    }
    return { status: response.status, body: parsed }
  } catch {
    return { status: 503, body: { error: 'The engine did not answer.', hint: 'Restart the engine.' } }
  }
}

/** GET of a binary file (photo, STL). */
export async function fetchEngineFile(info: EngineInfo, path: string): Promise<EngineFile> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    return { status: 400, data: null, contentType: '' }
  }
  try {
    const response = await fetch(`http://${info.host}:${info.port}${path}`, {
      headers: { 'X-Token': info.token }
    })
    if (!response.ok) return { status: response.status, data: null, contentType: '' }
    return {
      status: response.status,
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream'
    }
  } catch {
    return { status: 503, data: null, contentType: '' }
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

/** Registers the engine IPC and keeps a WebSocket to the engine open while it is ready. */
export function registerEngineIpc(engine: EngineHandle): void {
  ipcMain.handle(IpcChannels.engineGetStatus, () => engine.getStatus())
  ipcMain.handle(IpcChannels.engineRestart, () => engine.restart())
  ipcMain.handle(
    IpcChannels.engineRequest,
    (_event, method: string, path: string, body?: unknown): Promise<EngineResponse> => {
      const info = engine.getStatus().info
      if (engine.getStatus().state !== 'ready' || !info) {
        return Promise.resolve({
          status: 503,
          body: { error: 'The engine is not running.', hint: 'Restart the engine.' }
        })
      }
      return requestEngine(info, method, path, body)
    }
  )

  ipcMain.handle(IpcChannels.engineFile, (_event, path: string): Promise<EngineFile> => {
    const info = engine.getStatus().info
    if (engine.getStatus().state !== 'ready' || !info) {
      return Promise.resolve({ status: 503, data: null, contentType: '' })
    }
    return fetchEngineFile(info, path)
  })

  let socket: WebSocket | null = null
  let connectedTo: EngineInfo | null = null

  function connect(info: EngineInfo): void {
    connectedTo = info
    const ws = new WebSocket(`ws://${info.host}:${info.port}/ws?token=${encodeURIComponent(info.token)}`)
    socket = ws
    ws.onmessage = (message) => {
      try {
        broadcast(IpcChannels.engineEvent, JSON.parse(String(message.data)) as EngineEvent)
      } catch {
        // ignore malformed messages
      }
    }
    ws.onclose = () => {
      if (socket !== ws || connectedTo !== info) return
      setTimeout(() => {
        if (connectedTo === info) connect(info) // still the same running engine: reconnect
      }, 1000)
    }
  }

  function disconnect(): void {
    connectedTo = null
    socket?.close()
    socket = null
  }

  engine.onStatus((status) => {
    broadcast(IpcChannels.engineStatusChanged, status)
    if (status.state === 'ready' && status.info) {
      if (connectedTo?.port !== status.info.port) {
        disconnect()
        connect(status.info)
      }
    } else {
      disconnect()
    }
  })
  const current = engine.getStatus()
  if (current.state === 'ready' && current.info) connect(current.info)
}
