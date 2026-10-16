import {
  type AlignmentGuide,
  type AnyNodeId,
  getMaterialPresetByRef,
  isCurvedWall,
  parseMaterialColor,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterialId,
  useScene,
  type WallMoveAxis,
  type WallMoveBridgePlan,
  type WallNode,
  type WallPlanPoint,
  WallNode as WallSchema,
} from '@pascal-app/core'
import { isSegmentLongEnough, snapScalarToGrid, softSnapScalar } from '@pascal-app/editor'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'

/**
 * Pure helpers shared by the 3D `MoveWallTool` and the 2D
 * `wallFloorplanMoveTarget`. Lives in `packages/nodes` because the
 * bridge / ghost helpers depend on `WallSchema.parse` and material
 * preset resolution; kept React-free so both call sites can import
 * cleanly.
 */

const POINT_EPSILON = 1e-6

/** How close (m) a sideways wall drag must get to an alignment line to snap onto it. */
export const WALL_MOVE_ALIGN_TOLERANCE = 0.1

/**
 * Positions along `axis` a sideways wall drag aligns to: the wall's own
 * starting line, plus the line through every endpoint of the other walls.
 */
export function getWallMoveAlignTargets(
  originalProjection: number,
  axis: WallMoveAxis,
  otherWalls: ReadonlyArray<Pick<WallNode, 'start' | 'end'>>,
): number[] {
  const targets = [originalProjection]
  for (const wall of otherWalls) {
    for (const point of [wall.start, wall.end]) {
      targets.push(point[0] * axis[0] + point[1] * axis[1])
    }
  }
  return targets
}

/**
 * Lets a dragged wall corner land back on where it started, or stay on its
 * starting x / z line, when the raw cursor is within the align tolerance.
 */
export function snapWallEndpointToOrigin(
  rawPoint: WallPlanPoint,
  snappedPoint: WallPlanPoint,
  origin: WallPlanPoint,
): WallPlanPoint {
  const nearX = Math.abs(rawPoint[0] - origin[0]) <= WALL_MOVE_ALIGN_TOLERANCE
  const nearZ = Math.abs(rawPoint[1] - origin[1]) <= WALL_MOVE_ALIGN_TOLERANCE
  if (nearX && nearZ) return [origin[0], origin[1]]
  if (nearX) return [origin[0], snappedPoint[1]]
  if (nearZ) return [snappedPoint[0], origin[1]]
  return snappedPoint
}

/** A dragged corner pulled onto the line that continues another wall past its end. */
export type WallExtensionSnap = { point: WallPlanPoint; guide: AlignmentGuide }

/**
 * Pulls a dragged corner onto the nearest wall's continuation (its line past
 * either end) when the raw cursor is within the align tolerance of it. A
 * corner held on its starting x / z line lands where that line crosses the
 * continuation, which is what makes a clean T.
 */
