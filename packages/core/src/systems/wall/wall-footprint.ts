import type { WallNode } from '../../schema'
import { getWallSurfacePolygon, isCurvedWall } from './wall-curve'
import { getWallFaceOffsets } from './wall-frame'
import {
  getWallMiterBoundaryPoints,
  type Point2D,
  pointToKey,
  type WallMiterData,
} from './wall-mitering'

export { faceOnLine, justificationForFaceOnLine } from './wall-frame'
export { calculateLevelMiters, type Point2D, type WallMiterData } from './wall-mitering'
export { roomSideFaces } from './wall-room-sides'

export const DEFAULT_WALL_THICKNESS = 0.1
export const DEFAULT_WALL_HEIGHT = 2.5
export const CURVED_WALL_SURFACE_SEGMENTS = 24

export function getWallThickness(wallNode: WallNode): number {
  return wallNode.thickness ?? DEFAULT_WALL_THICKNESS
}

export function getWallPlanFootprint(wallNode: WallNode, miterData: WallMiterData): Point2D[] {
  const { junctionData } = miterData
  const wallStart: Point2D = { x: wallNode.start[0], y: wallNode.start[1] }
  const wallEnd: Point2D = { x: wallNode.end[0], y: wallNode.end[1] }
  const { a, b } = getWallFaceOffsets(wallNode)
  const v = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y }
  const L = Math.sqrt(v.x * v.x + v.y * v.y)

  if (L < 1e-9) {
    return []
  }
  const nUnit = { x: -v.y / L, y: v.x / L }
  const keyStart = pointToKey(wallStart)
  const keyEnd = pointToKey(wallEnd)
  const startJunction = junctionData.get(keyStart)?.get(wallNode.id)
  const endJunction = junctionData.get(keyEnd)?.get(wallNode.id)

  if (isCurvedWall(wallNode)) {
    const boundaryPoints = getWallMiterBoundaryPoints(wallNode, miterData)
    if (!boundaryPoints) {
      return []
    }

    const { startLeft, startRight, endLeft, endRight } = boundaryPoints

    return getWallSurfacePolygon(wallNode, CURVED_WALL_SURFACE_SEGMENTS, {
      endLeft,
      endRight,
      startLeft,
      startRight,
    })
  }

  const pStartLeft: Point2D = startJunction?.left || {
    x: wallStart.x + nUnit.x * a,
    y: wallStart.y + nUnit.y * a,
  }
  const pStartRight: Point2D = startJunction?.right || {
    x: wallStart.x - nUnit.x * -b,
    y: wallStart.y - nUnit.y * -b,
  }
  const pEndLeft: Point2D = endJunction?.right || {
    x: wallEnd.x + nUnit.x * a,
    y: wallEnd.y + nUnit.y * a,
  }
  const pEndRight: Point2D = endJunction?.left || {
    x: wallEnd.x - nUnit.x * -b,
    y: wallEnd.y - nUnit.y * -b,
  }

  const polygon: Point2D[] = [pStartRight, pEndRight]
  if (endJunction) {
    polygon.push(endJunction.closing ?? wallEnd)
  }
  polygon.push(pEndLeft, pStartLeft)
  if (startJunction) {
    polygon.push(startJunction.closing ?? wallStart)
  }

  return polygon
}

/**
 * The edges of a straight wall's plan footprint that are its outline: both
 * faces, its free ends, and the parts of a joined end not up against one of
 * `neighbours` (the footprints of the walls joined there), so a mitre between
 * joined walls reads as one shape while a thicker wall's exposed shoulder at
 * a T keeps its edge. Null for a curved wall (its polygon carries the outline).
 */
export function getWallPlanOutline(
  wallNode: WallNode,
  miterData: WallMiterData,
  neighbours: readonly Point2D[][] = [],
): Point2D[][] | null {
  if (isCurvedWall(wallNode)) return null
  const polygon = getWallPlanFootprint(wallNode, miterData)
  if (polygon.length < 4) return null
  const { junctionData } = miterData
  const startJoined = Boolean(
    junctionData.get(pointToKey({ x: wallNode.start[0], y: wallNode.start[1] }))?.get(wallNode.id),
  )
  const endJoined = Boolean(
    junctionData.get(pointToKey({ x: wallNode.end[0], y: wallNode.end[1] }))?.get(wallNode.id),
  )
  // The footprint runs start-right, end-right, [end closing], end-left, start-left, [start closing].
  const startRight = polygon[0]!
  const endRight = polygon[1]!
  const endLeft = polygon[endJoined ? 3 : 2]!
  const startLeft = polygon[endJoined ? 4 : 3]!
  const edges: Point2D[][] = [
    [startRight, endRight],
    [endLeft, startLeft],
  ]
  const along = {
    x: wallNode.end[0] - wallNode.start[0],
    y: wallNode.end[1] - wallNode.start[1],
  }
  const length = Math.hypot(along.x, along.y) || 1
  const outward = { x: along.x / length, y: along.y / length }
  const endPath = endJoined ? [endRight, polygon[2]!, endLeft] : [endRight, endLeft]
  const startPath = startJoined
    ? [startLeft, polygon[polygon.length - 1]!, startRight]
    : [startLeft, startRight]
  edges.push(...exposedPieces(endPath, endJoined ? outward : null, neighbours))
  edges.push(
    ...exposedPieces(startPath, startJoined ? { x: -outward.x, y: -outward.y } : null, neighbours),
  )
  return edges
}

// Pieces an end edge is cut into to find which parts sit against a neighbour.
const OUTLINE_END_PIECES = 8

/** The parts of an end path whose far side is not inside a neighbour footprint. */
function exposedPieces(
  path: Point2D[],
  outward: Point2D | null,
  neighbours: readonly Point2D[][],
): Point2D[][] {
  if (!outward) return path.slice(1).map((to, i) => [path[i]!, to])
  const pieces: Point2D[][] = []
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!
    const to = path[i]!
    for (let k = 0; k < OUTLINE_END_PIECES; k++) {
      const a = lerpPoint(from, to, k / OUTLINE_END_PIECES)
      const b = lerpPoint(from, to, (k + 1) / OUTLINE_END_PIECES)
      const probe = { x: (a.x + b.x) / 2 + outward.x * 1e-3, y: (a.y + b.y) / 2 + outward.y * 1e-3 }
      if (neighbours.some((polygon) => pointInPolygon(probe, polygon))) continue
      const last = pieces[pieces.length - 1]
      if (last && last[1] === a) last[1] = b
      else pieces.push([a, b])
    }
  }
  return pieces
}

function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function pointInPolygon(point: Point2D, polygon: readonly Point2D[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside
  }
  return inside
}
