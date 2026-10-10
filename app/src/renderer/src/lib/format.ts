/** "3.1 of 7.9 GB" */
export function formatDownloaded(progress: number, totalGb: number): string {
  const done = Math.min(progress, 1) * totalGb
  return `${done.toFixed(1)} of ${totalGb.toFixed(1)} GB`
}

/** "about 4 min", "about 1 h 5 min", "less than a minute" */
export function formatRemaining(seconds: number): string {
  if (seconds < 60) return 'less than a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`
}

export interface Sample {
  /** Milliseconds, e.g. Date.now() */
  time: number
  /** 0..1 */
  progress: number
}

/**
 * Seconds left, from how fast progress moved over the last samples.
 * Returns null while there is too little data ("Estimating…").
 */
export function estimateRemaining(samples: Sample[], minSeconds = 5): number | null {
  if (samples.length < 2) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  const seconds = (last.time - first.time) / 1000
  const gained = last.progress - first.progress
  if (seconds < minSeconds || gained <= 0) return null
  return ((1 - last.progress) / gained) * seconds
}

/** "Today", "Yesterday" or a short date, from the engine's local ISO time. */
export function formatDay(created: string, now: Date = new Date()): string {
  const day = new Date(created)
  const startOf = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(day)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** How long a model usually takes on an Apple Silicon Mac (docs/phase-2-app.md, Detail). */
export const TYPICAL_MINUTES: Record<string, number> = { fast: 1.5, normal: 2, detailed: 4 }

/** "1:05" */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * The line under "Creating your 3D model": the time left when the speed so far gives a
 * reliable number, else the usual total and the time so far (never a guess).
 */
export function progressLine(left: number | null, elapsedSeconds: number, quality: string): string {
  if (left !== null) return `${formatRemaining(left)} left`
  const typical = TYPICAL_MINUTES[quality] ?? TYPICAL_MINUTES.normal
  return `Usually about ${typical} min · ${formatElapsed(elapsedSeconds)} so far`
}
