import { useEffect, useState } from 'react'

/**
 * Loads a photo from the engine (through the main process) and returns a blob URL for <img>.
 * `version` makes it load again, e.g. when the cut-out photo appears during a job.
 * Returns null while loading, or when the file does not exist (yet).
 */
export function useEngineImage(path: string | null, version?: unknown): string | null {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    let url: string | null = null
    window.api.engine.file(path).then((file) => {
      if (cancelled || !file.data) return
      url = URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.contentType }))
      setLoaded({ path, url })
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, version])

  return loaded && loaded.path === path ? loaded.url : null
}
