// Types shared by main, preload and renderer.
// Agents for tasks 2.3-2.4 (engine manager, preload API) extend THIS file.

/** First stdout line printed by the engine: {"host":"127.0.0.1","port":59782,"token":"dev"} */
export interface EngineInfo {
  host: string
  port: number
  token: string
}

export type EngineState = 'stopped' | 'starting' | 'ready' | 'error'

export interface EngineStatus {
  state: EngineState
  /** Set when state is 'ready' */
  info?: EngineInfo
  /** Human readable message when state is 'error' */
  error?: string
}

/** Response of GET /health. */
export interface HealthResponse {
  version: string
  devices: string[]
  free_memory_gb: number
  total_memory_gb: number
  free_disk_gb: number
  gpu: { kind: 'apple' | 'nvidia' | 'none'; name: string }
  /** Default engine id */
  engine: string
  data_dir: string
}

/** GET/POST /engines/{id}/install and the WS event {"type":"install","install":{...}} */
export interface InstallState {
  engine: string
  status: 'idle' | 'running' | 'paused' | 'done' | 'error'
  /** 0..1 */
  progress: number
  total_gb: number
  error?: { error: string; hint: string }
}

/** Job progress step inside job events. */
export interface JobStep {
  done: number
  total: number
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

/** Job record as the engine reports it (GET /jobs/{id} and WS "job" events). */
export interface Job {
  id: string
  project_id: string
  status: JobStatus
  stage: string
  /** 0..1 */
  progress: number
  step: JobStep | null
  /** What happened, what to do, and the technical text for "Details". */
  error?: { error: string; hint: string; details?: string } | null
}

/** Project record (GET /projects/{id}). Only the fields the app uses. */
export interface Project {
  id: string
  name: string
  /** ISO time without zone, e.g. "2026-10-11T00:21:05" */
  created: string
  status: string
  image: string | null
  settings: Record<string, unknown>
  outputs: Record<string, string>
  report: Record<string, unknown> | null
}

/** Everything the engine pushes over its WebSocket. */
export type EngineEvent =
  | { type: 'job'; job: Job }
  | { type: 'install'; install: InstallState }

/** A binary file from the engine (a photo or the STL). */
export interface EngineFile {
  status: number
  data: Uint8Array | null
  contentType: string
}

/** Result of a request sent through the main process. */
export interface EngineResponse {
  status: number
  /** Parsed JSON, or null when the body was empty or not JSON. */
  body: unknown
}

/** IPC channel names (ipcMain.handle / ipcRenderer.invoke, and main -> renderer events). */
export const IpcChannels = {
  engineGetStatus: 'engine:get-status', // invoke -> EngineStatus
  engineRestart: 'engine:restart', // invoke -> void
  engineRequest: 'engine:request', // invoke (method, path, body?) -> EngineResponse
  engineFile: 'engine:file', // invoke (path) -> EngineFile (photos and STL, binary)
  engineStatusChanged: 'engine:status-changed', // event main -> renderer, payload EngineStatus
  engineEvent: 'engine:event', // event main -> renderer, payload EngineEvent
  filesSaveStl: 'files:save-stl', // invoke (projectId) -> FileResult
  filesOpenInSlicer: 'files:open-in-slicer', // invoke (projectId, slicerId?) -> FileResult
  filesShowInFolder: 'files:show-in-folder', // invoke (projectId) -> FileResult
  filesSlicers: 'files:slicers', // invoke -> SlicerInfo[]
  projectMenu: 'project:menu', // invoke -> ProjectMenuChoice (right-click menu in the project list)
  projectConfirmDelete: 'project:confirm-delete', // invoke (name) -> boolean
  appInfo: 'app:info', // invoke -> AppInfo
  appConfirm: 'app:confirm', // invoke (ConfirmOptions) -> boolean
  appOpenSettings: 'app:open-settings', // invoke -> void
  filesShowModel: 'files:show-model', // invoke (engineId) -> FileResult
  filesShowProjects: 'files:show-projects', // invoke -> FileResult
  menuAction: 'menu:action', // event main -> renderer, payload MenuAction
  settingsChanged: 'settings:changed', // event main -> renderer, payload AppSettings
  settingsGet: 'settings:get', // invoke -> AppSettings
  settingsSet: 'settings:set', // invoke (Partial<AppSettings>) -> AppSettings
  photoChoose: 'photo:choose', // invoke -> string | null (path picked in the system file dialog)
  photoUpload: 'photo:upload' // invoke (path) -> UploadResult
} as const

/** Photo types the engine accepts (engine/src/photo3d_engine/preprocess/image_io.py). */
export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']

/** Same limit as MAX_UPLOAD_BYTES in engine/src/photo3d_engine/projects.py. */
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024

/** Menu items that the window itself has to carry out. */
export type MenuAction = 'new-photo' | 'save-stl'

export interface AppInfo {
  name: string
  version: string
}

export interface ConfirmOptions {
  message: string
  detail: string
  /** Label of the button that does it; the other button is "Cancel". */
  confirmLabel: string
}

export type ProjectMenuChoice = 'rename' | 'show' | 'delete' | null

/** A slicer found on this computer. */
export interface SlicerInfo {
  id: string
  name: string
}

/** Result of Save STL, Open in slicer and Show in folder. */
export type FileResult =
  | { ok: true; path?: string }
  | { ok: false; canceled?: boolean; error: string; hint: string }

/** Settings window (S1) values, kept by the main process. */
export interface AppSettings {
  /** Slicer id chosen by the user; null = the first installed one. */
  slicer: string | null
  defaultHeightMm: number
  defaultQuality: 'fast' | 'normal' | 'detailed'
  /** Folder of the last saved STL; the save dialog opens there. null = Downloads. */
  saveFolder: string | null
}

export type UploadResult =
  | { ok: true; projectId: string; name: string }
  | { ok: false; error: string; hint: string }

/** What the preload script exposes as `window.api`. */
export interface PreloadApi {
  engine: {
    getStatus(): Promise<EngineStatus>
    restart(): Promise<void>
    /** Goes through the main process, which adds the token. */
    request(method: string, path: string, body?: unknown): Promise<EngineResponse>
    /** GET of a binary file, e.g. /projects/{id}/files/model.stl */
    file(path: string): Promise<EngineFile>
    /** Returns an unsubscribe function. */
    onStatusChanged(callback: (status: EngineStatus) => void): () => void
    /** Returns an unsubscribe function. */
    onEvent(callback: (event: EngineEvent) => void): () => void
  }
  files: {
    /** Asks where to save, then copies the STL there. */
    saveStl(projectId: string): Promise<FileResult>
    openInSlicer(projectId: string, slicerId?: string): Promise<FileResult>
    showInFolder(projectId: string): Promise<FileResult>
    slicers(): Promise<SlicerInfo[]>
    /** Reveals the folder of a downloaded model. */
    showModel(engineId: string): Promise<FileResult>
    /** Opens the folder with all projects. */
    showProjects(): Promise<FileResult>
  }
  app: {
    info(): Promise<AppInfo>
    /** Native question with a confirm button and Cancel. */
    confirm(options: ConfirmOptions): Promise<boolean>
    openSettings(): Promise<void>
    /** Returns an unsubscribe function. */
    onMenuAction(callback: (action: MenuAction) => void): () => void
  }
  projects: {
    /** Pops up the right-click menu; resolves to what was chosen, or null when it was dismissed. */
    showMenu(): Promise<ProjectMenuChoice>
    /** Native "Delete 'name'?" question. */
    confirmDelete(name: string): Promise<boolean>
  }
  settings: {
    get(): Promise<AppSettings>
    set(changes: Partial<AppSettings>): Promise<AppSettings>
    /** Returns an unsubscribe function. */
    onChanged(callback: (settings: AppSettings) => void): () => void
  }
  photo: {
    /** Opens Finder / Explorer. Resolves to null when the user cancels. */
    choose(): Promise<string | null>
    /** Creates a project named after the file and uploads the photo to it. */
    upload(path: string): Promise<UploadResult>
    /** Path of a file dropped on the window. */
    pathForFile(file: File): string
  }
}
