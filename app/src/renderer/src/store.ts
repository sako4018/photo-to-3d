import { create } from 'zustand'
import type {
  EngineEvent,
  AppSettings,
  EngineStatus,
  HealthResponse,
  InstallState,
  Job,
  Project,
  SlicerInfo
} from '@shared/types'
import { engineClient, EngineError, type EngineInfoRow, type JobOptions } from './api/engine-client'
import type { Sample } from './lib/format'
import type { Vec3 } from './lib/stl'
import { isActive, stepSample } from './lib/job-steps'

interface AppState {
  engine: EngineStatus
  health: HealthResponse | null
  /** Models the engine knows (null until loaded). */
  models: EngineInfoRow[] | null
  /** Latest state of the model download, if one was started. */
  install: InstallState | null
  /** Recent download progress points, for "time left". Empty while not running. */
  installSamples: Sample[]
  /** Newest first, as the engine lists them. */
  projects: Project[]
  /** Latest job per project id. */
  jobs: Record<string, Job>
  /** When the current job of each project started (ms), for "so far". */
  jobStarted: Record<string, number>
  /** Progress points of the model's steps per project id, for "time left". */
  jobSamples: Record<string, Sample[]>
  /** Settings window values (null until loaded). */
  settings: AppSettings | null
  /** Slicers found on this computer. */
  slicers: SlicerInfo[]
  /** Counts new STLs per project (print-prep changes), so the viewer loads the file again. */
  modelRevision: Record<string, number>
  /** Message under the drop zone when adding a photo failed. */
  photoProblem: string | null
  /** Project being renamed right now (inline edit), if any. */
  renamingId: string | null
  /** A short message at the bottom of the window (errors of small actions). */
  notice: string | null
  /** The part of the model the user clicked, for "Fix a part". */
  selectedPart: SelectedPart | null
  selectPart(part: SelectedPart | null): void
  /** Forgets a finished job, so its error or "cancelled" card goes away. */
  dismissJob(projectId: string): void
  setRenaming(id: string | null): void
  notify(message: string): void
  renameProject(id: string, name: string): Promise<void>
  deleteProject(id: string): Promise<boolean>
  refreshModels(): Promise<void>
  refreshProjects(): Promise<void>
  setEngine(status: EngineStatus): void
  setJob(job: Job): void
  /** Takes a project the engine just changed (print-prep) into the list. */
  updateProject(project: Project): void
  setPhotoProblem(message: string | null): void
  applyEvent(event: EngineEvent): void
  /** Uploads a photo, starts the 3D model and returns the new project id (null on failure). */
  addPhoto(path: string): Promise<string | null>
  /** Starts (or restarts) the 3D model of a project that already has a photo. */
  createModel(projectId: string, options?: JobOptions): Promise<boolean>
}

export interface SelectedPart {
  projectId: string
  /** The clicked point in the viewer (Y up). */
  view: Vec3
  /** The same point on the STL (Z up, mm), as the engine wants it. */
  stl: Vec3
  /** Size of the picked area, mm. */
  radius: number
}

function explain(error: unknown): string {
  return error instanceof EngineError ? `${error.message} ${error.hint}`.trim() : String(error)
}

