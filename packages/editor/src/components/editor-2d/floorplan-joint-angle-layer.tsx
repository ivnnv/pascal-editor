'use client'

import { useEffect } from 'react'
import useJointAngle from '../../store/use-joint-angle'
import { useFloorplanRender } from './floorplan-render-context'

/** The "90°" badge in the corner a wall makes with the one it joins, while it sits on that angle. */
export function FloorplanJointAngleLayer() {
  const angles = useJointAngle((s) => s.angles)
  const ctx = useFloorplanRender()
  // The badge belongs to the drag or draft in progress; releasing ends it.
  useEffect(() => {
    const clear = () => useJointAngle.getState().set([])
    window.addEventListener('pointerup', clear)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('pointerup', clear)
      window.removeEventListener('blur', clear)
    }
  }, [])
  if (angles.length === 0) return null
  const upp = ctx?.unitsPerPixel ?? 0.01
  const sceneRot = ctx?.sceneRotationDeg ?? 0
  return (
    <g data-testid="floorplan-joint-angle" pointerEvents="none">
      {angles.map((angle, index) => {
        // Past the inner corner of the walls, with room for the badge itself.
        const offset = angle.clearance + 24 * upp
        const cx = angle.x + angle.bisector.x * offset
        const cz = angle.z + angle.bisector.z * offset
        return (
          <g key={`${index}:${angle.x}:${angle.z}`}>
            <circle
              cx={cx}
              cy={cz}
              fill="var(--toggle-on, #8b5cf6)"
              fillOpacity={0.95}
              r={15 * upp}
            />
            <text
              fill="#ffffff"
              fontFamily="-apple-system, system-ui, sans-serif"
              fontSize={10 * upp}
              fontWeight={600}
              textAnchor="middle"
              transform={`rotate(${-sceneRot} ${cx} ${cz})`}
              x={cx}
              y={cz + 3.5 * upp}
            >
              {`${angle.deg}°`}
            </text>
          </g>
        )
      })}
    </g>
  )
}
