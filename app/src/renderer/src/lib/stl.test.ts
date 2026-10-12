import { describe, expect, it } from 'vitest'
import { loadModel, plateSize, viewerToStl, type Vec3 } from './stl'

/** Binary STL of a box with its corner at (10, 20, 5) and size 4 x 6 x 30 (Z is the tall side). */
function boxStl(): Uint8Array {
  const [x0, y0, z0, w, d, h] = [10, 20, 5, 4, 6, 30]
  const corners = [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => [x0 + i * w, y0 + j * d, z0 + k * h])))
  const faces = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
    [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
    [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]
  ]
  const buffer = new ArrayBuffer(84 + faces.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, faces.length, true)
  faces.forEach((face, index) => {
    const base = 84 + index * 50 + 12 // skip the normal
    face.forEach((corner, v) =>
      corners[corner].forEach((value, axis) => view.setFloat32(base + (v * 3 + axis) * 4, value, true))
    )
  })
  return new Uint8Array(buffer)
}

describe('loadModel', () => {
  it('stands the model up (Y up), centred, on the plate', () => {
    const { geometry, size } = loadModel(boxStl())
    expect(size.x).toBeCloseTo(4)
    expect(size.y).toBeCloseTo(30) // the tall side is now up
    expect(size.z).toBeCloseTo(6)

    const box = geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0)
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0)
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0)
  })

  it('maps a point in the viewer back to the STL millimetres', () => {
    const { geometry, offset } = loadModel(boxStl())
    const positions = geometry.getAttribute('position')
    const mapped: Vec3[] = []
    for (let i = 0; i < positions.count; i++) {
      mapped.push(viewerToStl([positions.getX(i), positions.getY(i), positions.getZ(i)], offset))
    }
    const low = [0, 1, 2].map((axis) => Math.min(...mapped.map((p) => p[axis])))
    const high = [0, 1, 2].map((axis) => Math.max(...mapped.map((p) => p[axis])))
    low.forEach((value, axis) => expect(value).toBeCloseTo([10, 20, 5][axis], 4))
    high.forEach((value, axis) => expect(value).toBeCloseTo([14, 26, 35][axis], 4))
  })

  it('rejects an empty file', () => {
    expect(() => loadModel(new Uint8Array(0))).toThrow()
  })
})

describe('plateSize', () => {
  it('follows the model and is never tiny', () => {
    expect(plateSize({ x: 4, y: 30, z: 6 })).toBe(40)
    expect(plateSize({ x: 23, y: 80, z: 18 })).toBe(50)
    expect(plateSize({ x: 100, y: 10, z: 60 })).toBe(180)
  })
})
