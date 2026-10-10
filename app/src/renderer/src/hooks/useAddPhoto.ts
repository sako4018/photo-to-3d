import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'

/** Adds a photo (file dialog or drop): creates the project, starts the model, opens it. */
export function useAddPhoto(): {
  addPath(path: string): Promise<void>
  choose(): Promise<void>
} {
  const navigate = useNavigate()
  const addPhoto = useStore((state) => state.addPhoto)

  async function addPath(path: string): Promise<void> {
    const id = await addPhoto(path)
    if (id) navigate(`/project/${id}`)
  }

  async function choose(): Promise<void> {
    const path = await window.api.photo.choose()
    if (path) await addPath(path)
  }

  return { addPath, choose }
}
