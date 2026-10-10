import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { Project } from '@shared/types'
import { useEngineImage } from '../hooks/useEngineImage'
import { useAddPhoto } from '../hooks/useAddPhoto'
import { formatDay } from '../lib/format'
import { isActive } from '../lib/job-steps'
import { useStore } from '../store'
import { EngineBadge } from './EngineBadge'
import { RenameInput } from './RenameInput'
import './Layout.css'

function subtitle(project: Project, percent: number | null): string {
  if (percent !== null) return `Creating · ${percent}%`
  if (project.status === 'ready') {
    const height = project.settings.height_mm
    return `${formatDay(project.created)}${typeof height === 'number' ? ` · ${Math.round(height)} mm` : ''}`
  }
  if (project.status === 'error') return 'Failed'
  return 'No model yet'
}

function ProjectRow({ project }: { project: Project }): React.JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const job = useStore((state) => state.jobs[project.id])
  const renaming = useStore((state) => state.renamingId === project.id)
  const { setRenaming, renameProject, deleteProject, notify } = useStore.getState()
  const thumb = useEngineImage(project.image ? `/projects/${project.id}/files/original` : null)
  const percent = job && isActive(job) ? Math.round(job.progress * 100) : null

  async function openMenu(event: React.MouseEvent): Promise<void> {
    event.preventDefault()
    const choice = await window.api.projects.showMenu()
    if (choice === 'rename') setRenaming(project.id)
    if (choice === 'show') {
      const result = await window.api.files.showInFolder(project.id)
      if (!result.ok) notify(`${result.error} ${result.hint}`.trim())
    }
    if (choice === 'delete' && (await window.api.projects.confirmDelete(project.name))) {
      const deleted = await deleteProject(project.id)
      if (deleted && pathname === `/project/${project.id}`) navigate('/')
    }
  }

  const body = (
    <>
      <span className="thumb">{thumb && <img src={thumb} alt="" />}</span>
      <span className="project-text">
        {renaming ? (
          <RenameInput
            value={project.name}
            onCommit={(name) => void renameProject(project.id, name)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <span className="project-name">{project.name}</span>
        )}
        <span className="project-sub">{subtitle(project, percent)}</span>
      </span>
    </>
  )

  // While renaming it is a plain row: the field must not be inside a link.
  return renaming ? (
    <div className="project-row active">{body}</div>
  ) : (
    <NavLink to={`/project/${project.id}`} className="project-row" onContextMenu={(event) => void openMenu(event)}>
      {body}
    </NavLink>
  )
}

export function Layout(): React.JSX.Element {
  const navigate = useNavigate()
  const projects = useStore((state) => state.projects)
  const notice = useStore((state) => state.notice)
  const { addPath, choose } = useAddPhoto()
  const [dragging, setDragging] = useState(false)

  // ⌘N (File > New from Photo) goes to the start screen and opens the file dialog.
  useEffect(
    () =>
      window.api.app.onMenuAction((action) => {
        if (action === 'new-photo') {
          navigate('/')
          void choose()
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // A photo can be dropped anywhere on the window.
  function drop(event: React.DragEvent): void {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void addPath(window.api.photo.pathForFile(file))
  }

  return (
    <div
      className={`layout${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={drop}
    >
      <aside className="sidebar">
        <button className="new-photo" onClick={() => navigate('/')}>
          ＋ New from photo
        </button>
        <nav>
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </nav>
        <div className="sidebar-bottom">
          <EngineBadge />
          <button className="link" onClick={() => void window.api.app.openSettings()}>
            Settings
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      {notice && <div className="toast">{notice}</div>}
    </div>
  )
}
