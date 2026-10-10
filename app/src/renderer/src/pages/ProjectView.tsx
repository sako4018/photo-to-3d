import { Link, useParams } from 'react-router-dom'
import { isActive } from '../lib/job-steps'
import { useStore } from '../store'
import { Progress } from './Progress'
import { Workspace } from './Workspace'
import './ProjectView.css'

/** One project: progress while it is made, the workspace when ready, or what went wrong. */
export function ProjectView(): React.JSX.Element {
  const { id = '' } = useParams()
  const project = useStore((state) => state.projects.find((row) => row.id === id))
  const job = useStore((state) => state.jobs[id])
  const createModel = useStore((state) => state.createModel)
  const dismissJob = useStore((state) => state.dismissJob)
  const problem = useStore((state) => state.photoProblem)

  if (!project) {
    return (
      <div className="notice">
        <h1>Project not found</h1>
        <Link to="/">Back to start</Link>
      </div>
    )
  }
  if (job && isActive(job)) return <Progress project={project} job={job} />
  // A failed or cancelled new try is shown even when the project still has its old model.
  const stopped = job?.status === 'error' || job?.status === 'cancelled'
  if (project.status === 'ready' && !stopped) return <Workspace project={project} />

  const failed = job?.status === 'error' || project.status === 'error'
  const outOfMemory = failed && /memory/i.test(job?.error?.error ?? '')
  const cancelled = job?.status === 'cancelled'
  return (
    <div className="notice">
      <h1>
        {cancelled ? 'Cancelled' : failed ? 'The model could not be made' : 'No model yet'}
      </h1>
      {failed && job?.error && (
        <>
          <p>
            {job.error.error} {job.error.hint}
          </p>
          {job.error.details && (
            <details className="error-details">
              <summary>Details</summary>
              <pre>{job.error.details}</pre>
            </details>
          )}
        </>
      )}
      {cancelled && <p>Your photo is kept. You can start again.</p>}
      {problem && <p className="bad">{problem}</p>}
      <button className="primary" onClick={() => void createModel(project.id)}>
        {failed || cancelled ? 'Try again' : 'Create 3D model'}
      </button>
      {project.status === 'ready' && (
        <button onClick={() => dismissJob(project.id)}>Back to the model</button>
      )}
      {outOfMemory && (
        <button onClick={() => void createModel(project.id, { quality: 'fast' })}>Try Fast detail</button>
      )}
    </div>
  )
}
