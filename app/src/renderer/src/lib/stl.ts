import { BufferGeometry } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

export interface ModelSize {
  /** Millimetres, in the viewer's axes: x = width, y = height (up), z = depth. */
  x: number
  y: number
  z: number
}

/**
 * Turns the engine's STL (Z up, bottom at 0) into a geometry for the viewer:
 * Y up, centred left-right and front-back, standing on y = 0.
 */
export function loadModel(data: ArrayBuffer | Uint8Array): { geometry: BufferGeometry; size: ModelSize } {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const geometry = new STLLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) throw new Error('The model has no shape.')
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  const size = { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z }
  return { geometry, size }
}

/** Plate side in mm: follows the model (no printer), a little bigger, rounded up to 10. */
export function plateSize(size: ModelSize): number {
  const wide = Math.max(size.x, size.z)
  return Math.max(40, Math.ceil((wide * 1.8) / 10) * 10)
}
