import {
  calculateLevelMiters,
  getWallPlanFootprint,
  isCurvedWall,
  type WallNode,
} from '@pascal-app/core'

// AIKAZA: the measure tool's own snap targets: the corners and faces a person
// sees on a wall's plan outline, never centre lines or joint centres.

type Plan = [number, number]

export type MeasureSnapCorner = { point: Plan; wallId: string }
export type MeasureSnapFace = { a: Plan; b: Plan; wallId: string }
export type MeasureSnapGeometry = { corners: MeasureSnapCorner[]; faces: MeasureSnapFace[] }

export type MeasureSnapTarget =
  | { kind: 'corner'; point: Plan; wallId: string }
  | { kind: 'face'; point: Plan; wallId: string; face: MeasureSnapFace }

/** Screen pixels to catch a target, and the further distance a caught target holds to. */
export const MEASURE_SNAP_PX = {
  corner: { catch: 14, release: 20 },
  face: { catch: 12, release: 18 },
} as const

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
export function resolveMeasureSnap(
  geometry: MeasureSnapGeometry,
  pointer: Plan,
  pixelsPerMetre: number,
  held: MeasureSnapTarget | null = null,
): MeasureSnapTarget | null {
  const px = (p: Plan) => Math.hypot(p[0] - pointer[0], p[1] - pointer[1]) * pixelsPerMetre
  let corner: { target: MeasureSnapTarget; distance: number } | null = null
  for (const c of geometry.corners) {
    const distance = px(c.point)
    if (distance <= MEASURE_SNAP_PX.corner.catch && (!corner || distance < corner.distance))
      corner = { target: { kind: 'corner', point: c.point, wallId: c.wallId }, distance }
  }
  let face: { target: MeasureSnapTarget; distance: number } | null = null
  for (const f of geometry.faces) {
    const point = closestOnSegment(pointer, f.a, f.b)
    const distance = px(point)
    if (distance <= MEASURE_SNAP_PX.face.catch && (!face || distance < face.distance))
      face = { target: { kind: 'face', point, wallId: f.wallId, face: f }, distance }
  }
  const fresh = corner?.target ?? face?.target ?? null
  if (!held || fresh?.kind === 'corner') return fresh
  // Keep the held target while the pointer stays within its release distance.
  if (held.kind === 'corner') {
    return px(held.point) <= MEASURE_SNAP_PX.corner.release ? held : fresh
  }
  const point = closestOnSegment(pointer, held.face.a, held.face.b)
  if (px(point) > MEASURE_SNAP_PX.face.release) return fresh
  if (fresh?.kind === 'face' && fresh.wallId !== held.wallId) {
    const freshDistance = px(fresh.point)
    if (freshDistance < px(point)) return fresh
  }
  return { ...held, point }
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
