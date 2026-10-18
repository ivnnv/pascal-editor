import {
  type AlignmentGuide,
  type AnyNode,
  type AnyNodeId,
  getMaterialPresetByRef,
  type PlanSnapTarget,
  type PlanTranslateSnap,
  parseMaterialColor,
  parseMaterialRef,
  planWallEndRejoins,
  resolveMaterial,
  resolvePlanPointSnap,
  resolvePlanTranslateSnap,
  type SceneMaterialId,
  useScene,
  type WallMoveAxis,
  type WallMoveBridgePlan,
  type WallNode,
  type WallPlanPoint,
  WallNode as WallSchema,
  type WallTopologyChanges,
  wallPlanSnapLines,
  wallPlanSnapTargets,
} from '@pascal-app/core'
import {
  getPlanSnapScale,
  isSegmentLongEnough,
  planSnapReach,
  snapScalarToGrid,
  softSnapScalar,
} from '@pascal-app/editor'
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

// The same pull in screen pixels while the plan is shown, capped at 10 cm.
const WALL_MOVE_ALIGN_REACH_PX = 16

/** The alignment pull at the plan's zoom, never past `WALL_MOVE_ALIGN_TOLERANCE`. */
export function wallMoveAlignTolerance(): number {
  const metresPerPixel = getPlanSnapScale()
  return metresPerPixel
    ? planSnapReach(WALL_MOVE_ALIGN_REACH_PX, metresPerPixel, WALL_MOVE_ALIGN_TOLERANCE)
    : WALL_MOVE_ALIGN_TOLERANCE
}

export type WallMoveSnap = { offset: number; snap: PlanTranslateSnap | null }

/**
 * The sideways offset for a wall dragged `rawOffset` along `axis`: back to
 * where it started, or with its reference line or either face lined up with
 * a target, whichever is nearest within reach; otherwise on the grid.
 */
export function snapWallMove(args: {
  wall: Pick<WallNode, 'id' | 'start' | 'end' | 'thickness' | 'justification' | 'curveOffset'>
  axis: WallMoveAxis
  rawOffset: number
  targets: readonly PlanSnapTarget[]
  gridStep: number
  softGrid?: boolean
}): WallMoveSnap {
  const reach = wallMoveAlignTolerance()
  const snap = resolvePlanTranslateSnap({
    axis: args.axis,
    lines: wallPlanSnapLines(args.wall),
    offset: args.rawOffset,
    targets: args.targets,
    reach,
  })
  const backToStart = Math.abs(args.rawOffset)
  if (backToStart <= reach && (!snap || backToStart <= Math.abs(snap.offset - args.rawOffset))) {
    return { offset: 0, snap: null }
  }
  if (snap) return { offset: snap.offset, snap }
  const originalProjection = args.wall.start[0] * args.axis[0] + args.wall.start[1] * args.axis[1]
  const projection = snapWallMoveProjection(
    originalProjection + args.rawOffset,
    args.gridStep,
    args.softGrid,
  )
  return { offset: projection - originalProjection, snap: null }
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
  const nearX = Math.abs(rawPoint[0] - origin[0]) <= wallMoveAlignTolerance()
  const nearZ = Math.abs(rawPoint[1] - origin[1]) <= wallMoveAlignTolerance()
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
  walls: readonly Pick<
    WallNode,
    'id' | 'start' | 'end' | 'curveOffset' | 'thickness' | 'justification'
  >[],
): WallExtensionSnap | null {
  const targets = walls.flatMap((wall) =>
    wallPlanSnapTargets(wall).filter((target) => target.kind === 'ray'),
  )
  const reach = wallMoveAlignTolerance()
  const holdsX = placedPoint[0] === origin[0]
  const holdsZ = placedPoint[1] === origin[1]
  const resolve = (along: { point: WallPlanPoint; direction: WallPlanPoint } | null) =>
    resolvePlanPointSnap({
      raw: rawPoint,
      placed: placedPoint,
      along,
      targets,
      reach,
      maxShift: 3 * reach,
    })
  // A corner held on its starting x / z line lands where that line crosses the continuation.
  const snap =
    holdsX || holdsZ
      ? resolve({ point: origin, direction: holdsX ? [0, 1] : [1, 0] })
      : resolve(null)
  if (snap?.target.kind !== 'ray') return null
  const { point, target } = snap
  const from = target.origin
  const runsAlongX = Math.abs(target.direction[0]) >= Math.abs(target.direction[1])
  return {
    point,
    guide: {
      axis: runsAlongX ? 'z' : 'x',
      coord: runsAlongX ? point[1] : point[0],
      from: { x: from[0], z: from[1] },
      to: { x: point[0], z: point[1] },
      anchor: { x: from[0], z: from[1] },
      movingAnchorKind: 'corner',
      candidateAnchorKind: 'corner',
      candidateNodeId: target.nodeId,
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
  let bestDistance = wallMoveAlignTolerance()
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
 * Snaps a projection onto the grid (`gridStep <= 0` keeps it raw). `softGrid`
 * (Smart mode) only pulls onto a grid line when it is close.
 */
export function snapWallMoveProjection(
  rawProjection: number,
  gridStep: number,
  softGrid = false,
): number {
  const gridValue = snapScalarToGrid(rawProjection, gridStep)
  return softGrid ? softSnapScalar(rawProjection, gridValue) : gridValue
}

/**
 * Drop-time rejoins for a wall moved sideways. A rejoin that would turn the
 * moved wall off its line (one end pulled onto a nearby corner) is dropped,
 * so the wall lands where the drag put it; the other walls still rejoin.
 */
export function planSidewaysMoveRejoins(
  nodes: Readonly<Record<string, AnyNode>>,
  wallId: string,
  wallIds: readonly string[],
  radius: number,
  changes: WallTopologyChanges,
): WallTopologyChanges {
  const all = planWallEndRejoins(nodes, wallIds, radius, changes)
  const original = nodes[wallId]
  const moved = all.update.find((entry) => entry.id === wallId)?.data as
    | Partial<WallNode>
    | undefined
  if (original?.type !== 'wall' || !moved?.start || !moved.end) return all
  const ox = original.end[0] - original.start[0]
  const oz = original.end[1] - original.start[1]
  const mx = moved.end[0] - moved.start[0]
  const mz = moved.end[1] - moved.start[1]
  const turn = Math.abs(ox * mz - oz * mx) / (Math.hypot(ox, oz) * Math.hypot(mx, mz) || 1)
  if (turn < 1e-9) return all
  return planWallEndRejoins(
    nodes,
    wallIds.filter((id) => id !== wallId),
    radius,
    changes,
  )
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
