import { useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { ElementRef } from 'react'
import type { Model } from '../hooks/useModel'
import { plateSize } from '../lib/stl'
import './Viewer3D.css'

const MODEL_COLOR = '#d4d4da'

/** Orbit, zoom, a plate that follows the model. Double click puts the view back. */
export function Viewer3D({ model }: { model: Model }): React.JSX.Element {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const { size } = model
  const plate = plateSize(size)

  const view = useMemo(() => {
    const reach = Math.max(size.x, size.y, size.z) * 2.6
    return {
      position: [reach * 0.8, reach * 0.6, reach] as [number, number, number],
      target: [0, size.y / 2, 0] as [number, number, number]
    }
  }, [size])

  function resetView(): void {
    const orbit = controls.current
    if (!orbit) return
    orbit.object.position.set(...view.position)
    orbit.target.set(...view.target)
    orbit.update()
  }

  return (
    <div className="viewer" onDoubleClick={resetView}>
      <Canvas camera={{ position: view.position, fov: 35, near: 1, far: 5000 }} dpr={[1, 2]}>
        <color attach="background" args={['#161618']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 2, 1.5]} intensity={2.4} />
        <directionalLight position={[-2, 1, -1]} intensity={0.8} />

        <mesh geometry={model.geometry}>
          <meshStandardMaterial color={MODEL_COLOR} roughness={0.6} metalness={0.05} />
        </mesh>

        <mesh position={[0, -1, 0]}>
          <boxGeometry args={[plate, 2, plate]} />
          <meshStandardMaterial color="#222226" roughness={0.9} />
        </mesh>
        <Grid
          args={[plate, plate]}
          position={[0, 0.02, 0]}
          cellSize={10}
          sectionSize={50}
          cellColor="#34343a"
          sectionColor="#4a4a52"
          fadeDistance={plate * 4}
          side={2}
        />

        <OrbitControls ref={controls} makeDefault enableDamping target={view.target} maxPolarAngle={Math.PI * 0.52} />
      </Canvas>
      <div className="viewer-hint">Drag to rotate · scroll to zoom</div>
    </div>
  )
}