export const useStore = create<AppState>((set, get) => ({
  engine: { state: 'stopped' },
  health: null,
  models: null,
  install: null,
  installSamples: [],
  projects: [],
  jobs: {},
  jobSamples: {},
  jobStarted: {},
  settings: null,
  slicers: [],
  modelRevision: {},
  photoProblem: null,
  renamingId: null,
  notice: null,
  selectedPart: null,
  selectPart: (selectedPart) => set({ selectedPart }),

  refreshModels: async () => {
    set({ models: await engineClient.engines() })
  },
  refreshProjects: async () => {
    set({ projects: await engineClient.projects() })
  },
  setEngine: (engine) =>
    set(engine.state === 'ready' ? { engine } : { engine, health: null, models: null }),
  setJob: (job) =>
    set((state) => ({
      jobs: { ...state.jobs, [job.project_id]: job },
      jobSamples: { ...state.jobSamples, [job.project_id]: [] },
      jobStarted: { ...state.jobStarted, [job.project_id]: Date.now() }
    })),
  updateProject: (project) =>
    set((state) => ({
      projects: state.projects.map((row) => (row.id === project.id ? project : row)),
      modelRevision: { ...state.modelRevision, [project.id]: (state.modelRevision[project.id] ?? 0) + 1 }
    })),
  setPhotoProblem: (photoProblem) => set({ photoProblem }),
  dismissJob: (projectId) =>
    set((state) => ({
      jobs: Object.fromEntries(Object.entries(state.jobs).filter(([id]) => id !== projectId))
    })),
  setRenaming: (renamingId) => set({ renamingId }),
  notify: (notice) => {
    set({ notice })
    setTimeout(() => {
      if (get().notice === notice) set({ notice: null })
    }, 6000)
  },
  renameProject: async (id, name) => {
    set({ renamingId: null })
    const trimmed = name.trim()
    const current = get().projects.find((project) => project.id === id)
    if (!trimmed || !current || trimmed === current.name) return
    try {
      await engineClient.renameProject(id, trimmed)
      await get().refreshProjects()
    } catch (error) {
      get().notify(explain(error))
    }
  },
  deleteProject: async (id) => {
    try {
      await engineClient.deleteProject(id)
      await get().refreshProjects()
      return true
    } catch (error) {
      get().notify(explain(error))
      return false
    }
  },

  applyEvent: (event) => {
    if (event.type === 'install') {
      set((state) => ({
        install: event.install,
        installSamples:
          event.install.status === 'running'
            ? [...state.installSamples, { time: Date.now(), progress: event.install.progress }].slice(-30)
            : []
      }))
      return
    }
    const job = event.job
    const sample = stepSample(job, Date.now())
    set((state) => ({
      jobs: { ...state.jobs, [job.project_id]: job },
      // a job seen for the first time (e.g. started before this window opened) starts now
      jobStarted:
        state.jobs[job.project_id]?.id === job.id
          ? state.jobStarted
          : { ...state.jobStarted, [job.project_id]: Date.now() },
      jobSamples: {
        ...state.jobSamples,
        [job.project_id]: sample
          ? [...(state.jobSamples[job.project_id] ?? []), sample].slice(-30)
          : isActive(job)
            ? (state.jobSamples[job.project_id] ?? [])
            : []
      }
    }))
    // The engine updates the project when a job ends: load it again.
    if (!isActive(job)) get().refreshProjects().catch(() => undefined)
  },

  createModel: async (projectId, options) => {
    try {
      get().setJob(await engineClient.startJob(projectId, options))
      set({ photoProblem: null })
      // the job may have changed the project's settings (height, detail)
      get().refreshProjects().catch(() => undefined)
      return true
    } catch (error) {
      set({ photoProblem: explain(error) })
      return false
    }
  },

  addPhoto: async (path) => {
    set({ photoProblem: null })
    const result = await window.api.photo.upload(path)
    if (!result.ok) {
      const message = `${result.error} ${result.hint}`.trim()
      set({ photoProblem: message })
      get().notify(message) // also visible when the photo was dropped on another screen
      return null
    }
    await get().refreshProjects().catch(() => undefined)
    const defaults = get().settings
    const options = defaults ? { quality: defaults.defaultQuality, height_mm: defaults.defaultHeightMm } : undefined
    return (await get().createModel(result.projectId, options)) ? result.projectId : null
  }
}))

/** Connects the store to the main process. Call once; returns a function that disconnects. */
export function connectStore(): () => void {
  const { setEngine, applyEvent } = useStore.getState()
  void window.api.engine.getStatus().then(setEngine)
  void window.api.settings.get().then((settings) => useStore.setState({ settings }))
  void window.api.files.slicers().then((slicers) => useStore.setState({ slicers }))
  const offStatus = window.api.engine.onStatusChanged(setEngine)
  const offEvents = window.api.engine.onEvent(applyEvent)
  const offSettings = window.api.settings.onChanged((settings) => useStore.setState({ settings }))
  return () => {
    offStatus()
    offEvents()
    offSettings()
  }
}

/** Loads health, models and projects whenever the engine becomes ready. */
export function watchHealth(): () => void {
  return useStore.subscribe((state, previous) => {
    if (state.engine.state === 'ready' && previous.engine.state !== 'ready') {
      const { refreshModels, refreshProjects } = useStore.getState()
      engineClient
        .health()
        .then((health) => useStore.setState({ health }))
        .catch(() => undefined)
      refreshModels().catch(() => undefined)
      refreshProjects().catch(() => undefined)
    }
  })
}
