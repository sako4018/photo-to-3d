import type {
  EngineResponse,
  HealthResponse,
  InstallState,
  Job,
  Project
} from '@shared/types'

/** Sends one request through the main process (which adds the token). */
export type Transport = (method: string, path: string, body?: unknown) => Promise<EngineResponse>

/** An error the engine explained in plain words: {"error": "...", "hint": "..."}. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly hint: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface EngineInfoRow {
  id: string
  name: string
  installed: boolean
  /** The app downloaded the weights itself, so it may remove them. */
  own_copy: boolean
  download_gb: number
  est_mem_gb: number
  folder: string | null
  disk_gb: number
}

export interface JobOptions {
  quality?: string
  height_mm?: number
  /** A new seed gives a different model from the same photo. */
  seed?: number
}

export type PartOperation = 'smooth' | 'thicker' | 'thinner' | 'remove'

/** A change to one part of the model: a point on the STL (mm, Z up) and how far around it. */
export interface PartEdit {
  op: PartOperation
  point: [number, number, number]
  radius_mm: number
  amount_mm?: number
  strength?: number
}

export interface PrintPrepOptions {
  height_mm?: number
  base_cut_pct?: number
  base_plate_mm?: number
  rotation?: number[]
  quality?: string
}

const viaWindowApi: Transport = (method, path, body) =>
  window.api.engine.request(method, path, body)

/** Client for the engine HTTP API (docs/PLAN.md, section 10). */
export class EngineClient {
  constructor(private readonly transport: Transport = viaWindowApi) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.transport(method, path, body)
    if (response.status >= 400) {
      const problem = (response.body ?? {}) as { error?: string; hint?: string }
      throw new EngineError(
        problem.error ?? `Engine answered ${response.status} for ${path}`,
        problem.hint ?? '',
        response.status
      )
    }
    return response.body as T
  }

  health(): Promise<HealthResponse> {
    return this.call('GET', '/health')
  }

  engines(): Promise<EngineInfoRow[]> {
    return this.call('GET', '/engines')
  }

  installState(engine: string): Promise<InstallState> {
    return this.call('GET', `/engines/${engine}/install`)
  }

  installStart(engine: string): Promise<InstallState> {
    return this.call('POST', `/engines/${engine}/install`)
  }

  /** Deletes the app's own downloaded copy of the model. */
  removeModel(engine: string): Promise<InstallState> {
    return this.call('DELETE', `/engines/${engine}/install`)
  }

  installPause(engine: string): Promise<InstallState> {
    return this.call('POST', `/engines/${engine}/install/pause`)
  }

  projects(): Promise<Project[]> {
    return this.call('GET', '/projects')
  }

  project(id: string): Promise<Project> {
    return this.call('GET', `/projects/${id}`)
  }

  renameProject(id: string, name: string): Promise<Project> {
    return this.call('PATCH', `/projects/${id}`, { name })
  }

  deleteProject(id: string): Promise<void> {
    return this.call('DELETE', `/projects/${id}`)
  }

  startJob(projectId: string, options: JobOptions = {}): Promise<Job> {
    return this.call('POST', '/jobs', { project_id: projectId, ...options })
  }

  job(id: string): Promise<Job> {
    return this.call('GET', `/jobs/${id}`)
  }

  cancelJob(id: string): Promise<Job> {
    return this.call('POST', `/jobs/${id}/cancel`)
  }

  printPrep(projectId: string, options: PrintPrepOptions): Promise<Project> {
    return this.call('POST', `/projects/${projectId}/print-prep`, options)
  }

  addEdit(projectId: string, edit: PartEdit): Promise<Project> {
    return this.call('POST', `/projects/${projectId}/edits`, edit)
  }

  undoEdit(projectId: string): Promise<Project> {
    return this.call('DELETE', `/projects/${projectId}/edits/last`)
  }

  exportStl(projectId: string, destPath: string): Promise<{ path: string }> {
    return this.call('POST', `/projects/${projectId}/export`, { format: 'stl', dest_path: destPath })
  }
}

export const engineClient = new EngineClient()