export function snapWallEndpointToExtension(
  rawPoint: WallPlanPoint,
  placedPoint: WallPlanPoint,
  origin: WallPlanPoint,
  walls: readonly Pick<WallNode, 'id' | 'start' | 'end' | 'curveOffset'>[],
): WallExtensionSnap | null {
  let best: {
    wall: Pick<WallNode, 'id' | 'start' | 'end'>
    ux: number
    uz: number
    past: 'start' | 'end'
  } | null = null
  let bestDistance = WALL_MOVE_ALIGN_TOLERANCE
  for (const wall of walls) {
    // A curved wall does not continue along its chord.
    if (isCurvedWall(wall)) continue
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    if (length < POINT_EPSILON) continue
    const ux = dx / length
    const uz = dz / length
    const rx = rawPoint[0] - wall.start[0]
    const rz = rawPoint[1] - wall.start[1]
    const along = rx * ux + rz * uz
    // On the wall's own body the wall snap already holds it.
    if (along >= 0 && along <= length) continue
    const distance = Math.abs(rx * uz - rz * ux)
    if (distance > bestDistance) continue
    bestDistance = distance
    best = { wall, ux, uz, past: along < 0 ? 'start' : 'end' }
  }
  if (!best) return null
  const { wall, ux, uz, past } = best
  const keepsX = placedPoint[0] === origin[0] && Math.abs(ux) > 1e-6
  const keepsZ = placedPoint[1] === origin[1] && Math.abs(uz) > 1e-6
  const along = keepsX
    ? (origin[0] - wall.start[0]) / ux
    : keepsZ
      ? (origin[1] - wall.start[1]) / uz
      : (placedPoint[0] - wall.start[0]) * ux + (placedPoint[1] - wall.start[1]) * uz
  const point: WallPlanPoint = [wall.start[0] + ux * along, wall.start[1] + uz * along]
  // A crossing far from the cursor is not what the user is reaching for.
  if (Math.hypot(point[0] - rawPoint[0], point[1] - rawPoint[1]) > 3 * WALL_MOVE_ALIGN_TOLERANCE) {
    return null
  }
  const from = past === 'start' ? wall.start : wall.end
  return {
    point,
    guide: {
      axis: Math.abs(ux) >= Math.abs(uz) ? 'z' : 'x',
      coord: Math.abs(ux) >= Math.abs(uz) ? point[1] : point[0],
      from: { x: from[0], z: from[1] },
      to: { x: point[0], z: point[1] },
      anchor: { x: from[0], z: from[1] },
      movingAnchorKind: 'corner',
      candidateAnchorKind: 'corner',
      candidateNodeId: wall.id,
      distance: 0,
    },
  }
}

/** A line a dragged corner may also land on: through `point`, along `along`. */
export type CornerLine = { point: WallPlanPoint; along: WallPlanPoint; guide?: AlignmentGuide }

/**
 * A corner whose wall direction an angle snap fixed: it stays on the ray from
 * `fixed` along `direction`, at the nearest crossing with one of `lines`
 * within the align tolerance of `snapped` (its own place on that ray), so it
 * lands on both exactly. With no crossing in reach it stays at `snapped`.
 */
export function resolveDirectedCorner(
  fixed: WallPlanPoint,
  direction: WallPlanPoint,
  snapped: WallPlanPoint,
  lines: readonly CornerLine[],
): { point: WallPlanPoint; line: CornerLine | null } {
  let best: { point: WallPlanPoint; line: CornerLine } | null = null
  let bestDistance = WALL_MOVE_ALIGN_TOLERANCE
  for (const line of lines) {
    // fixed + direction * t = line.point + line.along * u
    const cross = direction[0] * line.along[1] - direction[1] * line.along[0]
    if (Math.abs(cross) < 1e-6) continue
    const dx = line.point[0] - fixed[0]
    const dz = line.point[1] - fixed[1]
    const t = (dx * line.along[1] - dz * line.along[0]) / cross
    if (t <= 0) continue
    const point: WallPlanPoint = [fixed[0] + direction[0] * t, fixed[1] + direction[1] * t]
    const distance = Math.hypot(point[0] - snapped[0], point[1] - snapped[1])
    if (distance <= bestDistance) {
      best = { point, line }
      bestDistance = distance
    }
  }
  return best ?? { point: snapped, line: null }
}

/**
 * Snaps a projection onto the nearest alignment target within
 * `WALL_MOVE_ALIGN_TOLERANCE`, else onto the grid (`gridStep <= 0` keeps it raw).
 * `softGrid` (Smart mode) only pulls onto a grid line when it is close.
 */
export function snapWallMoveProjection(
  rawProjection: number,
  alignTargets: readonly number[],
  gridStep: number,
  softGrid = false,
): number {
  let best: number | null = null
  let bestDistance = WALL_MOVE_ALIGN_TOLERANCE
  for (const target of alignTargets) {
    const distance = Math.abs(rawProjection - target)
    if (distance <= bestDistance) {
      best = target
      bestDistance = distance
    }
  }
  if (best !== null) return best
  const gridValue = snapScalarToGrid(rawProjection, gridStep)
  return softGrid ? softSnapScalar(rawProjection, gridValue) : gridValue
}

export function samePoint(a: WallPlanPoint, b: WallPlanPoint) {
  return Math.abs(a[0] - b[0]) <= POINT_EPSILON && Math.abs(a[1] - b[1]) <= POINT_EPSILON
}

