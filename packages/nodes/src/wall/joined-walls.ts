import {
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallFaceOffsets,
  type WallNode,
} from '@pascal-app/core'
import { samePoint } from './move-shared'

type Point = readonly [number, number]

/** A wall joined to the selected one, and where along it (0 = start, 1 = end) they meet. */
export type WallJoin = { wall: WallNode; at: number }

/**
 * The walls of the same level that meet `wall`: sharing a corner with it,
 * ending on its side (a T), or with `wall` ending on theirs.
 */
export function findJoinedWalls(wall: WallNode, walls: readonly WallNode[]): WallJoin[] {
  const joins: WallJoin[] = []
  for (const other of walls) {
    if (other.id === wall.id || other.parentId !== wall.parentId) continue
    const at = joinPoint(wall, other)
    if (at !== null) joins.push({ wall: other, at })
  }
  return joins
}

function joinPoint(wall: WallNode, other: WallNode): number | null {
  for (const corner of [wall.start, wall.end]) {
    if (samePoint(other.start, corner)) return 0
    if (samePoint(other.end, corner)) return 1
  }
  if (onBody(other.start, wall) !== null) return 0
  if (onBody(other.end, wall) !== null) return 1
  for (const corner of [wall.start, wall.end]) {
    const along = onBody(corner, other)
    if (along !== null) return along
  }
  return null
}

// Points along a wall searched for the one nearest a corner, then refined.
const SEARCH_SAMPLES = 48

/**
 * Where `point` touches `wall`'s body, strictly between its ends, as a curve
 * parameter (0..1), or null when off it. Follows a curved wall's arc and the
 * side its justification puts the body on.
 */
function onBody(point: Point, wall: WallNode): number | null {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i <= SEARCH_SAMPLES; i++) {
    const t = i / SEARCH_SAMPLES
    const { point: p } = getWallCurveFrameAt(wall, t)
    const distance = Math.hypot(point[0] - p.x, point[1] - p.y)
    if (distance < bestDistance) {
      best = t
      bestDistance = distance
    }
  }
  // Refine within the neighbouring samples by stepping along the tangent.
  const length = getWallCurveLength(wall)
  if (length < 1e-6) return null
  let t = best
  for (let step = 0; step < 4; step++) {
    const { point: p, tangent } = getWallCurveFrameAt(wall, t)
    const along = (point[0] - p.x) * tangent.x + (point[1] - p.y) * tangent.y
    t = Math.min(1, Math.max(0, t + along / length))
  }
  if (t <= 1e-4 || t >= 1 - 1e-4) return null
  const { point: p, normal, tangent } = getWallCurveFrameAt(wall, t)
  const dx = point[0] - p.x
  const dy = point[1] - p.y
  if (Math.abs(dx * tangent.x + dy * tangent.y) > 1e-3) return null
  const offset = dx * normal.x + dy * normal.y
  const { a, b } = getWallFaceOffsets(wall)
  return offset >= b - 1e-3 && offset <= a + 1e-3 ? t : null
}
