import {
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  planWallInsertion,
  planWallSplitAtPoint,
  resolveWallConstruction,
  runAsSingleSceneHistoryStep,
  snapPointAlongAngleRay,
  useScene,
  type WallConstructionOptions,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { SNAP_REACH_PX } from '../../../lib/snap-reach'
import { resolveSnapFlags, SMART_ANGLE_TOLERANCE, softSnapScalar } from '../../../lib/snapping-mode'
import useEditor, { getActiveSnappingMode, isMagneticSnapActive } from '../../../store/use-editor'
import useJointAngle, { type JointAngle } from '../../../store/use-joint-angle'
import {
  distanceSquared,
  findWallSnapTarget,
  findWallSpecialPointSnap,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_ENDPOINT_SNAP_RADIUS,
  WALL_INTERSECTION_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  WALL_MIDPOINT_SNAP_RADIUS,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
  wallIdsAtSnapPoint,
} from './wall-snap-geometry'

// The pure snap geometry lives in `./wall-snap-geometry`; re-exported here so
// existing importers (fence drafting, the editor barrel) keep their paths.
export {
  chainEndJoinsExistingWall,
  findWallSnapTarget,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallDraftSnapKind,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
} from './wall-snap-geometry'

export const WALL_GRID_STEP = 0.5
export const WALL_MIN_LENGTH = 0.01

export function getSegmentGridStep(): number {
  // A 0 step means "no grid lattice" — every grid-snap consumer guards on
  // `step <= 0` and returns the raw value, so disabling grid here suppresses
  // the lattice for walls, fences, and every node move/affordance that reads
  // this choke point, without retuning their snap math.
  return resolveSnapFlags(getActiveSnappingMode()).grid ? useEditor.getState().gridSnapStep : 0
}

export function snapScalarToGrid(value: number, step = WALL_GRID_STEP): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function snapPointToGrid(point: WallPlanPoint, step = WALL_GRID_STEP): WallPlanPoint {
  return [snapScalarToGrid(point[0], step), snapScalarToGrid(point[1], step)]
}

export function resolveEndpointWallSplit(args: {
  point: WallPlanPoint
  /** Level the moved wall lives on — only its walls are split candidates. */
  levelId: string | null
  /** The moved wall + every wall receiving an endpoint update in the same commit. */
  ignoreWallIds: string[]
  /**
   * Capture radius. The endpoint already snapped onto the wall body during
   * the drag, so the tight connect radius (drop genuinely on the wall) is
   * the default.
   */
  radius?: number
}): WallPlanPoint | null {
  const { point, levelId, ignoreWallIds, radius = WALL_CONNECT_SNAP_RADIUS } = args
  const { nodes, applyNodeChanges } = useScene.getState()
  const result = planWallSplitAtPoint(nodes, {
    point,
    levelId: levelId as AnyNodeId | null,
    ignoreWallIds,
    radius,
  })
  if (!result.ok) return null
  const { plan } = result
  if (
    plan.changes.create.length > 0 ||
    plan.changes.update.length > 0 ||
    plan.changes.delete.length > 0
  ) {
    applyNodeChanges(plan.changes)
  }
  return plan.point
}

type SnapWallDraftArgs = {
  point: WallPlanPoint
  walls: WallNode[]
  start?: WallPlanPoint
  angleSnap?: boolean
  ignoreWallIds?: string[]
  bypassSnap?: boolean
  /** Override the grid step. */
  step?: number
  /**
   * Magnetic snapping to existing wall geometry (corners, midpoints,
   * crossings, wall bodies). When `false`, only grid/angle snap applies and
   * `snap` is always `null`. Defaults to `true` so callers that don't care
   * keep the prior behaviour.
   */
  magnetic?: boolean
  /**
   * Optional grid-snap override. Lets the caller route grid snapping
   * through a world-XZ aligned snap (so a rotated building's draft
   * lands on the visible grid). When omitted, falls back to the
   * local-axis grid at `step`.
   */
  gridSnap?: (point: WallPlanPoint) => WallPlanPoint
  /** Optional magnetic snap radii. Omitted means wall tools keep their defaults. */
  snapRadii?: WallSnapRadii
  /**
   * AIKAZA: the plan's metres per screen pixel. Given, the magnetic snaps reach
   * a fixed distance on screen (never past their usual metres).
   */
  planScale?: number | null
}

// AIKAZA: never reach less than this, so a join still lands when zoomed far in.
const MIN_PLAN_SNAP_RADIUS = 0.02

function planSnapRadii(metresPerPixel: number): WallSnapRadii {
  const reach = (px: number, usual: number) =>
    Math.min(usual, Math.max(MIN_PLAN_SNAP_RADIUS, px * metresPerPixel))
  return {
    endpoint: reach(SNAP_REACH_PX.wall.endpoint, WALL_ENDPOINT_SNAP_RADIUS),
    midpoint: reach(SNAP_REACH_PX.wall.midpoint, WALL_MIDPOINT_SNAP_RADIUS),
    intersection: reach(SNAP_REACH_PX.wall.intersection, WALL_INTERSECTION_SNAP_RADIUS),
    wall: reach(SNAP_REACH_PX.wall.wall, WALL_JOIN_SNAP_RADIUS),
  }
}

const SMART_ANGLE_STEP = Math.PI / 4

/**
 * Smart-mode placement: on a 0/45/90 ray from `start` when the segment is
 * within a few degrees of it (its length pulled onto the grid when close),
 * otherwise each coordinate pulled onto a grid line only when close.
 */
export function snapSmartDraftPoint(
  point: WallPlanPoint,
  start: WallPlanPoint | undefined,
  step: number,
  gridSnap?: (point: WallPlanPoint) => WallPlanPoint,
): WallPlanPoint {
  if (start) {
    const dx = point[0] - start[0]
    const dz = point[1] - start[1]
    if (dx !== 0 || dz !== 0) {
      const angle = Math.atan2(dz, dx)
      const rayAngle = Math.round(angle / SMART_ANGLE_STEP) * SMART_ANGLE_STEP
      if (Math.abs(angle - rayAngle) <= SMART_ANGLE_TOLERANCE) {
        const dirX = Math.cos(rayAngle)
        const dirZ = Math.sin(rayAngle)
        const along = dx * dirX + dz * dirZ
        const length = step > 0 ? softSnapScalar(along, Math.round(along / step) * step) : along
        return [start[0] + dirX * length, start[1] + dirZ * length]
      }
    }
  }
  const grid = gridSnap ? gridSnap(point) : snapPointToGrid(point, step)
  return [softSnapScalar(point[0], grid[0]), softSnapScalar(point[1], grid[1])]
}

export function snapWallDraftPointDetailed(args: SnapWallDraftArgs): WallDraftSnapResult {
  const result = snapWallDraftPointDetailedInner(args)
  const { start, walls, ignoreWallIds } = args
  // Only a draft from a corner owns the badge; other callers (cursor hover,
  // a corner drag that adds its own) must not wipe it.
  const joint =
    start && !args.bypassSnap ? jointAngleAt(start, result.point, walls, ignoreWallIds) : null
  if (start) useJointAngle.getState().set(joint ? [joint] : [])
  return result
}

// Corner angles snap in 15° steps: firmly at 45° multiples, lightly in between.
const ANGLE_STEP = Math.PI / 12
const FIRM_TOLERANCE = SMART_ANGLE_TOLERANCE
const LIGHT_TOLERANCE = SMART_ANGLE_TOLERANCE / 2

/** The tolerance a 15° step pulls with. */
const stepTolerance = (steps: number) => (steps % 3 === 0 ? FIRM_TOLERANCE : LIGHT_TOLERANCE)

/** Directions (radians) of the other walls leaving `start`, the corner being drawn from. */
function jointDirections(
  start: WallPlanPoint,
  walls: readonly WallNode[],
  ignoreWallIds?: readonly string[],
): number[] {
  const directions: number[] = []
  for (const wall of walls) {
    if (ignoreWallIds?.includes(wall.id)) continue
    const other = samePlanPoint(wall.start, start)
      ? wall.end
      : samePlanPoint(wall.end, start)
        ? wall.start
        : null
    if (other) directions.push(Math.atan2(other[1] - start[1], other[0] - start[0]))
  }
  return directions
}

const samePlanPoint = (a: WallPlanPoint, b: WallPlanPoint) =>
  Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

/**
 * Pulls `point` onto the plan's 0/45/90° axes when near one, otherwise onto a
 * 15° step relative to a wall already joined at `start` (the nearest step
 * across all such walls), so a corner squares against that wall however the
 * plan is turned.
 */
function snapToJointAngle(
  point: WallPlanPoint,
  start: WallPlanPoint,
  walls: readonly WallNode[],
  ignoreWallIds: readonly string[] | undefined,
  step: number,
): WallPlanPoint | null {
  const dx = point[0] - start[0]
  const dz = point[1] - start[1]
  if (dx === 0 && dz === 0) return null
  const angle = Math.atan2(dz, dx)
  let best: number | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  // The plan's own axes win when in reach: a neighbour a touch off square must
  // not hold the new wall off true horizontal, vertical or 45°.
  for (let k = 0; k < 8; k++) {
    const axis = k * (Math.PI / 4)
    const diff = Math.abs(wrapAngle(angle - axis))
    if (diff <= FIRM_TOLERANCE && diff < bestDiff) {
      best = axis
      bestDiff = diff
    }
  }
  const directions = best === null ? jointDirections(start, walls, ignoreWallIds) : []
  for (const direction of directions) {
    for (let k = 1; k < 24; k++) {
      const candidate = direction + k * ANGLE_STEP
      const diff = Math.abs(wrapAngle(angle - candidate))
      if (diff <= stepTolerance(k) && diff < bestDiff) {
        best = candidate
        bestDiff = diff
      }
    }
  }
  if (best === null) return null
  // Square to a neighbour that is itself a hair off an axis: take the axis.
  const axis = Math.round(best / (Math.PI / 4)) * (Math.PI / 4)
  if (Math.abs(wrapAngle(best - axis)) <= Math.PI / 180) best = axis
  const dirX = Math.cos(best)
  const dirZ = Math.sin(best)
  const along = dx * dirX + dz * dirZ
  const length = step > 0 ? softSnapScalar(along, Math.round(along / step) * step) : along
  return [start[0] + dirX * length, start[1] + dirZ * length]
}

/** Whether the wall from `from` to `to` runs exactly along a 0/45/90° plan axis. */
export function isOnPlanAxis(from: WallPlanPoint, to: WallPlanPoint): boolean {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const off = Math.abs(wrapAngle(angle - Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)))
  return Math.hypot(to[0] - from[0], to[1] - from[1]) > 1e-6 && off < 1e-6
}

