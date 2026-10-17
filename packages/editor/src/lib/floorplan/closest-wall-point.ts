import type { WallNode } from '@pascal-app/core'

type PlanPoint = [number, number]

export type ClosestWallPoint = {
  wall: WallNode
  point: PlanPoint
  t: number
  /** Wall-local normal of the face the point is on: +Z front, -Z back. */
  normal: [number, number, number]
}

/** How far the pointer may stray from the wall already hosting an opening: past a door's swing. */
export const STICKY_WALL_DISTANCE_M = 1.2

/**
 * Nearest wall to a plan point within `maxDistance`, with the face the point is on.
 * With nothing that close, `stickyWallId` keeps its wall up to `STICKY_WALL_DISTANCE_M`.
 */
export function findClosestWallPoint(
  point: PlanPoint,
  walls: WallNode[],
  options?: {
    maxDistance?: number
    canUseWall?: (wall: WallNode) => boolean
    stickyWallId?: string | null
  },
): ClosestWallPoint | null {
  const nearest = findNearestWallPoint(
    point,
    walls,
    options?.maxDistance ?? 0.5,
    options?.canUseWall,
  )
  if (nearest || !options?.stickyWallId) return nearest
  const sticky = walls.filter((wall) => wall.id === options.stickyWallId)
  return findNearestWallPoint(point, sticky, STICKY_WALL_DISTANCE_M, options.canUseWall)
}

function findNearestWallPoint(
  point: PlanPoint,
  walls: WallNode[],
  maxDistance: number,
  canUseWall: ((wall: WallNode) => boolean) | undefined,
): ClosestWallPoint | null {
  let best: ClosestWallPoint | null = null
  let bestDistSq = maxDistance * maxDistance

  for (const wall of walls) {
    if (canUseWall && !canUseWall(wall)) {
      continue
    }

    const [x1, z1] = wall.start
    const [x2, z2] = wall.end
    const dx = x2 - x1
    const dz = z2 - z1
    const lengthSq = dx * dx + dz * dz
    if (lengthSq < 1e-9) continue

    let t = ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSq
    t = Math.max(0, Math.min(1, t))

    const px = x1 + t * dx
    const pz = z1 + t * dz

    const distSq = (point[0] - px) ** 2 + (point[1] - pz) ** 2
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      // Same sign as core `closestOnSegment`'s `perp`: positive is the front face.
      const perp = -(point[0] - x1) * dz + (point[1] - z1) * dx
      best = { wall, point: [px, pz], t, normal: [0, 0, perp >= 0 ? 1 : -1] }
    }
  }

  return best
}
