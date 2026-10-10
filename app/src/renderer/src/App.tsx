import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Setup } from './pages/Setup'
import { ProjectView } from './pages/ProjectView'
import { SettingsWindow } from './pages/SettingsWindow'
import { useStore } from './store'

function Splash({ title, text, restart }: { title: string; text?: string; restart?: boolean }): React.JSX.Element {
  return (
    <div className="splash">
      <h1>{title}</h1>
      {text && <pre>{text}</pre>}
      {restart && (
        <button className="primary" onClick={() => void window.api.engine.restart()}>
          Restart engine
        </button>
      )}
    </div>
  )
}

/** Decides what to show: engine starting or broken, first launch, or the app. */
function Gate(): React.JSX.Element {
  const engine = useStore((state) => state.engine)
  const health = useStore((state) => state.health)
  const models = useStore((state) => state.models)

  if (engine.state === 'error') {
    return <Splash title="The engine could not start" text={engine.error} restart />
  }
  if (engine.state !== 'ready' || !health || !models) return <Splash title="Starting…" />

  const model = models.find((row) => row.id === health.engine)
  if (model && !model.installed) return <Setup model={model} health={health} />

  // HashRouter: works with file:// URLs in the packaged app.
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="project/:id" element={<ProjectView />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export function App(): React.JSX.Element {
  // The Settings window is the same page loaded with #/settings: no first-launch gate there.
  if (window.location.hash.startsWith('#/settings')) return <SettingsWindow />
  return <Gate />
}
