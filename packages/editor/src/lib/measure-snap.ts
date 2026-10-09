import {
  calculateLevelMiters,
  getWallPlanFootprint,
  isCurvedWall,
  type WallNode,
} from '@pascal-app/core'
import { SNAP_REACH_PX } from './snap-reach'

// AIKAZA: the measure tool's own snap targets: the corners and faces a person
// sees on a wall's plan outline, never centre lines or joint centres.

type Plan = [number, number]

export type MeasureSnapCorner = { point: Plan; wallId: string }
export type MeasureSnapFace = { a: Plan; b: Plan; wallId: string }
export type MeasureSnapGeometry = { corners: MeasureSnapCorner[]; faces: MeasureSnapFace[] }

export type MeasureSnapTarget =
  | { kind: 'corner'; point: Plan; wallId: string }
  | { kind: 'face'; point: Plan; wallId: string; face: MeasureSnapFace }

const MEASURE_SNAP_PX = SNAP_REACH_PX.measure

/** Visible outline corners and faces of the given walls. */
export function buildMeasureSnapGeometry(walls: readonly WallNode[]): MeasureSnapGeometry {
  const miters = calculateLevelMiters([...walls])
  const outlines = walls.map((wall) => ({
    wall,
    polygon: getWallPlanFootprint(wall, miters).map((p) => [p.x, p.y] as Plan),
  }))
  const onWallEnd = (p: Plan) =>
    walls.some((wall) =>
      [wall.start, wall.end].some((end) => Math.hypot(end[0] - p[0], end[1] - p[1]) < 1e-6),
    )
  // Inside another wall's outline, by more than a hair, means hidden from view.
  const hidden = (p: Plan, ownerId: string) =>
    outlines.some(({ wall, polygon }) => wall.id !== ownerId && strictlyInside(p, polygon, 1e-4))
  const corners: MeasureSnapCorner[] = []
  const faces: MeasureSnapFace[] = []
  for (const { wall, polygon } of outlines) {
    if (isCurvedWall(wall) || polygon.length < 3) continue
    for (const point of polygon) {
      if (!onWallEnd(point) && !hidden(point, wall.id)) corners.push({ point, wallId: wall.id })
    }
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue
      // An edge through a joint centre is a mitre seam, not a face.
      if (onWallEnd(a) || onWallEnd(b)) continue
      const mid: Plan = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      if (hidden(mid, wall.id)) continue
      faces.push({ a, b, wallId: wall.id })
    }
  }
  return { corners, faces }
}

/**
 * The target a pointer lands on: the nearest corner within reach, else the
 * nearest face. A target already held keeps winning until the pointer leaves
 * its wider release distance, so it does not flicker between neighbours.
 */
export type MeasureSnapOptions = {
  corners?: boolean
  faces?: boolean
  // Multiplies every catch and release distance.
  reachScale?: number
}

export function resolveMeasureSnap(
  geometry: MeasureSnapGeometry,
  pointer: Plan,
  pixelsPerMetre: number,
  held: MeasureSnapTarget | null = null,
  { corners: useCorners = true, faces: useFaces = true, reachScale = 1 }: MeasureSnapOptions = {},
): MeasureSnapTarget | null {
  const px = (p: Plan) => Math.hypot(p[0] - pointer[0], p[1] - pointer[1]) * pixelsPerMetre
  const reach = {
    cornerCatch: MEASURE_SNAP_PX.corner.catch * reachScale,
    cornerRelease: MEASURE_SNAP_PX.corner.release * reachScale,
    faceCatch: MEASURE_SNAP_PX.face.catch * reachScale,
    faceRelease: MEASURE_SNAP_PX.face.release * reachScale,
  }
  let corner: { target: MeasureSnapTarget; distance: number } | null = null
  if (useCorners) {
    for (const c of geometry.corners) {
      const distance = px(c.point)
      if (distance <= reach.cornerCatch && (!corner || distance < corner.distance))
        corner = { target: { kind: 'corner', point: c.point, wallId: c.wallId }, distance }
    }
  }
  let face: { target: MeasureSnapTarget; distance: number } | null = null
  if (useFaces) {
    for (const f of geometry.faces) {
      const point = closestOnSegment(pointer, f.a, f.b)
      const distance = px(point)
      if (distance <= reach.faceCatch && (!face || distance < face.distance))
        face = { target: { kind: 'face', point, wallId: f.wallId, face: f }, distance }
    }
  }
  const fresh = corner?.target ?? face?.target ?? null
  // A held target of a kind just switched off lets go at once.
  const usable = held && (held.kind === 'corner' ? useCorners : useFaces) ? held : null
  if (!usable || fresh?.kind === 'corner') return fresh
  if (usable.kind === 'corner') {
    return px(usable.point) <= reach.cornerRelease ? usable : fresh
  }
  const point = closestOnSegment(pointer, usable.face.a, usable.face.b)
  if (px(point) > reach.faceRelease) return fresh
  if (fresh?.kind === 'face' && fresh.wallId !== usable.wallId && px(fresh.point) < px(point))
    return fresh
  return { ...usable, point }
}

function closestOnSegment(p: Plan, a: Plan, b: Plan): Plan {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz
  const t =
    lengthSq < 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq))
  return [a[0] + dx * t, a[1] + dz * t]
}

function strictlyInside(p: Plan, polygon: readonly Plan[], margin: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  if (!inside) return false
  // Points on the boundary count as visible.
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const q = closestOnSegment(p, polygon[j]!, polygon[i]!)
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= margin) return false
  }
  return true
}
