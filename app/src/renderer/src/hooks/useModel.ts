import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import { loadModel, type ModelSize } from '../lib/stl'

export interface Model {
  geometry: BufferGeometry
  size: ModelSize
}

type Loaded = { key: string; model: Model | null; error: string | null }

/**
 * Loads the project's STL through the main process. `version` makes it load again after the
 * engine made a new STL (new height, plate...). Returns nulls while loading.
 */
export function useModel(
  projectId: string,
  version: unknown
): { model: Model | null; error: string | null } {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const key = `${projectId}:${String(version)}`

  useEffect(() => {
    let cancelled = false
    let geometry: BufferGeometry | null = null
    window.api.engine.file(`/projects/${projectId}/files/model.stl`).then((file) => {
      if (cancelled) return
      if (!file.data) {
        setLoaded({ key, model: null, error: 'The model file could not be loaded.' })
        return
      }
      try {
        const model = loadModel(file.data)
        geometry = model.geometry
        setLoaded({ key, model, error: null })
      } catch {
        setLoaded({ key, model: null, error: 'The model file is not a valid STL.' })
      }
    })
    return () => {
      cancelled = true
      geometry?.dispose()
    }
  }, [projectId, key])

  const current = loaded && loaded.key === key ? loaded : null
  return { model: current?.model ?? null, error: current?.error ?? null }
}
