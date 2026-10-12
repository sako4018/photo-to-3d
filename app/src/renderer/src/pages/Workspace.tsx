import type { Project } from '@shared/types'
import { Inspector } from '../components/Inspector'
import { RenameInput } from '../components/RenameInput'
import { Viewer3D } from '../components/Viewer3D'
import { useModel } from '../hooks/useModel'
import { useStore } from '../store'
import './Workspace.css'

/** The finished model: the 3D view fills the area, the controls float over it. */
export function Workspace({ project }: { project: Project }): React.JSX.Element {
  const revision = useStore((state) => state.modelRevision[project.id] ?? 0)
  const renaming = useStore((state) => state.renamingId === project.id)
  const { setRenaming, renameProject } = useStore.getState()
  const { model, error } = useModel(project.id, `${project.outputs.stl}:${revision}`)

  return (
    <div className="workspace">
      <div className="workspace-view">
        {model && <Viewer3D key={`${project.id}:${revision}`} model={model} projectId={project.id} />}
        {!model && <p className="workspace-note">{error ?? 'Loading the model…'}</p>}
      </div>
      <header className="workspace-title" title="Double click to rename" onDoubleClick={() => setRenaming(project.id)}>
        {renaming ? (
          <RenameInput
            className="title"
            value={project.name}
            onCommit={(name) => void renameProject(project.id, name)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          project.name
        )}
      </header>
      <Inspector key={project.id} project={project} />
    </div>
  )
}