function pointKey(point: WallPlanPoint) {
  return `${point[0]}:${point[1]}`
}

export function stripWallIsNewMetadata(meta: WallNode['metadata']): WallNode['metadata'] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return meta
  }

  const nextMeta = { ...(meta as Record<string, unknown>) } as Record<string, unknown>
  delete nextMeta.isNew
  return nextMeta as WallNode['metadata']
}

export type LinkedWallSnapshot = WallNode

/**
 * Walls in the same level that share an endpoint with the moving wall,
 * plus walls one hop further out that share an endpoint with a
 * directly-linked wall — needed so the junction planner can resolve
 * pivot-point context when a same-direction wall is consumed.
 */
export function getLinkedWallSnapshots(args: {
  wallId: WallNode['id']
  wallParentId: string | null
  originalStart: WallPlanPoint
  originalEnd: WallPlanPoint
}): LinkedWallSnapshot[] {
  const { wallId, wallParentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node?.type === 'wall' && node.id !== wallId && (node.parentId ?? null) === wallParentId,
  )
  const directlyLinkedWalls = walls.filter(
    (wall) =>
      samePoint(wall.start, originalStart) ||
      samePoint(wall.start, originalEnd) ||
      samePoint(wall.end, originalStart) ||
      samePoint(wall.end, originalEnd),
  )
  const contextPoints = new Set([pointKey(originalStart), pointKey(originalEnd)])

  for (const wall of directlyLinkedWalls) {
    contextPoints.add(pointKey(wall.start))
    contextPoints.add(pointKey(wall.end))
  }

  const snapshots: LinkedWallSnapshot[] = []
  const seenWallIds = new Set<WallNode['id']>()

  for (const node of walls) {
    if (!contextPoints.has(pointKey(node.start)) && !contextPoints.has(pointKey(node.end))) {
      continue
    }

    if (seenWallIds.has(node.id)) {
      continue
    }
    seenWallIds.add(node.id)

    snapshots.push({
      ...node,
      start: [...node.start] as [number, number],
      end: [...node.end] as [number, number],
      children: [...(node.children ?? [])],
    })
  }

  return snapshots
}

function wallSegmentExists(
  walls: Array<Pick<WallNode, 'start' | 'end' | 'parentId'>>,
  start: WallPlanPoint,
  end: WallPlanPoint,
  parentId: WallNode['parentId'],
) {
  return walls.some(
    (wall) =>
      wall.parentId === parentId &&
      ((samePoint(wall.start, start) && samePoint(wall.end, end)) ||
        (samePoint(wall.start, end) && samePoint(wall.end, start))),
  )
}

// Resolve a wall slot ref (`library:`/`scene:`) or colour to a swatch colour,
// or undefined when the ref is absent / dangling / colourless.
function resolveWallSlotRefColor(ref: string | undefined): string | undefined {
  const color = parseMaterialColor(ref)
  if (color) return color
  const parsed = parseMaterialRef(ref)
  if (!parsed) return undefined
  if (parsed.kind === 'library') {
    return getMaterialPresetByRef(ref)?.mapProperties.color ?? undefined
  }
  const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
  return sceneMaterial ? resolveMaterial(sceneMaterial.material).color : undefined
}

export function getWallGhostColor(wall: WallNode) {
  const slotColor = resolveWallSlotRefColor(wall.slots?.a) ?? resolveWallSlotRefColor(wall.slots?.b)
  if (slotColor) {
    return slotColor
  }

  const legacy = wall.legacyFaceMaterials
  const presetColor =
    getMaterialPresetByRef(wall.materialPreset)?.mapProperties.color ??
    getMaterialPresetByRef(legacy?.a?.materialPreset)?.mapProperties.color ??
    getMaterialPresetByRef(legacy?.b?.materialPreset)?.mapProperties.color

  if (presetColor) {
    return presetColor
  }

  return resolveMaterial(wall.material ?? legacy?.a?.material ?? legacy?.b?.material).color
}

