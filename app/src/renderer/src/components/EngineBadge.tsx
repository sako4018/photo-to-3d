import { useStore } from '../store'

/** Engine state at the bottom of the sidebar. */
export function EngineBadge(): React.JSX.Element {
  const engine = useStore((state) => state.engine)
  const health = useStore((state) => state.health)

  const dot = engine.state === 'ready' ? 'ok' : engine.state === 'error' ? 'bad' : ''
  const text =
    engine.state === 'ready'
      ? `Engine ${health?.version ?? ''}`.trim()
      : engine.state === 'starting'
        ? 'Engine starting…'
        : engine.state === 'error'
          ? 'Engine error'
          : 'Engine stopped'

  return (
    <div className="engine-badge" title={engine.error}>
      <span className={`dot ${dot}`} />
      {text}
      {engine.state === 'error' && (
        <button className="link" onClick={() => void window.api.engine.restart()}>
          Restart
        </button>
      )}
    </div>
  )
}
