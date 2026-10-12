import { useMemo, useRef, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { ElementRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Model } from '../hooks/useModel'
import { plateSize, viewerToStl } from '../lib/stl'
import { useStore } from '../store'
import './Viewer3D.css'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function watchTheme(callback: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

/** Scene colours come from the theme variables, so the 3D view follows light and dark. */
function useSceneColors(): Record<'bg' | 'plate' | 'model' | 'cell' | 'section' | 'accent', string> {
  const dark = useSyncExternalStore(watchTheme, () => window.matchMedia(DARK_QUERY).matches)
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement)
    const read = (name: string): string => style.getPropertyValue(name).trim()
    return {
      bg: read('--scene-bg'),
      plate: read('--scene-plate'),
      model: read('--scene-model'),
      cell: read('--scene-grid-cell'),
      section: read('--scene-grid-section'),
      accent: read('--accent')
    }
    // the variables change with the system theme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark])
}

// a click that moved more than this (px) was a drag to rotate, not a pick
const CLICK_SLOP = 4

/** The picked area starts at about this share of the model's height. */
export function defaultPartRadius(height: number): number {
  return Math.max(2, Math.round(height * 0.12))
}

/**
 * Orbit, zoom, a plate that follows the model. Double click puts the view back.
 * A click on the model picks a part for "Fix a part" and shows it as a see-through ball.
 */
export function Viewer3D({ model, projectId }: { model: Model; projectId: string }): React.JSX.Element {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const selected = useStore((state) => (state.selectedPart?.projectId === projectId ? state.selectedPart : null))
  const selectPart = useStore((state) => state.selectPart)
  const { size } = model
  const plate = plateSize(size)
  const colors = useSceneColors()

  const view = useMemo(() => {
    const reach = Math.max(size.x, size.y, size.z) * 2.6
    return {
      position: [reach * 0.8, reach * 0.6, reach] as [number, number, number],
      target: [0, size.y / 2, 0] as [number, number, number]
    }
  }, [size])

  function pick(event: ThreeEvent<MouseEvent>): void {
    if (event.delta > CLICK_SLOP) return
    event.stopPropagation()
    const { x, y, z } = event.point
    selectPart({
      projectId,
      view: [x, y, z],
      stl: viewerToStl([x, y, z], model.offset),
      radius: selected?.radius ?? defaultPartRadius(size.y)
    })
  }

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
        <color attach="background" args={[colors.bg]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 2, 1.5]} intensity={2.4} />
        <directionalLight position={[-2, 1, -1]} intensity={0.8} />

        <mesh geometry={model.geometry} onClick={pick}>
          <meshStandardMaterial color={colors.model} roughness={0.6} metalness={0.05} />
        </mesh>

        {selected && (
          <group position={selected.view}>
            <mesh renderOrder={1}>
              <sphereGeometry args={[selected.radius, 32, 16]} />
              <meshBasicMaterial color={colors.accent} transparent opacity={0.28} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[Math.max(0.6, selected.radius * 0.06), 16, 8]} />
              <meshBasicMaterial color={colors.accent} />
            </mesh>
          </group>
        )}

        <mesh position={[0, -1, 0]}>
          <boxGeometry args={[plate, 2, plate]} />
          <meshStandardMaterial color={colors.plate} roughness={0.9} />
        </mesh>
        <Grid
          args={[plate, plate]}
          position={[0, 0.02, 0]}
          cellSize={10}
          sectionSize={50}
          cellColor={colors.cell}
          sectionColor={colors.section}
          fadeDistance={plate * 4}
          side={2}
        />

        <OrbitControls ref={controls} makeDefault enableDamping target={view.target} maxPolarAngle={Math.PI * 0.52} />
      </Canvas>
      <div className="viewer-hint">
        Click a part to fix it · drag to rotate · scroll to zoom · double click to reset
      </div>
    </div>
  )
}
