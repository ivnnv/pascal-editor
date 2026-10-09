'use client'

import {
  type AnyNodeId,
  getWallCurveFrameAt,
  getWallFaceOffsets,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type FloorplanToolContext, useFloorplanRender } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useId, useMemo } from 'react'
import { findJoinedWalls, type WallJoin } from './joined-walls'

// Points per stretch of an outline, enough for a curved wall to read as one.
const SAMPLES = 12

/**
 * Outlines the walls joined to the selected one, strongest where they meet it
 * and fading toward their far ends, so it is clear which walls share a joint.
 */
export default function WallJoinedWallsLayer(_props: FloorplanToolContext) {
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )
  const nodes = useScene((s) => s.nodes)
  const context = useFloorplanRender()
  const idPrefix = useId()
  const joins = useMemo(() => {
    const wall = selectedId ? nodes[selectedId as AnyNodeId] : undefined
    if (wall?.type !== 'wall') return []
    const walls = Object.values(nodes).filter((node): node is WallNode => node?.type === 'wall')
    return findJoinedWalls(wall, walls)
  }, [nodes, selectedId])
  if (joins.length === 0) return null
  const upp = context?.unitsPerPixel ?? 0.01
  const color = context?.palette.selectedStroke ?? '#3b82f6'
  return (
    <g data-testid="pascal-joined-walls-2d" pointerEvents="none">
      {joins.flatMap((join, index) =>
        stretches(join).map((stretch, part) => {
          const id = `${idPrefix}-${index}-${part}`
          return (
            <g key={id}>
              <defs>
                <linearGradient
                  gradientUnits="userSpaceOnUse"
                  id={id}
                  x1={stretch.from.x}
                  x2={stretch.to.x}
                  y1={stretch.from.y}
                  y2={stretch.to.y}
                >
                  <stop offset="0" stopColor={color} stopOpacity={0.95} />
                  <stop offset="1" stopColor={color} stopOpacity={0.08} />
                </linearGradient>
              </defs>
              {stretch.faces.map((points, face) => (
                <polyline
                  fill="none"
                  key={face}
                  points={points}
                  stroke={`url(#${id})`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5 * upp}
                />
              ))}
            </g>
          )
        }),
      )}
    </g>
  )
}

/** The wall from the joint to each of its ends that lies away from it, as both face lines. */
function stretches({ wall, at }: WallJoin) {
  const { a, b } = getWallFaceOffsets(wall)
  return [1, 0]
    .filter((end) => Math.abs(end - at) > 1e-3)
    .map((end) => {
      const frames = Array.from({ length: SAMPLES + 1 }, (_, i) =>
        getWallCurveFrameAt(wall, at + ((end - at) * i) / SAMPLES),
      )
      const face = (offset: number) =>
        frames
          .map(
            ({ point, normal }) => `${point.x + normal.x * offset},${point.y + normal.y * offset}`,
          )
          .join(' ')
      return {
        from: frames[0]!.point,
        to: frames[SAMPLES]!.point,
        faces: [face(a), face(b)],
      }
    })
}