/** The angle at `corner` between the walls running to `a` and to `b`, as a badge. */
export function cornerAngle(
  corner: WallPlanPoint,
  a: WallPlanPoint,
  b: WallPlanPoint,
  // The thicker of the two walls, so the badge clears their inner faces.
  thickness = 0.2,
): JointAngle | null {
  if (Math.hypot(a[0] - corner[0], a[1] - corner[1]) < 1e-6) return null
  if (Math.hypot(b[0] - corner[0], b[1] - corner[1]) < 1e-6) return null
  const ua = Math.atan2(a[1] - corner[1], a[0] - corner[0])
  const ub = Math.atan2(b[1] - corner[1], b[0] - corner[0])
  const between = Math.abs(wrapAngle(ua - ub))
  const bx = Math.cos(ua) + Math.cos(ub)
  const bz = Math.sin(ua) + Math.sin(ub)
  const length = Math.hypot(bx, bz)
  return {
    x: corner[0],
    z: corner[1],
    deg: Math.round((between * 180) / Math.PI),
    // The plan draws walls a little thicker than they are, hence the margin.
    clearance: Math.min(1, (thickness + 0.04) / 2 / Math.max(Math.sin(between / 2), 0.2)),
    // A straight run has no inside; the badge sits off to one side.
    bisector:
      length > 1e-6 ? { x: bx / length, z: bz / length } : { x: -Math.sin(ua), z: Math.cos(ua) },
  }
}

