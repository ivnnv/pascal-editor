'use client'

import {
  calculateLevelMiters,
  getWallPlanFootprint,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useEffect, useMemo, useState } from 'react'
import { useFloorplanRender } from './floorplan-render-context'

// AIKAZA: every move pauses the scene history, whatever tool runs it, so the walls as they were
// at that pause are the "before" of the gesture. Any of them whose live geometry has since
// changed is drawn as a faint ghost where it started, until history resumes.

type WallSnapshot = Pick<WallNode, 'id' | 'start' | 'end' | 'thickness'>

function useWallsAtHistoryPause(levelId: string | null): Record<string, WallNode> | null {
  const [snapshot, setSnapshot] = useState<Record<string, WallNode> | null>(null)
  useEffect(() => {
    const take = () => {
      const walls: Record<string, WallNode> = {}
      for (const node of Object.values(useScene.getState().nodes)) {
        if (node?.type === 'wall' && (node.parentId ?? null) === levelId) walls[node.id] = node
      }
      return walls
    }
    if (!useScene.temporal.getState().isTracking) setSnapshot(take())
    return useScene.temporal.subscribe((state, previous) => {
      if (state.isTracking === previous.isTracking) return
      setSnapshot(state.isTracking ? null : take())
    })
  }, [levelId])
  return snapshot
}

const moved = (before: WallSnapshot, now: WallSnapshot) =>
  before.start[0] !== now.start[0] ||
  before.start[1] !== now.start[1] ||
  before.end[0] !== now.end[0] ||
  before.end[1] !== now.end[1] ||
  before.thickness !== now.thickness

export const FloorplanMoveGhostLayer = memo(function FloorplanMoveGhostLayer() {
  const levelId = useViewer((s) => s.selection.levelId)
  const snapshot = useWallsAtHistoryPause(levelId ?? null)
  const nodes = useScene((s) => s.nodes)
  const overrides = useLiveNodeOverrides((s) => s.overrides)
  const upp = useFloorplanRender()?.unitsPerPixel ?? 0.01

  const outlines = useMemo(() => {
    if (!snapshot) return []
    const ids = Object.keys(snapshot).filter((id) => {
      const live = nodes[id as WallNode['id']]
      if (live?.type !== 'wall') return false
      const patch = overrides.get(id) as Partial<WallSnapshot> | undefined
      return moved(snapshot[id] as WallNode, { ...live, ...patch } as WallSnapshot)
    })
    if (ids.length === 0) return []
    const miters = calculateLevelMiters(Object.values(snapshot))
    return ids.map((id) =>
      getWallPlanFootprint(snapshot[id] as WallNode, miters)
        .map((p) => `${p.x},${p.y}`)
        .join(' '),
    )
  }, [snapshot, nodes, overrides])

  if (outlines.length === 0) return null
  return (
    <g data-floorplan-move-ghost pointerEvents="none">
      {outlines.map((points) => (
        <polygon
          fill="#94a3b8"
          fillOpacity={0.22}
          key={points}
          points={points}
          stroke="#94a3b8"
          strokeDasharray={`${4 * upp} ${3 * upp}`}
          strokeOpacity={0.6}
          strokeWidth={upp}
        />
      ))}
    </g>
  )
})