export function getWallsAfterUpdates(
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  updates: Array<{ id: AnyNodeId; data: Partial<WallNode> }>,
): WallNode[] {
  const updateById = new Map(updates.map((update) => [update.id, update.data]))

  return Object.values(nodes)
    .filter((node): node is WallNode => node?.type === 'wall')
    .map((wall) => {
      const update = updateById.get(wall.id as AnyNodeId)
      return update ? ({ ...wall, ...update } as WallNode) : wall
    })
}

export function buildBridgeWallCreates(args: {
  bridgePlans: Array<WallMoveBridgePlan<LinkedWallSnapshot>>
  nextStart: WallPlanPoint
  nextEnd: WallPlanPoint
  existingWalls: WallNode[]
  wallCount: number
}): Array<{ node: WallNode; parentId?: AnyNodeId }> {
  const { bridgePlans, nextStart, nextEnd, existingWalls, wallCount } = args
  const wallsForDuplicateCheck = [...existingWalls]
  const creates: Array<{ node: WallNode; parentId?: AnyNodeId }> = []

  for (const plan of bridgePlans) {
    const nextPoint = plan.movedEndpoint === 'start' ? nextStart : nextEnd

    if (!isSegmentLongEnough(plan.originalPoint, nextPoint)) {
      continue
    }

    if (
      wallSegmentExists(wallsForDuplicateCheck, plan.originalPoint, nextPoint, plan.wall.parentId)
    ) {
      continue
    }

    const { id: _id, parentId: _parentId, children: _children, ...sourceWall } = plan.wall
    const bridgeWall = WallSchema.parse({
      ...sourceWall,
      name: `Wall ${wallCount + creates.length + 1}`,
      start: plan.originalPoint,
      end: nextPoint,
      children: [],
      metadata: stripWallIsNewMetadata(plan.wall.metadata),
    })

    creates.push({
      node: bridgeWall,
      parentId: (plan.wall.parentId ?? undefined) as AnyNodeId | undefined,
    })
    wallsForDuplicateCheck.push({ ...bridgeWall, parentId: plan.wall.parentId })
  }

  return creates
}

export type GhostWallPreview = {
  id: string
  start: WallPlanPoint
  end: WallPlanPoint
  color: string
  height: number
}

export function buildBridgeWallPreviews(args: {
  bridgePlans: Array<WallMoveBridgePlan<LinkedWallSnapshot>>
  nextStart: WallPlanPoint
  nextEnd: WallPlanPoint
  existingWalls: WallNode[]
}): Array<{ ghost: GhostWallPreview; wall: WallNode }> {
  const { bridgePlans, nextStart, nextEnd, existingWalls } = args
  const wallsForDuplicateCheck: Array<Pick<WallNode, 'start' | 'end' | 'parentId'>> = [
    ...existingWalls,
  ]
  const previews: Array<{ ghost: GhostWallPreview; wall: WallNode }> = []

  for (const plan of bridgePlans) {
    const nextPoint = plan.movedEndpoint === 'start' ? nextStart : nextEnd

    if (!isSegmentLongEnough(plan.originalPoint, nextPoint)) {
      continue
    }

    if (
      wallSegmentExists(wallsForDuplicateCheck, plan.originalPoint, nextPoint, plan.wall.parentId)
    ) {
      continue
    }

    const { id: _id, children: _children, ...sourceWall } = plan.wall
    const wall = WallSchema.parse({
      ...sourceWall,
      name: 'Wall Preview',
      start: plan.originalPoint,
      end: nextPoint,
      children: [],
      metadata: stripWallIsNewMetadata(plan.wall.metadata),
    })
    const ghost: GhostWallPreview = {
      id: `${plan.wall.id}:${plan.movedEndpoint}:${previews.length}`,
      start: [...plan.originalPoint] as WallPlanPoint,
      end: [...nextPoint] as WallPlanPoint,
      color: getWallGhostColor(plan.wall),
      height: resolveWallOpeningCeiling(plan.wall, useScene.getState().nodes),
    }
    previews.push({ ghost, wall })
    wallsForDuplicateCheck.push(wall)
  }

  return previews
}