/**
 * Pulls a dragged corner onto the nearest 15° step of the angle it makes
 * between `a` and `b`: every point that sees them at one angle lies on one
 * circle through both, so the corner moves onto that circle, on its own side.
 * Null when no step is near enough.
 */
export function snapCornerToAngle(
  corner: WallPlanPoint,
  a: WallPlanPoint,
  b: WallPlanPoint,
): { point: WallPlanPoint; diff: number } | null {
  const ua = Math.atan2(a[1] - corner[1], a[0] - corner[0])
  const ub = Math.atan2(b[1] - corner[1], b[0] - corner[0])
  const between = Math.abs(wrapAngle(ua - ub))
  const steps = Math.round(between / ANGLE_STEP)
  // 180° is a straight run, the continuation snap's job.
  if (steps <= 0 || steps >= 12) return null
  const diff = Math.abs(between - steps * ANGLE_STEP)
  if (diff > stepTolerance(steps)) return null
  const target = steps * ANGLE_STEP
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (chord < 1e-9) return null
  const midX = (a[0] + b[0]) / 2
  const midZ = (a[1] + b[1]) / 2
  // Unit normal of the chord, toward the corner's side.
  let nx = -(b[1] - a[1]) / chord
  let nz = (b[0] - a[0]) / chord
  if ((corner[0] - midX) * nx + (corner[1] - midZ) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  const radius = chord / (2 * Math.sin(target))
  const offset = chord / 2 / Math.tan(target)
  const cx = midX + nx * offset
  const cz = midZ + nz * offset
  const dx = corner[0] - cx
  const dz = corner[1] - cz
  const distance = Math.hypot(dx, dz)
  if (distance < 1e-9) return null
  return { point: [cx + (dx / distance) * radius, cz + (dz / distance) * radius], diff }
}

/** The angle `point` makes at `start` with the joined wall it is nearest to square with. */
export function jointAngleAt(
  start: WallPlanPoint,
  point: WallPlanPoint,
  walls: readonly WallNode[],
  ignoreWallIds?: readonly string[],
): JointAngle | null {
  let best: JointAngle | null = null
  let bestOff = Number.POSITIVE_INFINITY
  const thickness = Math.max(
    0.2,
    ...walls
      .filter((wall) => !ignoreWallIds?.includes(wall.id))
      .filter((wall) => samePlanPoint(wall.start, start) || samePlanPoint(wall.end, start))
      .map((wall) => wall.thickness ?? 0.2),
  )
  for (const direction of jointDirections(start, walls, ignoreWallIds)) {
    const far: WallPlanPoint = [start[0] + Math.cos(direction), start[1] + Math.sin(direction)]
    const angle = cornerAngle(start, point, far, thickness)
    if (!angle) continue
    const off = Math.abs(angle.deg - 90)
    if (off < bestOff) {
      best = angle
      bestOff = off
    }
  }
  return best
}

function snapWallDraftPointDetailedInner(args: SnapWallDraftArgs): WallDraftSnapResult {
  const {
    point,
    walls,
    start,
    angleSnap = false,
    ignoreWallIds,
    bypassSnap = false,
    step: overrideStep,
    magnetic: magneticArg = true,
    gridSnap,
    snapRadii: explicitRadii,
    planScale,
  } = args
  const snapRadii = explicitRadii ?? (planScale ? planSnapRadii(planScale) : undefined)

  if (bypassSnap) return { point, snap: null, targetWallIds: [] }
  // Joining corners and walls is not a mode choice: every mode but Off sticks
  // to them at the full radius; the mode only shapes placement away from them.
  const magnetic = magneticArg || getActiveSnappingMode() !== 'off'

  // Discrete special points (corner / midpoint / crossing) are taken from the
  // raw cursor so an interim grid snap can't mask them. A corner always wins,
  // then the nearer of midpoint / crossing — see `findWallSpecialPointSnap`.
  if (magnetic) {
    const special = findWallSpecialPointSnap(point, walls, ignoreWallIds, snapRadii)
    if (special) return special
  }

  const step = overrideStep ?? getSegmentGridStep()
  // The angle path snaps the distance ALONG the 15° ray — a scalar, the
  // same in world and local frames — so the `gridSnap` world-grid override
  // only applies when the angle lock is off.
  // Smart mode pulls onto 0/45/90 and grid lines only when close, so a drag can
  // still make small moves; the exclusive modes snap hard.
  // A joint squared against the wall it continues wins over the plan's axes.
  // Any mode but Off: squaring a corner is not an axis or grid choice.
  const jointPoint =
    start && getActiveSnappingMode() !== 'off'
      ? snapToJointAngle(point, start, walls, ignoreWallIds, step)
      : null
  const jointDirection = (): { direction?: [number, number] } => {
    if (!(start && jointPoint)) return {}
    const length = Math.hypot(jointPoint[0] - start[0], jointPoint[1] - start[1])
    return length > 1e-9
      ? { direction: [(jointPoint[0] - start[0]) / length, (jointPoint[1] - start[1]) / length] }
      : {}
  }
  const basePoint: WallPlanPoint = jointPoint
    ? jointPoint
    : getActiveSnappingMode() === 'smart'
      ? snapSmartDraftPoint(point, start && angleSnap ? start : undefined, step, gridSnap)
      : start && angleSnap
        ? [...snapPointAlongAngleRay(start, point, DEFAULT_ANGLE_STEP, step)]
        : gridSnap
          ? gridSnap(point)
          : snapPointToGrid(point, step)

  if (magnetic) {
    const wallSnap = findWallSnapTarget(basePoint, walls, {
      ignoreWallIds,
      radius: snapRadii?.wall,
    })
    if (wallSnap) {
      return {
        point: wallSnap,
        snap: 'wall',
        targetWallIds: wallIdsAtSnapPoint(wallSnap, walls, ignoreWallIds),
      }
    }
    return { point: basePoint, snap: null, targetWallIds: [], ...jointDirection() }
  }

  // Non-magnetic modes (grid / off / angles): connectivity still sticks so a
  // room can close, but only within a tight radius — placement elsewhere is left
  // to the mode (grid quantise / angle lock / free). Snap from the already
  // positioned `basePoint` so the mode's placement is respected right up to the
  // wall, then the last few cm stick onto it (and the beacon shows).
  const connectRadii: WallSnapRadii = {
    endpoint: WALL_CONNECT_SNAP_RADIUS,
    midpoint: WALL_CONNECT_SNAP_RADIUS,
    intersection: WALL_CONNECT_SNAP_RADIUS,
    wall: WALL_CONNECT_SNAP_RADIUS,
  }
  const connectSpecial = findWallSpecialPointSnap(basePoint, walls, ignoreWallIds, connectRadii)
  if (connectSpecial) return connectSpecial
  const connectWall = findWallSnapTarget(basePoint, walls, {
    ignoreWallIds,
    radius: WALL_CONNECT_SNAP_RADIUS,
  })
  if (connectWall) {
    return {
      point: connectWall,
      snap: 'wall',
      targetWallIds: wallIdsAtSnapPoint(connectWall, walls, ignoreWallIds),
    }
  }

  return { point: basePoint, snap: null, targetWallIds: [], ...jointDirection() }
}

export function snapWallDraftPoint(args: SnapWallDraftArgs): WallPlanPoint {
  return snapWallDraftPointDetailed(args).point
}

export function isSegmentLongEnough(start: WallPlanPoint, end: WallPlanPoint): boolean {
  return distanceSquared(start, end) >= WALL_MIN_LENGTH * WALL_MIN_LENGTH
}

export function createWallOnCurrentLevel(
  start: WallPlanPoint,
  end: WallPlanPoint,
  options?: WallConstructionOptions,
): WallNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes, applyNodeChanges } = useScene.getState()

  if (!(currentLevelId && isSegmentLongEnough(start, end))) {
    return null
  }

  const joinRadius = isMagneticSnapActive() ? WALL_JOIN_SNAP_RADIUS : WALL_CONNECT_SNAP_RADIUS

  return runAsSingleSceneHistoryStep(useScene, () => {
    const result = planWallInsertion(nodes, {
      levelId: currentLevelId as AnyNodeId,
      start,
      end,
      joinRadius,
      wallDefaults: useEditor.getState().toolDefaults.wall ?? {},
    })
    if (!result.ok) return null
    const { plan } = result

    const construction = resolveWallConstruction(nodes, currentLevelId, plan.insertedWalls, options)
    const finalizedWalls = construction.walls
    const finalizedWallsById = new Map(finalizedWalls.map((wall) => [wall.id, wall]))
    const sourceUpdate = construction.sourceSupportUpdate
    const sourceAlreadyUpdated = sourceUpdate
      ? plan.changes.update.some((operation) => operation.id === sourceUpdate.id)
      : false
    applyNodeChanges({
      ...plan.changes,
      update: plan.changes.update
        .map((operation) =>
          sourceUpdate?.id === operation.id
            ? { ...operation, data: { ...operation.data, ...sourceUpdate.data } }
            : operation,
        )
        .concat(sourceUpdate && !sourceAlreadyUpdated ? [sourceUpdate] : []),
      create: plan.changes.create.map((operation) => ({
        ...operation,
        node: finalizedWallsById.get(operation.node.id as WallNode['id']) ?? operation.node,
      })),
    })
    sfxEmitter.emit('sfx:structure-build')

    const terminalWall = finalizedWalls.at(-1)!
    const committedWall = useScene.getState().nodes[plan.terminalWallId]
    return committedWall?.type === 'wall' ? committedWall : terminalWall
  })
}
